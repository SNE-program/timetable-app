import { beforeEach, describe, expect, it } from 'vitest';
/*
 * 用 Vite 的 ?raw 把示例插件包当字符串读进来，而不是 node:fs ——
 * 引 @types/node 会让 tsc 认下 Buffer 这类 Node 专有全局，
 * 之前正是一个跑在单测里、真机上必崩的 Buffer 藏了很久才被发现。
 * 类型闸门不能为了图方便放宽。
 */
import EXAMPLE_PLUGIN from '../../examples/plugin-teacher-contact.tbplugin.json?raw';
import {
  HOST_API_VERSION, activeCommands, activeExports, grantPermissions, installPlugin, isPluginActive,
  lastLoadIssues, listPlugins, parseManifest, resetPlugins, setPluginEnabled, uninstallPlugin,
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
/* =========================== v1.9.6：接口版本、复校验、命令 =========================== */

/*
 * 这一批用例对应审查里查出的问题：
 *   1. 存起来的清单在读取时没有复校验 —— 篡改或旧版残留可以绕过安装期的那些规则；
 *   2. 清单里没有接口版本，应用升级之后「按新版写的插件」会以莫名其妙的方式失败；
 *   3. 插件除了导出菜单里一行字之外，没有任何能被用户主动触发的东西（现在有了命令）。
 */

describe('插件接口版本', function () {
  function pack(over: Record<string, unknown>): string {
    return JSON.stringify(Object.assign({
      format: 'timetable-plugin', version: 1, id: 'test.api', name: '测试',
      permissions: ['read:timetable'],
      capabilities: [{ type: 'export', id: 'e1', name: 'CSV', format: 'csv', scope: 'week', columns: ['course'] }],
    }, over));
  }

  it('不写 apiVersion 视为 1，能装', function () {
    const r = parseManifest(pack({}));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.apiVersion).toBe(1);
  });

  it('比宿主新的接口版本直接拒，并说清为什么', function () {
    const r = parseManifest(pack({ apiVersion: HOST_API_VERSION + 1, id: 'test.future' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('更新版本的应用');
  });

  it('apiVersion 不是正整数就拒', function () {
    for (const bad of [0, -1, '1']) {
      expect(parseManifest(pack({ apiVersion: bad, id: 'test.bad' })).ok).toBe(false);
    }
  });

  it('minAppVersion 只做格式校验（版本比较留给界面）', function () {
    expect(parseManifest(pack({ minAppVersion: '1.10.0', id: 'test.min' })).ok).toBe(true);
    expect(parseManifest(pack({ minAppVersion: '最新版', id: 'test.min2' })).ok).toBe(false);
  });
});

describe('读取时复校验', function () {
  it('被篡改的已装清单在读出来时被丢掉，并记一条原因', function () {
    localStorage.setItem('timetable.plugins.v1', JSON.stringify({
      installed: [{ format: 'timetable-plugin', version: 1, id: 'evil', name: '坏的', permissions: [], capabilities: [] }],
      disabled: [], granted: {},
    }));
    expect(listPlugins().some(function (p) { return p.manifest.id === 'evil'; })).toBe(false);
    expect(lastLoadIssues().length).toBeGreaterThan(0);
  });

  it('正常清单读出来仍然有效', function () {
    localStorage.setItem('timetable.plugins.v1', JSON.stringify({
      installed: [{
        format: 'timetable-plugin', version: 1, id: 'test.good', name: '好的',
        permissions: ['read:timetable'],
        capabilities: [{ type: 'export', id: 'e1', name: 'CSV', format: 'csv', scope: 'week', columns: ['course'] }],
      }],
      disabled: [], granted: { 'test.good': ['read:timetable'] },
    }));
    const hit = listPlugins().filter(function (p) { return p.manifest.id === 'test.good'; })[0];
    expect(hit).toBeTruthy();
    expect(isPluginActive(hit)).toBe(true);
  });
});

describe('命令能力', function () {
  function withCommand(cmd: Record<string, unknown>): string {
    return JSON.stringify({
      format: 'timetable-plugin', version: 1, id: 'test.cmd', name: '命令插件',
      permissions: ['read:timetable'],
      capabilities: [
        { type: 'export', id: 'e1', name: 'CSV', format: 'csv', scope: 'week', columns: ['course'] },
        cmd,
      ],
    });
  }

  it('合法命令通过，键位原样保留', function () {
    const r = parseManifest(withCommand({ type: 'command', id: 'c1', name: '导出本周', action: { kind: 'export', capabilityId: 'e1' }, keys: ['mod+shift+e'] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.manifest.capabilities[1];
      expect(c.type).toBe('command');
      if (c.type === 'command') expect(c.keys).toEqual(['mod+shift+e']);
    }
  });

  it('动作指向不存在的能力 → 拒（否则就是点不动的菜单项）', function () {
    const r = parseManifest(withCommand({ type: 'command', id: 'c1', name: 'x', action: { kind: 'export', capabilityId: 'nope' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('不存在');
  });

  it('动作类型只允许 export —— 塞一段代码进来是不行的', function () {
    const r = parseManifest(withCommand({ type: 'command', id: 'c1', name: 'x', action: { kind: 'eval', code: 'alert(1)' } }));
    expect(r.ok).toBe(false);
  });

  it('键位写法不对就拒（免得把命令表搞坏）', function () {
    const r = parseManifest(withCommand({ type: 'command', id: 'c1', name: 'x', action: { kind: 'export', capabilityId: 'e1' }, keys: ['Ctrl+Shift+E'] }));
    expect(r.ok).toBe(false);
  });

  it('命令本身也要声明权限', function () {
    const text = JSON.stringify({
      format: 'timetable-plugin', version: 1, id: 'test.cmd2', name: 'x',
      permissions: [],
      capabilities: [
        { type: 'export', id: 'e1', name: 'CSV', format: 'csv', scope: 'week', columns: ['course'] },
        { type: 'command', id: 'c1', name: '导出', action: { kind: 'export', capabilityId: 'e1' } },
      ],
    });
    expect(parseManifest(text).ok).toBe(false);
  });

  it('停用或撤权之后命令立刻从 activeCommands 里消失', function () {
    const text = withCommand({ type: 'command', id: 'c1', name: '导出本周', action: { kind: 'export', capabilityId: 'e1' } });
    expect(installPlugin(text, ['read:timetable']).ok).toBe(true);
    expect(activeCommands().some(function (c) { return c.pluginId === 'test.cmd'; })).toBe(true);
    grantPermissions('test.cmd', []);
    expect(activeCommands().some(function (c) { return c.pluginId === 'test.cmd'; })).toBe(false);
    grantPermissions('test.cmd', ['read:timetable']);
    setPluginEnabled('test.cmd', false);
    expect(activeCommands().some(function (c) { return c.pluginId === 'test.cmd'; })).toBe(false);
  });
});
/* =========================== v1.9.8：更大的自由度 =========================== */

/*
 * 这一批用例对应"插件还能自由到什么程度"这件事的答案：
 * 它依然不执行任何代码，但**可声明的范围与格式都变宽了**：
 *   格式 csv / markdown / json / text；范围 周 / 今天 / 整学期 / 课程 / 任务 / 考勤；
 *   列也按范围分了三组（课表列、任务列、考勤列）。
 * 关键是"装不上的组合"要在安装时就被拒 —— 否则用户拿到的是满列空白，只会觉得插件坏了。
 */

describe('导出范围与格式的扩展', function () {
  function exportsWith(over: Record<string, unknown>): string {
    return JSON.stringify({
      format: 'timetable-plugin', version: 1, id: 'test.wide', name: '宽插件',
      permissions: ['read:timetable'],
      capabilities: [Object.assign({
        type: 'export', id: 'e1', name: '导出', format: 'csv', scope: 'week', columns: ['course'],
      }, over)],
    });
  }

  it('四种格式都收：csv / markdown / json / text', function () {
    for (const f of ['csv', 'markdown', 'json', 'text']) {
      expect(parseManifest(exportsWith({ format: f })).ok).toBe(true);
    }
    expect(parseManifest(exportsWith({ format: 'xlsx' })).ok).toBe(false);
  });

  it('六个范围都收：周 / 今天 / 整学期 / 课程 / 任务 / 考勤', function () {
    expect(parseManifest(exportsWith({ scope: 'day', columns: ['course'] })).ok).toBe(true);
    expect(parseManifest(exportsWith({ scope: 'tasks', columns: ['task', 'due', 'done'] })).ok).toBe(true);
    expect(parseManifest(exportsWith({ scope: 'attendance', columns: ['date', 'course', 'status'] })).ok).toBe(true);
    expect(parseManifest(exportsWith({ scope: 'month', columns: ['course'] })).ok).toBe(false);
  });

  it('列必须在这个范围里有意义：任务清单选「教室」会被拒，并告诉它能用哪些', function () {
    const r = parseManifest(exportsWith({ scope: 'tasks', columns: ['task', 'location'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('location');
      expect(r.error).toContain('task');   /* 提示里给出可用列，装不上也知道该怎么改 */
    }
  });

  it('考勤范围认识 status，课表范围不认识', function () {
    expect(parseManifest(exportsWith({ scope: 'attendance', columns: ['status'] })).ok).toBe(true);
    expect(parseManifest(exportsWith({ scope: 'week', columns: ['status'] })).ok).toBe(false);
  });

  it('可以指定导出文件名（不含扩展名）', function () {
    const r = parseManifest(exportsWith({ fileName: '我的课表-备份' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.manifest.capabilities[0];
      expect(c.type === 'export' ? c.fileName : '').toBe('我的课表-备份');
    }
  });
});
