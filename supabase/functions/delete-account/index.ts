/**
 * Edge Function：注销账号并删除云端数据。
 *
 * ## 为什么必须在服务端做
 *
 * 删除 auth.users 里那一行需要 **service_role** 权限，而那把 key 能绕过所有 RLS ——
 * 它绝对不能出现在前端包里。所以客户端只发一个"我要注销"的请求，
 * 由这个函数在自己的环境里用 service_role 完成。
 *
 * ## 做了什么
 *
 * 1. 用调用方带来的 access token 向 GoTrue 问一次"你是谁"（token 无效就直接 401）；
 * 2. 删掉他在 public.timetables 里的那一行；
 * 3. 删掉 auth.users 里的账号（cascade 会把残留数据一并带走）。
 *
 * ## 刻意不做的事
 *
 * 不接受任何"帮别人删"的参数 —— 只认调用者自己的 token。
 * 这个函数没有任何第三方依赖，只用 fetch + Deno.env，几百毫秒就能读完。
 *
 * 部署：
 *   supabase functions deploy delete-account
 * 需要的环境变量（Supabase 会自动注入前两个，不用手配）：
 *   SUPABASE_URL              项目地址（自动）
 *   SUPABASE_SERVICE_ROLE_KEY 服务密钥（自动）
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  });
}

Deno.serve(async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: '只支持 POST' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: '没有带登录凭据' }, 401);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: '服务端没配置好（缺 SUPABASE_URL / SERVICE_ROLE_KEY）' }, 500);

  /* 1. 这个 token 是谁的 —— 让 GoTrue 自己校验，别在函数里手搓 JWT 解析 */
  let userId = '';
  let email = '';
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return json({ error: '登录已失效，请重新登录后再试' }, 401);
    const me = await res.json();
    userId = String(me.id || '');
    email = String(me.email || '');
  } catch (e) {
    return json({ error: '校验登录状态失败：' + (e as Error).message }, 502);
  }
  if (!userId) return json({ error: '拿不到用户身份' }, 401);

  /* 2. 删数据。用 service_role，所以这里能删干净；user_id 来自上面的校验，不接受客户端传参 */
  try {
    const del = await fetch(SUPABASE_URL + '/rest/v1/timetables?user_id=eq.' + encodeURIComponent(userId), {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, Prefer: 'return=minimal' },
    });
    if (!del.ok && del.status !== 404) {
      return json({ error: '删除云端备份失败（HTTP ' + del.status + '）' }, 502);
    }
  } catch (e) {
    return json({ error: '删除云端备份失败：' + (e as Error).message }, 502);
  }

  /* 3. 删账号 */
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    if (!res.ok) {
      const text = await res.text();
      return json({ error: '删除账号失败（HTTP ' + res.status + '）：' + text.slice(0, 200) }, 502);
    }
  } catch (e) {
    return json({ error: '删除账号失败：' + (e as Error).message }, 502);
  }

  return json({ ok: true, deleted: { userId: userId, email: email } });
});
