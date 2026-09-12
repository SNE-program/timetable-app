import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __setCloudConfigForTest } from '../cloud/config';
import { cloudLoadMascots, getState } from './store';

/*
 * 云端角色的"拉列表"这条路：**一次请求都不该白花**。
 *
 * 这一组用例是被"打开云端角色很卡"逼出来的，钉住三件事：
 *   1. 打开面板时两个入口（openCloudSheet 与面板挂载）都会调 load —— 只能发一轮；
 *   2. 一分钟内重复打开直接用手上那份，不再问服务器；
 *   3. 已有数据时的刷新是**静默**的：不把界面锁成"…"。
 *
 * store 在 Node 里能直接跑（各处的 window / localStorage 都有兜底），
 * 这里补一个最小 window 桩，和 store.undo.test.ts 的做法一致。
 */
beforeEach(function () {
  (globalThis as unknown as { window: unknown }).window = {
    setTimeout: function () { return 0; },
    clearTimeout: function () { /* noop */ },
    location: { search: '', hash: '' },
    addEventListener: function () { /* noop */ },
    removeEventListener: function () { /* noop */ },
  };
  __setCloudConfigForTest('https://demo.supabase.co', 'anon-key');
});

interface Call { url: string; method: string }

function stubList(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async function (url: string, init?: RequestInit) {
    calls.push({ url: String(url), method: String((init && init.method) || 'GET') });
    const rows = [{ id: 'm1', user_id: 'u1', name: '演示角色', is_public: true, path: 'u1/m1.json', size_bytes: 10, created_at: '', updated_at: '' }];
    return { ok: true, status: 200, text: async function () { return JSON.stringify(rows); } } as unknown as Response;
  });
  return calls;
}

describe('云端角色列表的拉取', function () {
  it('★ 同时调两次只发一轮请求；一分钟内再调一次不发请求；强制刷新才再发', async function () {
    const calls = stubList();
    /* 未登录：只查公开列表，一轮 = 一条请求（登录后配额那两条是并行的，见 mascots.test.ts） */
    /* 并发去重的判据是"只发了一轮请求"，不是 promise 是不是同一个对象 */
    const a = cloudLoadMascots();
    const b = cloudLoadMascots();
    await Promise.all([a, b]);
    const after1 = calls.length;
    expect(after1).toBe(1);
    expect(getState().cloud.mascots.length).toBe(1);
    expect(getState().cloud.mascotsLoaded).toBe(true);

    /* 一分钟内：用手上这份 */
    await cloudLoadMascots();
    expect(calls.length).toBe(after1);

    /* 手动刷新（面板上的「刷新」按钮走的就是这个）会真的再发一次 */
    await cloudLoadMascots(true);
    expect(calls.length).toBe(after1 + 1);
  });

  it('★ 已经有数据时的刷新是静默的：不会把界面锁成"…"', async function () {
    stubList();
    await cloudLoadMascots(true);
    expect(getState().cloud.mascotsStage).toBe('');
  });

  it('拉失败时把话说清楚，并且不会一直卡在"读取中"', async function () {
    vi.stubGlobal('fetch', async function () { throw new Error('failed to fetch'); });
    await cloudLoadMascots(true);
    const c = getState().cloud;
    expect(c.mascotsStage).toBe('');
    expect(c.mascotsError).not.toBe('');
    expect(c.mascotsLoaded).toBe(true);
  });
});
