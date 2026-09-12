import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 后备存储（localStorage）上的**写入合并**。
 *
 * 为什么专门测它：网页版没有 SQLite，素材全部落在 localStorage 里，
 * 而 `lsSave` 是**整表重写**（把内存里所有图片拼成一个 JSON）。
 * 导入一个角色是连着四次 putAsset —— 合并之前就是同一份几 MB 的字符串拼四遍、写四遍，
 * 网页版上这一步是肉眼可见的卡顿，而且每次都在顶 localStorage 那约 5 MB 的配额。
 *
 * 这里钉住三件事：同一轮只写一次；一个宏任务之后确实落了盘；页面要走时立刻写完。
 */
const store = new Map<string, string>();
const writes: string[] = [];
let handlers: Record<string, (() => void)[]> = {};

function reset(): void {
  store.clear();
  writes.length = 0;
  handlers = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: function (k: string) { return store.has(k) ? String(store.get(k)) : null; },
    setItem: function (k: string, v: string) { writes.push(k); store.set(k, String(v)); },
    removeItem: function (k: string) { store.delete(k); },
  };
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: function (name: string, fn: () => void) {
      handlers[name] = (handlers[name] || []).concat([fn]);
    },
  };
  (globalThis as unknown as { document: unknown }).document = { visibilityState: 'visible' };
}

async function load(): Promise<typeof import('./index')> {
  vi.resetModules();
  return import('./index');
}

beforeEach(reset);

describe('素材落盘', function () {
  it('★ 一次导入里的多张图只整表重写一次', async function () {
    const s = await load();
    s.__resetAssetsForTest();
    await s.initStorage();
    expect(s.assetBackend()).toBe('localStorage');

    writes.length = 0;
    s.putAsset('a', 'data:image/png;base64,' + 'a'.repeat(200000));
    s.putAsset('b', 'data:image/png;base64,' + 'b'.repeat(200000));
    s.putAsset('c', 'data:image/png;base64,' + 'c'.repeat(200000));
    /* 同步阶段一次都没写 —— 这正是"不再重写三遍"的意思 */
    expect(writes.length).toBe(0);

    /* 让出宏任务之后，恰好写一次，而且三张图都在里面 */
    await new Promise(function (r) { setTimeout(r, 5); });
    expect(writes.length).toBe(1);
    const saved = JSON.parse(store.get('timetable.assets.v1') || '{}');
    expect(Object.keys(saved).sort()).toEqual(['a', 'b', 'c']);
    expect(s.getAsset('a')).toContain('data:image/png');
  });

  it('★ 页面转入后台 / 即将卸载时立刻补写（晚一个宏任务不能变成丢数据）', async function () {
    const s = await load();
    s.__resetAssetsForTest();
    await s.initStorage();

    writes.length = 0;
    s.putAsset('x', 'data:image/png;base64,' + 'x'.repeat(1000));
    expect(writes.length).toBe(0);
    /* 模拟 pagehide：必须当场写完 */
    (handlers['pagehide'] || []).forEach(function (fn) { fn(); });
    expect(writes.length).toBe(1);
    const saved = JSON.parse(store.get('timetable.assets.v1') || '{}');
    expect(saved.x).toBeTruthy();
  });

  it('删除也是合并的，并且会和新增并进同一次写入', async function () {
    const s = await load();
    s.__resetAssetsForTest();
    await s.initStorage();
    /* 先把 a 落盘 */
    s.putAsset('a', 'data:image/png;base64,aaa');
    await new Promise(function (r) { setTimeout(r, 5); });
    writes.length = 0;
    s.deleteAsset('a');
    s.putAsset('b', 'data:image/png;base64,bbb');
    expect(writes.length).toBe(0);
    await new Promise(function (r) { setTimeout(r, 5); });
    expect(writes.length).toBe(1);
    const saved = JSON.parse(store.get('timetable.assets.v1') || '{}');
    expect(saved.a).toBeUndefined();
    expect(saved.b).toBeTruthy();
  });
});
