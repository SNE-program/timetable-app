import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllSettings, coerceField, fieldDefault, isValidFieldValue, readSettings, resetSettings,
  settingsStorageKey, writeSetting,
} from './settings';
import type { SettingField } from './types';

const BOOL: SettingField = { key: 'on', type: 'bool', label: '开关', default: false };
const TEXT: SettingField = { key: 'name', type: 'text', label: '名字', default: '默认', maxLength: 8 };
const NUM: SettingField = { key: 'n', type: 'number', label: '数字', default: 3, min: 1, max: 5 };
const MULTI: SettingField = { key: 'cols', type: 'multi', label: '列', default: ['a'], options: ['a', 'b', 'c'], max: 2 };

const CAP = { type: 'settings' as const, id: 's1', name: '设置', fields: [BOOL, TEXT, NUM, MULTI] };

beforeEach(function () {
  const box = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: function (k: string) { return box.has(k) ? box.get(k)! : null; },
    setItem: function (k: string, v: string) { box.set(k, String(v)); },
    removeItem: function (k: string) { box.delete(k); },
  };
  clearAllSettings();
});

describe('取值的收束（coerceField）', function () {
  it('开关只认布尔值', function () {
    expect(coerceField(BOOL, true)).toBe(true);
    expect(coerceField(BOOL, 'true')).toBe(null);
    expect(coerceField(BOOL, 1)).toBe(null);
  });

  it('文本按字段自己的 maxLength 截断，换行压成空格', function () {
    expect(coerceField(TEXT, '一二三四五六七八九十')).toBe('一二三四五六七八');
    expect(coerceField(TEXT, '上\n下')).toBe('上 下');
    expect(coerceField(TEXT, 5)).toBe(null);
  });

  it('数字夹到 min/max 之间，NaN 与 Infinity 都不接受', function () {
    expect(coerceField(NUM, 99)).toBe(5);
    expect(coerceField(NUM, -3)).toBe(1);
    expect(coerceField(NUM, 2.5)).toBe(2.5);
    expect(coerceField(NUM, NaN)).toBe(null);
    expect(coerceField(NUM, Infinity)).toBe(null);
    expect(coerceField(NUM, '3')).toBe(null);
  });

  it('多选只留选项里有的、去重、并且不超上限', function () {
    expect(coerceField(MULTI, ['b', 'a', 'b', 'zzz'])).toEqual(['b', 'a']);
    expect(coerceField(MULTI, ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(coerceField(MULTI, 'a')).toBe(null);
    expect(coerceField(MULTI, [1, 2])).toEqual([]);
  });

  it('默认值是一份新对象（改它不该改到 schema）', function () {
    const d = fieldDefault(MULTI);
    expect(d).toEqual(['a']);
    if (Array.isArray(d)) d.push('b');
    expect(MULTI.default).toEqual(['a']);
  });

  it('isValidFieldValue 与 coerceField 同源', function () {
    expect(isValidFieldValue(NUM, 3)).toBe(true);
    expect(isValidFieldValue(NUM, 'x')).toBe(false);
  });
});

describe('存与读', function () {
  it('没存过时全是默认值', function () {
    expect(readSettings('p1', CAP)).toEqual({ on: false, name: '默认', n: 3, cols: ['a'] });
  });

  it('写进去能读回来', function () {
    expect(writeSetting('p1', BOOL, true)).toBe(true);
    expect(writeSetting('p1', TEXT, '我的课表')).toBe(true);
    expect(writeSetting('p1', NUM, 4)).toBe(true);
    expect(writeSetting('p1', MULTI, ['b', 'c'])).toBe(true);
    expect(readSettings('p1', CAP)).toEqual({ on: true, name: '我的课表', n: 4, cols: ['b', 'c'] });
  });

  it('不合法就不写，而且返回 false（而不是悄悄存个坏值）', function () {
    expect(writeSetting('p1', NUM, 999)).toBe(true);      /* 越界会被夹住，属于可接受 */
    expect(readSettings('p1', CAP).n).toBe(5);
    expect(writeSetting('p1', TEXT, {} as any)).toBe(false);
    expect(readSettings('p1', CAP).name).toBe('默认');
  });

  it('插件之间互不干扰', function () {
    writeSetting('p1', BOOL, true);
    writeSetting('p2', BOOL, false);
    expect(readSettings('p1', CAP).on).toBe(true);
    expect(readSettings('p2', CAP).on).toBe(false);
  });

  it('恢复默认只影响这一个插件', function () {
    writeSetting('p1', BOOL, true);
    writeSetting('p2', BOOL, true);
    resetSettings('p1');
    expect(readSettings('p1', CAP).on).toBe(false);
    expect(readSettings('p2', CAP).on).toBe(true);
  });

  it('清掉全部之后谁也不剩，存储键也就没了', function () {
    writeSetting('p1', BOOL, true);
    expect(localStorage.getItem(settingsStorageKey())).toBeTruthy();
    clearAllSettings();
    expect(localStorage.getItem(settingsStorageKey())).toBe(null);
    expect(readSettings('p1', CAP).on).toBe(false);
  });

  it('★ 存储被写坏时退回默认值，而不是把坏值带出去', function () {
    writeSetting('p1', NUM, 4);
    localStorage.setItem(settingsStorageKey(), JSON.stringify({ p1: { n: '不是数字', name: 42, cols: 'x', on: 'maybe' } }));
    expect(readSettings('p1', CAP)).toEqual({ on: false, name: '默认', n: 3, cols: ['a'] });
  });

  it('存储里出现不认识的字段时忽略它们（插件升级后旧值不该顶掉新字段）', function () {
    localStorage.setItem(settingsStorageKey(), JSON.stringify({ p1: { 消失的字段: 'x', n: 2 } }));
    const v = readSettings('p1', CAP);
    expect(v.n).toBe(2);
    expect(Object.keys(v).sort()).toEqual(['cols', 'n', 'name', 'on']);
  });

  it('整份存储不是对象时也不炸', function () {
    localStorage.setItem(settingsStorageKey(), '[1,2,3]');
    expect(readSettings('p1', CAP).n).toBe(3);
    localStorage.setItem(settingsStorageKey(), '这不是 json');
    expect(readSettings('p1', CAP).n).toBe(3);
  });

  it('没有设置能力的插件读到空对象', function () {
    expect(readSettings('p1', undefined)).toEqual({});
  });
});
