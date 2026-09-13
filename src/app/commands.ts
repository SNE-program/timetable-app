/**
 * 命令表与快捷键。
 *
 * ## 为什么要有"命令"这一层，而不是直接写一堆 if (e.key === ...)
 *
 * 因为快捷键必须**能解释给用户看**。原来键盘处理是 App.tsx 里一段硬编码的 if：
 * 用户没有任何地方能看到"这个应用支持哪些快捷键"—— 快捷键等于不存在，
 * 只有碰巧按到的人才会发现。现在每个动作是一条命令（有标题、有分组、有默认键位），
 * 界面上的「快捷键」一页直接从这张表渲染，代码与说明不可能对不上。
 *
 * 顺带解决第二件事：**插件系统需要一个零代码的扩展点**。
 * 命令表就是那个点 —— 插件未来可以注册一条命令（执行的是宿主已有的声明式动作），
 * 它会自动出现在这一页并可以绑键位，而插件本身仍然不执行任何代码（见 docs/10）。
 */

export type CommandGroup = '基础' | '导航' | '课表' | '帮助';

export interface Command {
  /** 稳定 id（插件注册时用来去重） */
  id: string;
  title: string;
  group: CommandGroup;
  /** 默认键位，形如 'mod+z'、'shift+?'、'arrowleft'、'1' */
  keys?: string[];
  /** 一句话补充（这一页会显示在标题下面） */
  hint?: string;
  /** 只有返回 true 时才拦下这次按键（比如"重做"在没有可重做步骤时不抢键） */
  enabled?: () => boolean;
  run: () => void;
}

const table: Command[] = [];
const used = new Set<string>();

/**
 * 注册一批命令。同 id 只认第一次注册（内置的先注册，插件覆盖不了它们）——
 * 这既是防冲突，也让"谁改了我的键位"这类问题不复存在。
 */
export function registerCommands(list: Command[]): void {
  for (const c of list) {
    if (!c || !c.id || used.has(c.id)) continue;
    used.add(c.id);
    table.push(c);
  }
}

export function allCommands(): Command[] { return table.slice(); }

export function findCommand(id: string): Command | null {
  return table.filter(function (c) { return c.id === id; })[0] || null;
}

/** 执行一条命令；没有这条或它当前不可用则返回 false */
export function runCommand(id: string): boolean {
  const c = findCommand(id);
  if (!c) return false;
  if (c.enabled && !c.enabled()) return false;
  c.run();
  return true;
}

/** 这一页里显示成几组（分组顺序固定，免得每次渲染顺序都在跳） */
export const COMMAND_GROUPS: CommandGroup[] = ['基础', '导航', '课表', '帮助'];

/**
 * 一次按键事件 → 键位串。
 *
 * 规则：修饰键按 ctrl/meta/shift/alt 固定顺序拼；主键用小写；
 * 纯修饰键（只按下 Ctrl）返回 null —— 那种事件不该触发任何命令。
 */
export function comboOf(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string | null {
  const k = keyName(e.key);
  if (!k) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(k);
  return parts.join('+');
}

/** 归一化主键：字母小写、空格写成 space、方向键写成 arrowleft 这种 */
function keyName(key: string): string {
  if (!key) return '';
  if (key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt') return '';
  if (key === ' ') return 'space';
  if (key === 'Escape') return 'escape';
  if (key === '?') return '/';   /* Shift+/ 在多数键盘上就是问号，两者当同一个键 */
  return key.toLowerCase();
}

/**
 * 键位串 → 界面上显示的写法。
 * mac 上把 mod 显示成 ⌘（用户按的就是那个键，写成 Ctrl 会让人以为按错了）。
 */
export function formatCombo(combo: string, mac: boolean): string {
  const map: Record<string, string> = {
    mod: mac ? '⌘' : 'Ctrl', shift: mac ? '⇧' : 'Shift', alt: mac ? '⌥' : 'Alt',
    arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
    space: '空格', escape: 'Esc', enter: '回车', '/': '/', '[': '[', ']': ']',
  };
  return combo.split('+').map(function (p) { return map[p] || p.toUpperCase(); }).join(mac ? '' : ' + ');
}

/**
 * 找出这个键位对应的命令。
 *
 * 精确匹配，不做"模糊"或"前缀"匹配 —— 快捷键错配比没有快捷键更让人恼火。
 * 同一键位被两条命令声明时，**先注册的赢**（内置命令先注册）。
 */
export function matchCommand(combo: string): Command | null {
  for (const c of table) {
    if (!c.keys) continue;
    if (c.keys.indexOf(combo) < 0) continue;
    if (c.enabled && !c.enabled()) continue;
    return c;
  }
  return null;
}

/** 焦点在输入控件里吗（在里面就不抢键：用户可能在打字或做文本编辑） */
export function isTextField(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

/** 仅供测试与热重载：清空命令表 */
export function resetCommands(): void {
  table.length = 0;
  used.clear();
}