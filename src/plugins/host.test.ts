import { beforeEach, describe, expect, it } from 'vitest';
/*
 * 用 Vite 的 ?raw 把示例插件包当字符串读进来，而不是 node:fs ——
 * 引 @types/node 会让 tsc 认下 Buffer 这类 Node 专有全局，
 * 之前正是一个跑在单测里、真机上必崩的 Buffer 藏了很久才被发现。
 * 类型闸门不能为了图方便放宽。
 */
import EXAMPLE_PLUGIN from '../../examples/plugin-teacher-contact.tbplugin.json?raw';
import {
  activeExports, grantPermissions, installPlugin, isPluginActive, listPlugins,
  parseManifest, resetPlugins, setPluginEnabled, uninstallPlugin,
} from './host';

/* Node 里没有 localStorage，用 Map 顶一个最小实现 */
beforeEach(function () {
  const box = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: function (k: string) { return box.has(k) ? box.get(k)! : null; },
    setItem: function (k: string, v: string) { box.set(k, String(v)); },
    removeItem: function (k: string) { box.delete(k); },
  };
  resetPlugins();
});

function pkg(over: Record<string, unknown> = {}): string {
  return JSON.stringify(Object.assign({
    format: 'timetable-plugin',
    version: 1,
    id: 'test.hello',
    name: '测试插件',
    permissions: ['read:timetable'],
    capabilities: [{
      type: 'export', id: 'e1', name: '测试导出',
      format: 'csv', scope: 'week', columns: ['date', 'course'],
    }],
  }, over));
}

describe('插件清单校验', function () {
  it('合法的包能通过', function () {
    const r = parseManifest(pkg());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.id).toBe('test.hello');
    expect(r.manifest.capabilities.length).toBe(1);
  });

  it('format 不对直接拒绝', function () {
    const r = parseManifest(pkg({ format: 'something-else' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('timetable-plugin');
  });

  it('拒绝不支持的大版本', function () {
    const r = parseManifest(pkg({ version: 9 }));
    expect(r.ok).toBe(false);
  });

  it('id 里的奇怪字符会被挡住', function () {
    expect(parseManifest(pkg({ id: '有中文的 id' })).ok).toBe(false);
    expect(parseManifest(pkg({ id: 'a' })).ok).toBe(false);
    expect(parseManifest(pkg({ id: 'a b' })).ok).toBe(false);
  });

  it('不认识的能力类型会被挡住', function () {
    const r = parseManifest(pkg({ capabilities: [{ type: 'run-arbitrary-code', id: 'x', name: 'x' }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('能力类型');
  });

  it('不认识的列会被挡住', function () {
    const r = parseManifest(pkg({
      capabilities: [{ type: 'export', id: 'e1', name: 'x', format: 'csv', scope: 'week', columns: ['date', 'telepathy'] }],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('不认识的列');
  });

  it('能力没有声明对应权限时拒绝 —— 不允许"偷偷要用"', function () {
    const r = parseManifest(pkg({ permissions: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('read:timetable');
  });

  it('重复的能力 id 会被挡住', function () {
    const r = parseManifest(pkg({
      capabilities: [
        { type: 'export', id: 'same', name: 'a', format: 'csv', scope: 'week', columns: ['date'] },
        { type: 'export', id: 'same', name: 'b', format: 'csv', scope: 'week', columns: ['date'] },
      ],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('重复');
  });

  it('根本不是 JSON 时给出人话错误', function () {
    const r = parseManifest('这不是 json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('JSON');
  });

  it('没有能力的空插件会被拒绝', function () {
    expect(parseManifest(pkg({ capabilities: [] })).ok).toBe(false);
  });
});

describe('插件宿主', function () {
  it('内置插件默认就可用', function () {
    const list = listPlugins();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every(function (p) { return p.builtin; })).toBe(true);
    expect(activeExports().length).toBeGreaterThanOrEqual(4);
  });

  it('安装之后出现在列表里，并且按授权状态决定是否生效', function () {
    expect(installPlugin(pkg(), ['read:timetable']).ok).toBe(true);
    const p = listPlugins().filter(function (x) { return x.manifest.id === 'test.hello'; })[0];
    expect(p).toBeTruthy();
    expect(p.builtin).toBe(false);
    expect(isPluginActive(p)).toBe(true);
    expect(activeExports().some(function (e) { return e.pluginId === 'test.hello'; })).toBe(true);
  });

  it('没授权的能力不生效', function () {
    installPlugin(pkg(), []);
    const p = listPlugins().filter(function (x) { return x.manifest.id === 'test.hello'; })[0];
    expect(isPluginActive(p)).toBe(false);
    expect(activeExports().some(function (e) { return e.pluginId === 'test.hello'; })).toBe(false);
  });

  it('撤销权限后立刻失效', function () {
    installPlugin(pkg(), ['read:timetable']);
    expect(activeExports().some(function (e) { return e.pluginId === 'test.hello'; })).toBe(true);
    grantPermissions('test.hello', []);
    expect(activeExports().some(function (e) { return e.pluginId === 'test.hello'; })).toBe(false);
  });

  it('停用后导出菜单里立刻消失，重新启用又回来', function () {
    installPlugin(pkg(), ['read:timetable']);
    setPluginEnabled('test.hello', false);
    expect(activeExports().some(function (e) { return e.pluginId === 'test.hello'; })).toBe(false);
    setPluginEnabled('test.hello', true);
    expect(activeExports().some(function (e) { return e.pluginId === 'test.hello'; })).toBe(true);
  });

  it('内置插件也能停用，但不能被卸载，也不能被同名覆盖', function () {
    setPluginEnabled('builtin.csv-week', false);
    const p = listPlugins().filter(function (x) { return x.manifest.id === 'builtin.csv-week'; })[0];
    expect(p.enabled).toBe(false);
    expect(activeExports().some(function (e) { return e.pluginId === 'builtin.csv-week'; })).toBe(false);

    uninstallPlugin('builtin.csv-week');
    expect(listPlugins().some(function (x) { return x.manifest.id === 'builtin.csv-week'; })).toBe(true);

    const clash = installPlugin(pkg({ id: 'builtin.csv-week' }), ['read:timetable']);
    expect(clash.ok).toBe(false);
  });

  it('卸载第三方插件后彻底消失', function () {
    installPlugin(pkg(), ['read:timetable']);
    uninstallPlugin('test.hello');
    expect(listPlugins().some(function (x) { return x.manifest.id === 'test.hello'; })).toBe(false);
    expect(activeExports().some(function (e) { return e.pluginId === 'test.hello'; })).toBe(false);
  });

  it('同 id 覆盖安装会替换清单而不是变成两条', function () {
    installPlugin(pkg(), ['read:timetable']);
    installPlugin(pkg({ name: '改过名的插件' }), ['read:timetable']);
    const hits = listPlugins().filter(function (x) { return x.manifest.id === 'test.hello'; });
    expect(hits.length).toBe(1);
    expect(hits[0].manifest.name).toBe('改过名的插件');
  });

  it('localStorage 里存的是坏数据时不崩，退回空状态', function () {
    localStorage.setItem('timetable.plugins.v1', '{ 这不是 json');
    expect(listPlugins().length).toBeGreaterThanOrEqual(3);
  });

  it('仓库里那份示例插件包能真的装上（防止规范文档腐烂）', function () {
    const r = installPlugin(EXAMPLE_PLUGIN, ['read:timetable']);
    expect(r.ok).toBe(true);
    const p = listPlugins().filter(function (x) { return x.manifest.id === 'example.teacher-contact'; })[0];
    expect(p).toBeTruthy();
    expect(p.manifest.capabilities.length).toBe(2);
    /* 装上就该能在导出菜单里看见 */
    const names = activeExports().filter(function (e) { return e.pluginId === 'example.teacher-contact'; })
      .map(function (e) { return e.capability.name; });
    expect(names).toContain('教师联系方式（CSV）');
    expect(names).toContain('按教室查课（Markdown）');
  });

  it('内置插件的每一个能力都能被宿主正确处理', function () {
    for (const e of activeExports()) {
      expect(e.capability.columns.length).toBeGreaterThan(0);
      expect(['csv', 'markdown']).toContain(e.capability.format);
      expect(['week', 'term', 'courses']).toContain(e.capability.scope);
    }
  });
});
