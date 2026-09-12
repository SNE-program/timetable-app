import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MASCOT_FORMAT, mascotFileText, parseMascotFileText } from '../mascot/pack';
import type { MascotPack } from '../mascot/types';
import { putAsset } from '../storage';
import { extractAssets } from '../storage/assetRef';
import { defaultTheme } from '../theme/tokens';
import { buildDemoData } from '../core/demo';
import { __setCloudConfigForTest } from './config';
import { MAX_MASCOT_BYTES, isMine, prepareMascotUpload, quotaLine, uploadMascot, fetchMascot } from './mascots';

/**
 * 云端角色：**一个真实网络请求都不发**（fetch 全被换掉）。
 *
 * 这里要钉死的是三件事：
 *   1. 上传前必须把 asset:<key> 引用还原成真图 —— 不还原的话，别人下载到的是
 *      "有角色、全是空图"，而本机看起来一切正常，这类 bug 极难被发现；
 *   2. 上传是两步（Storage + 数据库行），**第二步失败必须把第一步的文件删掉**，
 *      否则占着空间却不在列表里，用户删无可删；
 *   4. 配额、公开状态这些判定在服务端，客户端只负责"提前说清楚"。
 */

function pack(withRefs: boolean): MascotPack {
  const big = 'data:image/webp;base64,' + 'i'.repeat(5000);
  const base: MascotPack = {
    format: MASCOT_FORMAT, version: 1, id: 'demo', name: '演示角色', height: 140,
    states: {
      idle: { kind: 'still', src: big },
      react: { kind: 'animated', src: 'data:image/gif;base64,' + 'r'.repeat(200) },
    },
    motion: { breathe: 0.02, bob: 0.01, sway: 0 },
    interactive: { click: true, drag: true },
    shadow: true,
    anchor: { x: 0.5, y: 1 },
  };
  if (!withRefs) return base;
  /* 走一次真实的外置流程：大图进资产库，包里只留 asset:<key> */
  const ex = extractAssets(defaultTheme(), buildDemoData());
  void ex;
  const r = extractAssets(
    Object.assign({}, defaultTheme(), { wallpaper: Object.assign({}, defaultTheme().wallpaper) }),
    Object.assign({}, buildDemoData(), { courses: [] })
  );
  void r;
  const p = Object.assign({}, base, { states: Object.assign({}, base.states) });
  /* 手工模拟落盘后的形态 */
  const key = 'abc123';
  putAsset(key, big);
  p.states = Object.assign({}, p.states, { idle: { kind: 'still', src: 'asset:' + key } });
  return p;
}

interface Call { url: string; method: string; body: string }
function stub(handler: (call: Call) => { status?: number; json?: unknown; text?: string }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async function (url: string, init: RequestInit) {
    const call: Call = { url: String(url), method: String((init && init.method) || 'GET'), body: String((init && init.body) || '') };
    calls.push(call);
    const r = handler(call);
    const status = r.status === undefined ? 200 : r.status;
    const text = r.text !== undefined ? r.text : (r.json === undefined ? '' : JSON.stringify(r.json));
    return { ok: status >= 200 && status < 300, status: status, text: async function () { return text; } } as unknown as Response;
  });
  return calls;
}

beforeEach(function () {
  __setCloudConfigForTest('https://demo.supabase.co', 'anon-key');
});

describe('角色包的准备', function () {
  it('上传前把 asset 引用还原成真图（否则别人拿到的是空图）', function () {
    const p = pack(true);
    expect(p.states.idle!.src.indexOf('asset:')).toBe(0);
    const out = prepareMascotUpload(p);
    expect(out.text.indexOf('asset:')).toBe(-1);
    expect(out.missingAssets).toBe(false);
    /* 还原出来的仍然是合法角色包 */
    const back = parseMascotFileText(out.text);
    expect(back.ok).toBe(true);
    expect(back.pack!.states.idle!.src.indexOf('data:image/webp')).toBe(0);
  });

  it('素材在本机找不到时如实标记 missingAssets，而不是假装完整', function () {
    const p = Object.assign({}, pack(true));
    p.states = Object.assign({}, p.states, { idle: { kind: 'still', src: 'asset:本机没有这个key' } });
    const out = prepareMascotUpload(p);
    /* hydrateMascot 会把找不到的引用降级成空串，所以必须在还原之前数 key —— 这里就是那条防线 */
    expect(out.missingAssets).toBe(true);
  });

  it('大小与文件正文一致', function () {
    const out = prepareMascotUpload(pack(false));
    const parsed = mascotFileText(pack(false));
    expect(out.bytes).toBe(parsed.bytes);
  });
});

describe('缺素材时拒绝上传', function () {
  it('宁可当场报错，也不上传一个别人下载后是空白的角色', async function () {
    const p = Object.assign({}, pack(true));
    p.states = Object.assign({}, p.states, { idle: { kind: 'still', src: 'asset:不存在' } });
    const calls = stub(function () { return { json: {} }; });
    let err = '';
    try { await uploadMascot('t', 'u1', p, 'x', false); } catch (e) { err = (e as Error).message; }
    expect(err).toContain('素材');
    expect(calls.length).toBe(0);
  });
});

describe('配额与归属的展示', function () {
  it('不设限的账号说明白是"不设限"', function () {
    expect(quotaLine({ used: 5, unlimited: true, limit: 2 })).toContain('不限制');
    expect(quotaLine({ used: 1, unlimited: false, limit: 2 })).toBe('云端角色 1 / 2（每个账号最多 2 个）');
    expect(quotaLine(null)).toBe('');
  });

  it('认得出哪些是自己的', function () {
    const m = { id: 'a', user_id: 'u1', name: 'x', is_public: false, path: 'u1/a.json', size_bytes: 1, created_at: '', updated_at: '' };
    expect(isMine(m, 'u1')).toBe(true);
    expect(isMine(m, 'u2')).toBe(false);
    expect(isMine(m, null)).toBe(false);
  });
});

describe('上传的两步与失败清理', function () {
  const row = { id: 'm1', user_id: 'u1', name: '演示角色', is_public: false, path: 'u1/m1.json', size_bytes: 10, created_at: '', updated_at: '' };

  it('先传文件再写行，路径第一段是自己的 user_id（Storage 策略靠它认人）', async function () {
    const calls = stub(function (c) { return c.url.indexOf('/storage/') >= 0 ? { json: { Key: 'ok' } } : { status: 201, json: [row] }; });
    const out = await uploadMascot('token-1', 'u1', pack(false), '演示角色', false);
    expect(calls.length).toBe(2);
    expect(calls[0].url).toContain('/storage/v1/object/mascots/u1/');
    expect(calls[0].url.endsWith('.json')).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body.indexOf('timetable-mascot')).toBeGreaterThan(0);
    expect(calls[1].url).toBe('https://demo.supabase.co/rest/v1/mascots');
    expect(JSON.parse(calls[1].body)[0].path.indexOf('u1/')).toBe(0);
    expect(out.id).toBe('m1');
  });

  it('写行失败时把刚传的文件删掉（不留孤儿对象）', async function () {
    const calls = stub(function (c) {
      if (c.url.indexOf('/storage/') >= 0 && c.method === 'POST') return { json: { Key: 'ok' } };
      if (c.method === 'DELETE') return { status: 200 };
      return { status: 400, json: { message: '云端角色最多 2 个：先在「我的角色」里删掉一个再上传' } };
    });
    let err = '';
    try { await uploadMascot('token-1', 'u1', pack(false), 'x', false); } catch (e) { err = (e as Error).message; }
    expect(err).toContain('最多 2 个');
    const cleanup = calls.filter(function (c) { return c.method === 'DELETE'; });
    expect(cleanup.length).toBe(1);
    expect(cleanup[0].url).toContain('/storage/v1/object/mascots/u1/');
  });

  it('超过体积上限当场拒绝，连请求都不发', async function () {
    const huge = pack(false);
    huge.states.react = { kind: 'animated', src: 'data:image/gif;base64,' + 'z'.repeat(MAX_MASCOT_BYTES) };
    const calls = stub(function () { return { json: {} }; });
    let err = '';
    try { await uploadMascot('t', 'u1', huge, 'x', false); } catch (e) { err = (e as Error).message; }
    expect(err).toContain('4 MB');
    expect(calls.length).toBe(0);
  });
});

describe('取回角色', function () {
  it('公开角色不带登录令牌也能取（策略放行）', async function () {
    const calls = stub(function () { return { text: mascotFileText(pack(false)).text }; });
    const r = await fetchMascot(null, 'someone/m1.json');
    expect(calls[0].url).toBe('https://demo.supabase.co/storage/v1/object/mascots/someone/m1.json');
    expect(calls[0].method).toBe('GET');
    expect(r.ok).toBe(true);
    expect(r.pack!.name).toBe('演示角色');
  });

  it('路径里的斜杠不会被编码掉（Storage 的对象名就是带斜杠的）', async function () {
    const calls = stub(function () { return { text: '{}' }; });
    await fetchMascot('t', 'u1/m2.json');
    expect(calls[0].url).toContain('/mascots/u1/m2.json');
    expect(calls[0].url.indexOf('%2F')).toBe(-1);
  });
});
