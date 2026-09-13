import { beforeEach, describe, expect, it } from 'vitest';
import {
  COMMAND_GROUPS, allCommands, comboOf, findCommand, formatCombo, isTextField, matchCommand,
  registerCommands, resetCommands, runCommand, type Command,
} from './commands';

/**
 * 命令表与快捷键。
 *
 * 这一层存在的意义是"快捷键可以被解释给用户看"：界面上的快捷键一页直接读这张表。
 * 所以测的重点是**匹配规则**与**去重规则** —— 匹配错了是"按了没反应"或"按了做错事"，
 * 去重错了是"插件把内置键位顶掉"，两者都是用户能直接感觉到的坏。
 */

function key(over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) {
  return Object.assign({ key: 'a', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, over);
}

function cmd(over: Partial<Command> & { id: string }): Command {
  return Object.assign({ title: over.id, group: '基础' as const, run: function () { /* noop */ } }, over);
}

beforeEach(function () { resetCommands(); });

describe('按键 → 键位串', function () {
  it('字母键归一成小写，Ctrl 与 ⌘ 都算 mod', function () {
    expect(comboOf(key({ key: 'Z', ctrlKey: true }))).toBe('mod+z');
    expect(comboOf(key({ key: 'z', metaKey: true }))).toBe('mod+z');
  });

  it('修饰键按固定顺序拼，与按下的先后无关', function () {
    expect(comboOf(key({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('mod+shift+z');
    expect(comboOf(key({ key: 'n', ctrlKey: true, shiftKey: true, altKey: true }))).toBe('mod+shift+alt+n');
  });

  it('只按下修饰键本身不算一个键位', function () {
    expect(comboOf(key({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(comboOf(key({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(comboOf(key({ key: '' }))).toBeNull();
  });

  it('问号与斜杠是同一个键（Shift+/ 在多数键盘上打出来就是问号）', function () {
    expect(comboOf(key({ key: '?' }))).toBe('/');
    expect(comboOf(key({ key: '/' }))).toBe('/');
  });

  it('方向键、空格、Esc 有固定写法', function () {
    expect(comboOf(key({ key: 'ArrowLeft' }))).toBe('arrowleft');
    expect(comboOf(key({ key: ' ' }))).toBe('space');
    expect(comboOf(key({ key: 'Escape' }))).toBe('escape');
  });
});

describe('键位串 → 界面上的写法', function () {
  it('Windows / Linux 上写 Ctrl + Z', function () {
    expect(formatCombo('mod+z', false)).toBe('Ctrl + Z');
    expect(formatCombo('mod+shift+z', false)).toBe('Ctrl + Shift + Z');
  });

  it('Mac 上用 ⌘ ⇧ ⌥，且不加加号', function () {
    expect(formatCombo('mod+z', true)).toBe('⌘Z');
    expect(formatCombo('mod+shift+z', true)).toBe('⌘⇧Z');
  });

  it('方向键与特殊键有中文/符号写法', function () {
    expect(formatCombo('arrowleft', false)).toBe('←');
    expect(formatCombo('space', false)).toBe('空格');
    expect(formatCombo('escape', false)).toBe('Esc');
  });
});

describe('命令表', function () {
  it('同 id 只认第一次注册（内置的不会被后来的顶掉）', function () {
    registerCommands([cmd({ id: 'undo', title: '内置撤销' })]);
    registerCommands([cmd({ id: 'undo', title: '插件的撤销' })]);
    expect(allCommands().length).toBe(1);
    expect(findCommand('undo')!.title).toBe('内置撤销');
  });

  it('按键位精确匹配；没声明的键不匹配', function () {
    registerCommands([cmd({ id: 'undo', keys: ['mod+z'] })]);
    expect((matchCommand('mod+z') || {}).id).toBe('undo');
    expect(matchCommand('z')).toBeNull();
    expect(matchCommand('mod+shift+z')).toBeNull();
  });

  it('enabled 为 false 的命令不抢键，也不会被执行', function () {
    let ran = 0;
    registerCommands([cmd({ id: 'redo', keys: ['mod+y'], enabled: function () { return false; }, run: function () { ran++; } })]);
    expect(matchCommand('mod+y')).toBeNull();
    expect(runCommand('redo')).toBe(false);
    expect(ran).toBe(0);
  });

  it('同一键位被两条命令声明时先注册的赢（顺序即优先级）', function () {
    registerCommands([cmd({ id: 'a', keys: ['mod+k'] }), cmd({ id: 'b', keys: ['mod+k'] })]);
    expect((matchCommand('mod+k') || {}).id).toBe('a');
  });

  it('执行未知命令返回 false 而不是抛错', function () {
    expect(runCommand('不存在')).toBe(false);
  });

  it('分组列表覆盖所有内置分组，界面上不会漏掉一组', function () {
    registerCommands([
      cmd({ id: 'g1', group: '基础' }), cmd({ id: 'g2', group: '导航' }),
      cmd({ id: 'g3', group: '课表' }), cmd({ id: 'g4', group: '帮助' }),
    ]);
    const groups = allCommands().map(function (c) { return c.group; });
    for (const g of groups) expect(COMMAND_GROUPS.indexOf(g) >= 0).toBe(true);
  });
});

describe('输入框里不抢键', function () {
  it('input / textarea / select / contenteditable 都算输入控件', function () {
    expect(isTextField({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTextField({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTextField({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isTextField({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTextField({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});