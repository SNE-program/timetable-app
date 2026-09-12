/**
 * Edge Function：把邮件发到**调用者自己的邮箱**（走 Resend）。
 *
 * ## 为什么只发给自己
 *
 * 一个能任意指定收件人的函数就是一台开放的垃圾邮件发送机 —— 只要有人拿到 anon key
 * （它是公开的）就能用你的域名和额度群发。所以这里的收件人**只从 access token 里取**，
 * 请求体里给什么 to 都不看。这条限制是刻意的，别改。
 *
 * ## 登录邮件不经过这里
 *
 * 注册确认、找回密码这些由 Supabase Auth 自己发。正确做法是把 Resend 配成 Auth 的自定义 SMTP
 * （见 supabase/README.md），而不是在这里手搓邮件 —— Auth 的邮件里带的是它自己签的链接，
 * 自己发就得自己造链接，那等于重写一遍认证流程。
 *
 * ## 用到的环境变量
 *
 *   RESEND_API_KEY   Resend 的 API key（**只能放服务端**）
 *   MAIL_FROM        发件人，例如 课表助手 <noreply@your-domain.com>
 *                    Resend 要求发件域名已验证；没验证过时只能用 onboarding@resend.dev，
 *                    而且只能发给注册 Resend 用的那个邮箱
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  （Supabase 自动注入）
 *
 * 部署：supabase functions deploy send-mail
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const MAIL_FROM = Deno.env.get('MAIL_FROM') || '课表助手 <onboarding@resend.dev>';

/** 频率限制：给自己发也不能无限发，否则会把项目的每日额度烧光 */
const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 20;
const SUBJECT_MAX = 120;
const TEXT_MAX = 20000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}

const admin = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

Deno.serve(async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: '只支持 POST' }, 405);
  if (!RESEND_KEY) return json({ error: '服务端没配置 RESEND_API_KEY' }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: '服务端没配置好 Supabase 环境变量' }, 500);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: '没有带登录凭据' }, 401);

  /* 1. 你是谁 —— 收件人只认这里查出来的邮箱 */
  let userId = '';
  let email = '';
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
    if (!res.ok) return json({ error: '登录已失效，请重新登录' }, 401);
    const me = await res.json();
    userId = String(me.id || '');
    email = String(me.email || '');
  } catch (e) {
    return json({ error: '校验登录状态失败：' + (e as Error).message }, 502);
  }
  if (!userId || !email) return json({ error: '拿不到你的邮箱，先在账号里补一个' }, 400);

  /* 2. 参数：只收 subject / text，长度有上限 */
  let body: { subject?: string; text?: string } = {};
  try { body = await req.json(); } catch (e) { body = {}; }
  const subject = String(body.subject || '').slice(0, SUBJECT_MAX).trim();
  const text = String(body.text || '').slice(0, TEXT_MAX);
  if (!subject) return json({ error: '没有主题' }, 400);
  if (!text.trim()) return json({ error: '没有正文' }, 400);

  /* 3. 频率限制：按 user_id 记账，服务端说了算 */
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/mail_log?select=sent_at&user_id=eq.' + encodeURIComponent(userId)
      + '&sent_at=gte.' + encodeURIComponent(since),
      { headers: admin }
    );
    if (res.ok) {
      const rows: { sent_at: string }[] = await res.json();
      const day = rows.length;
      const hour = rows.filter(function (r) { return r.sent_at >= hourAgo; }).length;
      if (hour >= MAX_PER_HOUR) return json({ error: '一小时内发得太多了，过一会儿再试' }, 429);
      if (day >= MAX_PER_DAY) return json({ error: '今天发得太多了，明天再试' }, 429);
    }
  } catch (e) { /* 记账失败不阻塞发信，宁可放行 */ }

  /* 4. 发信 */
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [email], subject: subject, text: text }),
    });
    const out = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const msg = (out && (out.message || out.error)) || ('HTTP ' + res.status);
      /* Resend 在没有验证域名时的报错很有代表性，翻成人话 */
      const friendly = /domain is not verified|not authorized to send/i.test(String(msg))
        ? '发件域名还没在 Resend 里验证通过（见 supabase/README.md 的 SMTP 一节）'
        : String(msg);
      return json({ error: 'Resend 拒绝了这封信：' + friendly }, 502);
    }
    await fetch(SUPABASE_URL + '/rest/v1/mail_log', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'return=minimal' }, admin),
      body: JSON.stringify([{ user_id: userId, subject: subject.slice(0, 80) }]),
    }).catch(function () { /* 记不上就记不上 */ });
    return json({ ok: true, to: email, id: (out && out.id) || '' });
  } catch (e) {
    return json({ error: '发信失败：' + (e as Error).message }, 502);
  }
});
