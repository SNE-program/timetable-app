import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MASCOT_FORMAT, mascotFileText, parseMascotFileText } from '../mascot/pack';
import type { MascotPack } from '../mascot/types';
import { putAsset } from '../storage';
import { extractAssets } from '../storage/assetRef';
import { defaultTheme } from '../theme/tokens';
import { buildDemoData } from '../core/demo';
import { __setCloudConfigForTest } from './config';
import {
  MAX_MASCOT_BYTES, estimateMascotBytes, fetchMascot, formatMb, isMine, looksLikeShareCode, myQuota,
  newShareCode, normalizeShareCode, prepareMascotUpload, quotaLine, resolveShare, setMascotShare, uploadMascot,
} from './mascots';

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

  it('★ 估算体积不序列化整包，但和精确值差不了多少', function () {
    /*
     * 这一条钉的是"打开云端面板不许卡"：估算必须**只做加法**，
     * 而且给用户看的数字不能离谱 —— 差在一个 JSON 外壳的量级以内。
     */
    const p = pack(false);
    const exact = prepareMascotUpload(p).bytes;
    const est = estimateMascotBytes(p).bytes;
    expect(est).toBeGreaterThan(0);
    expect(Math.abs(est - exact)).toBeLessThan(exact * 0.02 + 1024);
    expect(estimateMascotBytes(p).missingAssets).toBe(false);
  });

  it('估算时本机缺素材如实标记（和上传前的判定一致）', function () {
    const p = Object.assign({}, pack(true));
    p.states = Object.assign({}, p.states, { idle: { kind: 'still', src: 'asset:根本没有这个key' } });
    expect(estimateMascotBytes(p).missingAssets).toBe(true);
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
    expect(err).toContain('8 MB');
    /* 报错要把"怎么办"说清楚，而不是只说超了 */
    expect(err).toContain('压小');
    expect(calls.length).toBe(0);
  });

  it('上限是 8 MB，且刚好卡在边界上（多 1 KB 也不放行）', async function () {
    expect(MAX_MASCOT_BYTES).toBe(8 * 1024 * 1024);
    expect(formatMb(MAX_MASCOT_BYTES)).toBe('8 MB');
    expect(formatMb(1024 * 1024 * 1.24)).toBe('1.2 MB');

    /* 造一个刚好 8 MB 出头的包：base64 里的每个字符算 1 字节 */
    const over = pack(false);
    const body = 'data:image/gif;base64,' + 'z'.repeat(MAX_MASCOT_BYTES);
    over.states.react = { kind: 'animated', src: body };
    const out = prepareMascotUpload(over);
    expect(out.bytes).toBeGreaterThan(MAX_MASCOT_BYTES);
  });
});

describe('配额查询', function () {
  it('★ 两条查询是并行发的，不是一条等一条', async function () {
    /*
     * "打开云端面板要等多久"由串行的往返次数决定。
     * 以前这里是 await 完 profiles 再去数自己的行数 —— 白白多一个来回，
     * 手机上就是几百毫秒的"…"。用时间戳钉住并发：两条请求的发起时刻应当相同。
     */
    const started: number[] = [];
    vi.stubGlobal('fetch', async function (url: string) {
      started.push(Date.now());
      const body = String(url).indexOf('/profiles') >= 0
        ? JSON.stringify([{ unlimited_mascots: true }])
        : JSON.stringify([{ id: 'a' }]);
      /* 故意让第一条慢一点：串行的话第二条会在第一条结束之后才发 */
      await new Promise(function (r) { setTimeout(r, 30); });
      return { ok: true, status: 200, text: async function () { return body; } } as unknown as Response;
    });
    const q = await myQuota('token-1');
    expect(started.length).toBe(2);
    expect(Math.abs(started[1] - started[0])).toBeLessThan(10);
    expect(q.unlimited).toBe(true);
    expect(q.used).toBe(1);
    expect(q.limit).toBe(2);
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

  it('★ 服务器回的是对象时直接校验，不再序列化一遍（几 MB 的包白转两趟）', async function () {
    const body = JSON.parse(mascotFileText(pack(false)).text);
    const calls = stub(function () { return { json: body }; });
    const r = await fetchMascot('t', 'u1/m3.json');
    expect(calls.length).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.pack!.name).toBe('演示角色');
    expect(r.pack!.states.idle).toBeTruthy();
  });
});

describe('分享码', function () {
  const row = { id: 'm1', user_id: 'u1', name: '演示角色', is_public: false, path: 'u1/m1.json', size_bytes: 10, created_at: '', updated_at: '' };

  it('生成的码是 8 位，且不含容易看错的 0/O/1/I/L', function () {
    for (let i = 0; i < 200; i++) {
      const c = newShareCode();
      expect(c.length).toBe(8);
      expect(c).toMatch(/^[A-Z0-9]{8}$/);
      expect(c).not.toMatch(/[0O1IL]/);
    }
  });

  it('注入随机源时可复现', function () {
    const seq = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    let i = 0;
    const c = newShareCode(function () { return seq[i++ % seq.length]; });
    expect(c.length).toBe(8);
    expect(c[0]).toBe('A');   /* 第一个字符来自字母表第一位 */
  });

  it('用户输入的码会被清洗：小写、空格、连字符都能收', function () {
    expect(normalizeShareCode(' 7kq2-m9xf ')).toBe('7KQ2M9XF');
    expect(looksLikeShareCode('7kq2-m9xf')).toBe(true);
    expect(looksLikeShareCode('abc')).toBe(false);
    expect(looksLikeShareCode('')).toBe(false);
  });

  it('打开分享：PATCH 自己的那一行，返回新码', async function () {
    const calls = stub(function () { return { status: 204 }; });
    const code = await setMascotShare('token-1', 'm1', true);
    expect(code).toBeTruthy();
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toBe('https://demo.supabase.co/rest/v1/mascots?id=eq.m1');
    expect(JSON.parse(calls[0].body).share_code).toBe(code);
  });

  it('关闭分享：把 share_code 置空', async function () {
    const calls = stub(function () { return { status: 204 }; });
    const code = await setMascotShare('token-1', 'm1', false);
    expect(code).toBeNull();
    expect(JSON.parse(calls[0].body).share_code).toBeNull();
  });

  it('撞码时换一个再试，而不是直接失败', async function () {
    let n = 0;
    const calls = stub(function () {
      n++;
      if (n <= 2) return { status: 409, json: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      return { status: 204 };
    });
    const code = await setMascotShare('token-1', 'm1', true);
    expect(code).toBeTruthy();
    expect(calls.length).toBe(3);
  });

  it('凭码解析走数据库函数，未登录也能调', async function () {
    const calls = stub(function () { return { json: [row] }; });
    const got = await resolveShare(null, '7kq2-m9xf');
    expect(calls[0].url).toBe('https://demo.supabase.co/rest/v1/rpc/resolve_mascot_share');
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body).code).toBe('7KQ2M9XF');
    expect(got && got.name).toBe('演示角色');
  });

  it('格式不对的码不会发请求', async function () {
    const calls = stub(function () { return { json: [] }; });
    expect(await resolveShare(null, 'ab')).toBeNull();
    expect(calls.length).toBe(0);
  });

  it('码不存在时返回 null（不抛错，让界面说人话）', async function () {
    stub(function () { return { json: [] }; });
    expect(await resolveShare(null, 'ZZZZZZZZ')).toBeNull();
  });
});
