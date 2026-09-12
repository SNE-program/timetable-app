import type { CloudSession } from './client';

/**
 * 邮件链接回跳时的解析。
 *
 * ## 为什么需要它
 *
 * 「确认邮箱」和「重置密码」的邮件里是一个 Supabase 的链接，点开之后它会 302 回我们的站点，
 * 并把登录凭据放在 **URL 的 fragment** 里（隐式流程）：
 *
 *   https://<站点>/#access_token=...&refresh_token=...&expires_in=3600&type=recovery
 *
 * 以前客户端完全不看这个 fragment —— 结果就是：用户点了邮件里的链接，跳回来仍是未登录状态，
 * 「找回密码」这条路走不通。这不是小问题：找回密码是账号体系里唯一的下车通道。
 *
 * ## 为什么放在 fragment 而不是 query
 *
 * fragment 不会发给服务器（也不会进 referer / 日志），这是 Supabase 的刻意设计，我们照用。
 * 代价是只有前端能读 —— 所以这段解析必须在前端做。
 *
 * ## 处理完要把 fragment 抹掉
 *
 * 否则用户刷新一次就会重新"用同一个 token 登录一次"，而且那串 token 会留在地址栏里
 * （截图、分享链接都可能带出去）。抹掉用 history.replaceState，不产生新的历史记录。
 */

export type AuthLinkKind = 'session' | 'error' | 'none';

export interface AuthLink {
  kind: AuthLinkKind;
  /** kind === 'session' 时存在 */
  session?: CloudSession;
  /** 链接类型：signup / recovery / email_change / magiclink… */
  type?: string;
  /** kind === 'error' 时给用户看的一句话 */
  message?: string;
}

/** 把 fragment / query 里的键值对读出来；两处都找得到时 fragment 优先 */
export function readParams(hash: string, search?: string): Record<string, string> {
  const out: Record<string, string> = {};
  const take = function (raw: string): void {
    const text = raw.replace(/^[#?]/, '');
    if (!text) return;
    for (const pair of text.split('&')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      const k = i < 0 ? pair : pair.slice(0, i);
      const v = i < 0 ? '' : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
      catch (e) { out[k] = v; }
    }
  };
  if (search) take(search);
  take(hash);
  return out;
}

/** Supabase 的错误码翻成人话 */
const ERRORS: { match: string; text: string }[] = [
  { match: 'otp_expired', text: '这个链接已经失效了（邮件链接一小时内有效），请在应用里重新申请一次' },
  { match: 'access_denied', text: '这个链接已经用过了，或者被取消了。请在应用里重新申请一次' },
  { match: 'user_banned', text: '这个账号已被停用' },
  { match: 'email_exists', text: '这个邮箱已经注册过了，直接登录即可' },
  { match: 'invalid_request', text: '链接不完整，可能是邮件客户端把地址截断了。可以手动复制完整地址再打开' },
];

export function friendlyLinkError(code: string, description: string): string {
  for (const e of ERRORS) {
    if (code === e.match || description.toLowerCase().indexOf(e.match) >= 0) return e.text;
  }
  const text = (description || '').trim();
  if (text && /\s/.test(text)) return text;
  return '这个链接不能用（' + (code || '未知原因') + '），请在应用里重新申请一次';
}

/**
 * 解析回跳地址。
 *
 * 只看参数，不看域名 —— 因为这个函数要在单测里跑，而"域名对不对"是另一件事
 * （Supabase 只允许白名单里的地址回跳，配置在 supabase/README.md 里）。
 */
export function parseAuthLink(hash: string, search?: string): AuthLink {
  const p = readParams(hash || '', search);
  const access = p.access_token || '';
  const refresh = p.refresh_token || '';
  const type = p.type || '';

  if (p.error || p.error_code) {
    return { kind: 'error', type: type, message: friendlyLinkError(p.error_code || p.error || '', p.error_description || '') };
  }
  /* PKCE 流程回跳的是 ?code=…，需要当初保存的 code_verifier 才能换令牌。
     我们用的是隐式流程（fragment 里直接给令牌），所以这里只可能出现在配置被改过的情况。 */
  if (p.code && !access) {
    return { kind: 'error', type: type, message: '这条链接需要另一种登录流程（PKCE）。请在应用里用「忘记密码」重新走一次' };
  }
  if (!access || !refresh) return { kind: 'none' };

  const expiresIn = Number(p.expires_in || 3600);
  return {
    kind: 'session',
    type: type,
    session: {
      accessToken: access,
      refreshToken: refresh,
      /* 与 client.toSession 一致：留 60 秒余量 */
      expiresAt: Date.now() + Math.max(60, (isFinite(expiresIn) ? expiresIn : 3600) - 60) * 1000,
      user: { id: p.user_id || '', email: '' },
    },
  };
}

/** 从回跳参数里读出邮箱（Supabase 在 confirm 链接里不一定给，给了就用） */
export function emailFromLink(hash: string, search?: string): string {
  const p = readParams(hash || '', search);
  return p.email || '';
}
