import { CloudError, refreshSession, type CloudSession } from './client';

/**
 * 登录状态的本地保管。
 *
 * 只存在本机（localStorage），键名单独一个，清掉它等于"退出登录"。
 * 令牌有有效期，过期前 60 秒自动刷新一次 —— 判断放在 client 里做（toSession 已经扣掉 60 秒），
 * 这里只负责"存、取、清"。
 */
export const CLOUD_KEY = 'timetable.cloud.v1';

export function loadSession(): CloudSession | null {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CloudSession;
    if (!s || typeof s !== 'object') return null;
    if (!s.accessToken || !s.refreshToken || !s.user || !s.user.id) return null;
    return s;
  } catch (e) {
    return null;
  }
}

export function saveSession(session: CloudSession | null): void {
  try {
    if (!session) localStorage.removeItem(CLOUD_KEY);
    else localStorage.setItem(CLOUD_KEY, JSON.stringify(session));
  } catch (e) { /* 存不进去不影响本次会话 */ }
}

/**
 * 拿一个当下可用的 access token；过期就用 refresh token 换一个。
 * 换不回来（被撤销 / 被删号）时抛 CloudError，调用方负责把登录状态清掉并如实提示。
 */
export async function freshToken(session: CloudSession): Promise<CloudSession> {
  if (Date.now() < session.expiresAt) return session;
  try {
    return await refreshSession(session.refreshToken);
  } catch (e) {
    const err = e as CloudError;
    if (err && (err.status === 400 || err.status === 401)) {
      throw new CloudError('登录已过期，请重新登录', 401, 'session_expired');
    }
    throw e;
  }
}
