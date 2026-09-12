import { cloudConfigured, supabaseKey, supabaseUrl } from './config';

/**
 * 一个**不带依赖**的 Supabase 客户端（认证 + 一张表的读写）。
 *
 * ## 为什么不用 @supabase/supabase-js
 *
 * 这个项目从第一天起就只有 React 与 Capacitor 两个运行时依赖 ——
 * 插件的立场也是"只吃声明式数据，不执行第三方代码"。为了「登录 + 备份一张表」
 * 引入一个几百 KB 的 SDK，代价和收益不成比例。
 *
 * 这里用到的东西本来就都是普通 HTTP：
 *   POST /auth/v1/signup            注册
 *   POST /auth/v1/token?grant_type= 登录 / 刷新
 *   POST /auth/v1/recover           发重置密码邮件
 *   POST /auth/v1/logout            退出
 *   GET/POST/DELETE /rest/v1/timetables   读写那一行备份
 * 全部是 JSON 进、JSON 出，测起来也简单（把 fetch 换掉就行）。
 *
 * ## 边界
 *
 * 这个模块**只做网络**，不认识课表、不碰界面。所有函数都要显式传入 token，
 * 不读全局状态 —— 于是"没登录就不会有请求"这件事是能从签名上看出来的。
 */

export interface CloudUser {
  id: string;
  email: string;
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  /** epoch 毫秒 */
  expiresAt: number;
  user: CloudUser;
}

export class CloudError extends Error {
  /** HTTP 状态码；网络层失败时为 0 */
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
  }
}

/**
 * 把 Supabase 的英文报错翻成人话。
 *
 * 直接把 "Invalid login credentials" 甩给同学，等于没做这一步 ——
 * 这个项目的规矩是：用户看到的每一句话都要能照着做下一步。
 */
const MESSAGES: { match: RegExp; text: string }[] = [
  { match: /invalid login credentials/i, text: '邮箱或密码不对' },
  { match: /email not confirmed/i, text: '这个邮箱还没确认，先去收件箱点一下确认链接' },
  { match: /user already registered|already been registered/i, text: '这个邮箱已经注册过了，直接登录，或用「忘记密码」重设' },
  { match: /password should be at least/i, text: '密码太短了，至少要 6 位' },
  { match: /unable to validate email|invalid format/i, text: '邮箱格式不对' },
  { match: /email rate limit|over_email_send_rate_limit/i, text: '确认邮件发得太频繁，过几分钟再试（免费额度每小时有限）' },
  { match: /for security purposes|rate limit/i, text: '操作太频繁了，等一会儿再试' },
  { match: /user not found/i, text: '没查到这个邮箱对应的账号' },
  { match: /signups not allowed|signup.*disabled/i, text: '这个项目关闭了注册（Supabase → Authentication → Providers → Email）' },
  { match: /jwt expired|token has expired/i, text: '登录已过期，请重新登录' },
  { match: /invalid api key|no api key/i, text: 'Supabase 配置不对（anon key 无效）' },
  { match: /failed to fetch|network|load failed/i, text: '连不上服务器，检查一下网络' },
  { match: /payload too large|exceeded the maximum/i, text: '备份太大了，服务器不收（免费额度单行上限约 1 MB）' },
];

function friendly(raw: string, status: number, code: string): string {
  const text = (raw || '').trim();
  for (const m of MESSAGES) {
    if (m.match.test(text) || m.match.test(code)) return m.text;
  }
  if (status === 0) return '连不上服务器，检查一下网络';
  if (status === 404) return '接口地址不对（404）：检查一下 Supabase 的 URL 有没有填错';
  if (status === 401 || status === 403) return '没有权限：' + (text || '请重新登录');
  /*
   * 只有"像一句话"的原文才直接显示给用户。
   * 反例是真实遇到的：本地假服务器回了 404 + 正文 "no"，
   * 界面上就真的显示了一个 "no" —— 用户完全不知道发生了什么。
   * 判断标准很土但有效：有空格、或者够长，才算句子。
   */
  const looksLikeSentence = text.length > 12 && /\s/.test(text);
  if (looksLikeSentence) return text;
  return '请求失败（HTTP ' + status + '）' + (text && text.length <= 40 ? '：' + text : '');
}

interface RawError { message?: string; error_description?: string; msg?: string; error?: string; error_code?: string; code?: string }

/** 统一的请求出口：超时、错误翻译、JSON 解析都在这里做一次 */
async function request(
  method: string, path: string, opts: { token?: string; body?: unknown; prefer?: string; timeoutMs?: number } = {}
): Promise<unknown> {
  if (!cloudConfigured()) throw new CloudError('这个版本没有配置云备份', 0, 'not_configured');
  const url = supabaseUrl() + path;
  const headers: Record<string, string> = {
    apikey: supabaseKey(),
    'Content-Type': 'application/json',
  };
  const bearer = opts.token || supabaseKey();
  headers.Authorization = 'Bearer ' + bearer;
  if (opts.prefer) headers.Prefer = opts.prefer;

  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeoutMs || 20000) : null;
  let res: Response;
  try {
    res = await fetch(url, {
      method: method,
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctl ? ctl.signal : undefined,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    const msg = (e as Error).message || '';
    if (/abort/i.test(msg)) throw new CloudError('请求超时了，稍后再试', 0, 'timeout');
    throw new CloudError(friendly(msg, 0, ''), 0, 'network');
  }
  if (timer) clearTimeout(timer);

  const text = await res.text();
  let json: unknown = null;
  if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }

  if (!res.ok) {
    const err = (json || {}) as RawError;
    const raw = err.message || err.error_description || err.msg || err.error || text.slice(0, 200);
    const code = err.error_code || err.code || '';
    throw new CloudError(friendly(String(raw), res.status, String(code)), res.status, String(code));
  }
  return json;
}

function toSession(json: unknown): CloudSession {
  const j = (json || {}) as Record<string, unknown>;
  const user = (j.user || {}) as Record<string, unknown>;
  const access = String(j.access_token || '');
  const refresh = String(j.refresh_token || '');
  const expiresIn = Number(j.expires_in || 3600);
  if (!access || !refresh) throw new CloudError('服务器没有返回登录凭据', 0, 'bad_response');
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    user: { id: String(user.id || ''), email: String(user.email || '') },
  };
}

/** 注册。项目开了邮箱确认时，返回的 session 为空 —— 调用方要如实提示"去邮箱确认" */
export async function signUp(email: string, password: string): Promise<CloudSession | null> {
  const json = await request('POST', '/auth/v1/signup', { body: { email: email, password: password } });
  const j = (json || {}) as Record<string, unknown>;
  if (!j.access_token) return null;
  return toSession(json);
}

export async function signIn(email: string, password: string): Promise<CloudSession> {
  const json = await request('POST', '/auth/v1/token?grant_type=password', { body: { email: email, password: password } });
  return toSession(json);
}

export async function refreshSession(refreshToken: string): Promise<CloudSession> {
  const json = await request('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
  return toSession(json);
}

/** 发重置密码邮件；邮件里的链接会带上 Supabase 配的重定向地址 */
export async function sendRecover(email: string, redirectTo?: string): Promise<void> {
  const path = '/auth/v1/recover' + (redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '');
  await request('POST', path, { body: { email: email } });
}

/**
 * 改密码（已登录时用；从找回密码的链接进来时，那个临时会话也算"已登录"）。
 * 走 PUT /auth/v1/user，与 Supabase 的 updateUser({password}) 等价。
 */
export async function updatePassword(accessToken: string, password: string): Promise<void> {
  await request('PUT', '/auth/v1/user', { token: accessToken, body: { password: password } });
}

/** 读当前登录者的资料（拿邮箱用 —— 回跳链接里不一定带邮箱） */
export async function fetchMe(accessToken: string): Promise<CloudUser> {
  const json = await request('GET', '/auth/v1/user', { token: accessToken });
  const j = (json || {}) as Record<string, unknown>;
  return { id: String(j.id || ''), email: String(j.email || '') };
}

export async function signOut(accessToken: string): Promise<void> {
  try {
    await request('POST', '/auth/v1/logout', { token: accessToken });
  } catch (e) {
    /* 退出登录不该因为网络失败而失败 —— 本地清干净就行 */
    if (!(e instanceof CloudError) || e.status >= 500 || e.status === 0) return;
    throw e;
  }
}

export interface CloudRow {
  user_id: string;
  payload: unknown;
  app_version: string;
  device: string;
  updated_at: string;
}

/** 读自己那一行备份（RLS 保证只可能读到自己） */
export async function fetchBackup(accessToken: string): Promise<CloudRow | null> {
  const json = await request('GET', '/rest/v1/timetables?select=user_id,payload,app_version,device,updated_at&limit=1', { token: accessToken });
  const rows = Array.isArray(json) ? json : [];
  return rows.length ? (rows[0] as CloudRow) : null;
}

/** 写备份：user_id 是主键，所以是 upsert（同一账号永远只有一行） */
export async function saveBackup(
  accessToken: string, userId: string, payload: unknown, appVersion: string, device: string
): Promise<CloudRow> {
  const json = await request('POST', '/rest/v1/timetables', {
    token: accessToken,
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{ user_id: userId, payload: payload, app_version: appVersion, device: device }],
  });
  const rows = Array.isArray(json) ? json : [];
  if (!rows.length) throw new CloudError('服务器没有确认这次备份', 0, 'bad_response');
  return rows[0] as CloudRow;
}

export async function deleteBackup(accessToken: string, userId: string): Promise<void> {
  await request('DELETE', '/rest/v1/timetables?user_id=eq.' + encodeURIComponent(userId), { token: accessToken });
}

/** 调自己的 Edge Function（比如删号）。函数名走白名单，避免拼出别的路径 */
export async function callFunction(name: string, accessToken: string, body: unknown): Promise<unknown> {
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(name)) throw new CloudError('函数名不合法', 0, 'bad_name');
  return request('POST', '/functions/v1/' + name, { token: accessToken, body: body === undefined ? {} : body, timeoutMs: 30000 });
}
