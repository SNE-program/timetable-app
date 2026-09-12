import { describe, expect, it } from 'vitest';
import { friendlyLinkError, parseAuthLink, readParams } from './link';

/**
 * 邮件回跳链接的解析。
 *
 * 这一段是「找回密码」能不能走通的关键：Supabase 把凭据放在 URL 的 fragment 里，
 * 前端不认它，用户点了邮件回来就还是未登录状态。
 */
describe('回跳参数读取', function () {
  it('fragment 与 query 都能读，fragment 优先', function () {
    expect(readParams('#a=1&b=2')).toEqual({ a: '1', b: '2' });
    expect(readParams('', '?x=9')).toEqual({ x: '9' });
    expect(readParams('#a=1', '?a=2')).toEqual({ a: '1' });
  });

  it('带百分号转义与加号的值能还原', function () {
    expect(readParams('#msg=%E9%82%AE%E7%AE%B1+%E5%B7%B2%E7%A1%AE%E8%AE%A4').msg).toBe('邮箱 已确认');
  });

  it('空串与畸形输入不抛异常', function () {
    expect(readParams('')).toEqual({});
    expect(readParams('#')).toEqual({});
    expect(readParams('#=x&y')).toEqual({ '': 'x', y: '' });
  });
});

describe('解析登录回跳', function () {
  it('带令牌时给出会话，并留出刷新余量', function () {
    const r = parseAuthLink('#access_token=at&refresh_token=rt&expires_in=3600&type=recovery');
    expect(r.kind).toBe('session');
    expect(r.type).toBe('recovery');
    expect(r.session ? r.session.accessToken : '').toBe('at');
    expect(r.session ? r.session.refreshToken : '').toBe('rt');
    const left = (r.session ? r.session.expiresAt : 0) - Date.now();
    expect(left).toBeGreaterThan(3500 * 1000);
    expect(left).toBeLessThan(3600 * 1000);
  });

  it('不认识的 fragment 当没发生', function () {
    expect(parseAuthLink('').kind).toBe('none');
    expect(parseAuthLink('#random=1').kind).toBe('none');
    expect(parseAuthLink('#access_token=at').kind).toBe('none');
  });

  it('链接过期的错误码翻成人话', function () {
    const r = parseAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(r.kind).toBe('error');
    expect(r.message).toContain('链接已经失效');
  });

  it('被取消 / 已使用的链接也说得清', function () {
    expect(friendlyLinkError('access_denied', '')).toContain('用过了');
    expect(friendlyLinkError('user_banned', '')).toContain('停用');
  });

  it('PKCE 流程的 code 不会当成令牌', function () {
    const r = parseAuthLink('?code=abc123');
    expect(r.kind).toBe('error');
    expect(r.message).toContain('PKCE');
  });
});
