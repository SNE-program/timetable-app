import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CloudError, callFunction, deleteBackup, fetchBackup, fetchMe, saveBackup, sendRecover, signIn, signOut,
  signUp, updatePassword,
} from './client';
import { __setCloudConfigForTest } from './config';

/**
 * 请求层的测试：**一个真实的网络请求都不发**。
 *
 * 做法是把全局 fetch 换成一个记录器 —— 于是既能断言"发到哪个地址、带什么头"，
 * 也能断言"错误有没有被翻成人话"。云功能的失败大多发生在这些地方，
 * 而不是在界面里：地址拼错、少了 apikey、把 401 当成普通错误吞掉。
 */

interface Call { url: string; method: string; headers: Record<string, string>; body: string }

function stub(handler: (call: Call) => { status?: number; json?: unknown; text?: string }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async function (url: string, init: RequestInit) {
    const call: Call = {
      url: String(url),
      method: String((init && init.method) || 'GET'),
      headers: ((init && init.headers) || {}) as Record<string, string>,
      body: String((init && init.body) || ''),
    };
    calls.push(call);
    const r = handler(call);
    const status = r.status === undefined ? 200 : r.status;
    const text = r.text !== undefined ? r.text : (r.json === undefined ? '' : JSON.stringify(r.json));
    return {
      ok: status >= 200 && status < 300,
      status: status,
      text: async function () { return text; },
    } as unknown as Response;
  });
  return calls;
}

beforeEach(function () {
  __setCloudConfigForTest('https://demo.supabase.co', 'anon-key-for-test');
});

describe('云备份请求层', function () {
  it('登录：POST 到 token 端点，带 anon key，返回会话', async function () {
    const calls = stub(function () {
      return { json: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, user: { id: 'u1', email: 'a@b.c' } } };
    });
    const s = await signIn('a@b.c', 'secret123');
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://demo.supabase.co/auth/v1/token?grant_type=password');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.apikey).toBe('anon-key-for-test');
    expect(JSON.parse(calls[0].body)).toEqual({ email: 'a@b.c', password: 'secret123' });
    expect(s.accessToken).toBe('at');
    expect(s.user.email).toBe('a@b.c');
    /* 过期时间要留出余量：expires_in 3600 秒 → 实际按 3540 秒算 */
    expect(s.expiresAt - Date.now()).toBeGreaterThan(3500 * 1000);
  });

  it('注册：服务器没给 access_token 时返回 null（邮箱确认开着就是这个结果）', async function () {
    stub(function () { return { json: { user: { id: 'u1', email: 'a@b.c' }, session: null } }; });
    expect(await signUp('a@b.c', 'secret123')).toBe(null);
  });

  it('英文报错翻成人话', async function () {
    stub(function () { return { status: 400, json: { error_code: 'invalid_credentials', message: 'Invalid login credentials' } }; });
    await expect(signIn('a@b.c', 'x')).rejects.toThrow('邮箱或密码不对');

    stub(function () { return { status: 400, json: { message: 'Email not confirmed' } }; });
    await expect(signIn('a@b.c', 'x')).rejects.toThrow('这个邮箱还没确认');

    stub(function () { return { status: 422, json: { message: 'User already registered' } }; });
    await expect(signUp('a@b.c', 'x')).rejects.toThrow('已经注册过了');
  });

  it('不像句子的响应正文不会被原样甩给用户', async function () {
    /* 真实踩到的：本地假服务器回 404 + 正文 no，界面就显示了一个 "no" */
    stub(function () { return { status: 404, text: 'no' }; });
    await expect(signIn('a@b.c', 'x')).rejects.toThrow('接口地址不对（404）');

    stub(function () { return { status: 500, text: 'boom' }; });
    await expect(signIn('a@b.c', 'x')).rejects.toThrow('请求失败（HTTP 500）：boom');

    stub(function () { return { status: 400, text: 'Password should be different from the old password' }; });
    await expect(signIn('a@b.c', 'x')).rejects.toThrow('Password should be different');
  });

  it('网络层失败也是人话，且带上 network 标记', async function () {
    vi.stubGlobal('fetch', async function () { throw new Error('Failed to fetch'); });
    let err: CloudError | null = null;
    try { await signIn('a@b.c', 'x'); } catch (e) { err = e as CloudError; }
    expect(err).toBeInstanceOf(CloudError);
    expect(err ? err.message : '').toBe('连不上服务器，检查一下网络');
    expect(err ? err.code : '').toBe('network');
  });

  it('保存备份：POST + merge-duplicates（同一个账号永远只有一行）', async function () {
    const calls = stub(function () { return { status: 201, json: [{ user_id: 'u1', updated_at: '2026-09-12T00:00:00Z' }] }; });
    await saveBackup('token-1', 'u1', { format: 'timetable-backup' }, '1.6.0', 'Windows');
    expect(calls[0].url).toBe('https://demo.supabase.co/rest/v1/timetables');
    expect(calls[0].headers.Prefer).toContain('merge-duplicates');
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(calls[0].body)[0].user_id).toBe('u1');
  });

  it('读备份：没数据时返回 null 而不是抛异常', async function () {
    stub(function () { return { json: [] }; });
    expect(await fetchBackup('t')).toBe(null);
  });

  it('删除备份：按 user_id 过滤，且做了转义', async function () {
    const calls = stub(function () { return { status: 204 }; });
    await deleteBackup('t', 'u1');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('https://demo.supabase.co/rest/v1/timetables?user_id=eq.u1');
  });

  it('退出登录：服务器报错也不该让本地退出失败', async function () {
    stub(function () { return { status: 500, text: 'boom' }; });
    await expect(signOut('t')).resolves.toBeUndefined();
  });

  it('改密码：PUT /auth/v1/user，带用户令牌', async function () {
    const calls = stub(function () { return { json: {} }; });
    await updatePassword('token-1', 'newpassword');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://demo.supabase.co/auth/v1/user');
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(calls[0].body)).toEqual({ password: 'newpassword' });
  });

  it('读当前用户：拿到邮箱', async function () {
    stub(function () { return { json: { id: 'u1', email: 'a@b.c' } }; });
    const me = await fetchMe('t');
    expect(me).toEqual({ id: 'u1', email: 'a@b.c' });
  });

  it('找回密码：带上重定向地址', async function () {
    const calls = stub(function () { return { json: {} }; });
    await sendRecover('a@b.c', 'https://example.com/app/');
    expect(calls[0].url).toBe('https://demo.supabase.co/auth/v1/recover?redirect_to=' + encodeURIComponent('https://example.com/app/'));
  });

  it('Edge Function：函数名走白名单', async function () {
    const calls = stub(function () { return { json: { ok: true } }; });
    await callFunction('send-mail', 't', { subject: 'x' });
    expect(calls[0].url).toBe('https://demo.supabase.co/functions/v1/send-mail');
    await expect(callFunction('../../evil', 't', {})).rejects.toThrow('函数名不合法');
    await expect(callFunction('BAD NAME', 't', {})).rejects.toThrow('函数名不合法');
  });

  it('没配置时一个请求都不发', async function () {
    __setCloudConfigForTest('', '');
    const calls = stub(function () { return { json: {} }; });
    await expect(signIn('a@b.c', 'x')).rejects.toThrow('没有配置云备份');
    expect(calls.length).toBe(0);
  });
});
