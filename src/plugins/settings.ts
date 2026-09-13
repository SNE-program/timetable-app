import type { SettingField, SettingValue, SettingsCapability } from './types';

/**
 * 插件设置的存取。
 *
 * ## 为什么放在宿主而不是插件里
 *
 * 插件是**纯数据**（见 types.ts 顶部）：它没有任何代码，也就没有"自己存东西"的能力。
 * 所以"用户填了什么"这件事只能由宿主保管 —— 这与权限记录、安装记录同一个位置。
 *
 * ## 为什么整份存成一个键
 *
 * `timetable.pluginsettings.v1` = `{ [pluginId]: { [key]: value } }`。
 * 一个插件一个键的话，装十个插件就是十个 storage key —— 本地存储体检要挨个列、
 * 清理要挨个删，漏一个就变成"清不掉的残留"。整份存一个键，这三个操作都只有一处。
 *
 * ## 读的时候**不信**存储里的值
 *
 * localStorage 可以被改，旧版本写进去的值也可能不符合今天的 schema
 * （插件升级后字段类型变了）。所以每次读都按当前 schema 过一遍：
 * 类型不对、超出范围、选项不在列表里 —— 一律退回默认值。
 * 宁可让用户看到"设置回到默认了"，也不要让一个假值一路进到导出里。
 */

const KEY = 'timetable.pluginsettings.v1';

type Store = Record<string, Record<string, SettingValue>>;

/** 每个字段的字符/数量上限 —— 插件包是可以从聊天软件转发过来的文件，不能由它定上限 */
const TEXT_MAX = 200;
const OPTIONS_MAX = 12;
const FIELDS_MAX = 12;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
    const out: Store = {};
    const src = p as Record<string, unknown>;
    for (const id of Object.keys(src)) {
      const bag = src[id];
      if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
      const one: Record<string, SettingValue> = {};
      const b = bag as Record<string, unknown>;
      for (const k of Object.keys(b)) {
        const v = b[k];
        if (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') one[k] = v;
        else if (Array.isArray(v) && v.every(function (x) { return typeof x === 'string'; })) one[k] = v as string[];
      }
      out[id] = one;
    }
    return out;
  } catch (e) {
    return {};
  }
}

function save(s: Store): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 存不下就算了：设置不是必须的 */ }
}

/** 默认值（一份新的对象，避免调用方改到 schema 里的那份） */
export function fieldDefault(f: SettingField): SettingValue {
  if (f.type === 'bool') return f.default;
  if (f.type === 'text') return f.default;
  if (f.type === 'number') return f.default;
  return f.default.slice();
}

function clampNumber(n: number, f: Extract<SettingField, { type: 'number' }>): number {
  let v = n;
  if (typeof f.min === 'number') v = Math.max(f.min, v);
  if (typeof f.max === 'number') v = Math.min(f.max, v);
  return v;
}

/**
 * 把一个值按字段类型"收干净"。
 *
 * 返回 null 表示**这个值不能用**，调用方应当退回默认值 ——
 * 而不是硬转换（把 `"abc"` 转成 `NaN` 那种）。
 */
export function coerceField(f: SettingField, raw: unknown): SettingValue | null {
  if (f.type === 'bool') return typeof raw === 'boolean' ? raw : null;
  if (f.type === 'text') {
    if (typeof raw !== 'string') return null;
    const max = Math.min(TEXT_MAX, typeof f.maxLength === 'number' ? f.maxLength : TEXT_MAX);
    /* 换行会让文件名里的那一行显示不出来，直接压成空格 */
    return raw.replace(/[\r\n]+/g, ' ').slice(0, max);
  }
  if (f.type === 'number') {
    if (typeof raw !== 'number' || !isFinite(raw)) return null;
    return clampNumber(raw, f);
  }
  /* multi：只保留选项里有的、去重、上限 max */
  if (!Array.isArray(raw)) return null;
  const allowed = f.options;
  const picked: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    if (allowed.indexOf(v) < 0) continue;
    if (picked.indexOf(v) >= 0) continue;
    picked.push(v);
  }
  const max = typeof f.max === 'number' ? Math.min(f.max, OPTIONS_MAX) : OPTIONS_MAX;
  return picked.slice(0, max);
}

/** 这个字段的值能不能接受（校验用；写盘前先过一遍，免得存下永远读不回来的值） */
export function isValidFieldValue(f: SettingField, raw: unknown): boolean {
  return coerceField(f, raw) !== null;
}

/** 上限：一个插件的设置项数量 */
export function maxFields(): number { return FIELDS_MAX; }
export function maxOptions(): number { return OPTIONS_MAX; }
export function maxTextLength(): number { return TEXT_MAX; }

/**
 * 读一个插件的设置（缺的用默认值补上）。
 *
 * 只在插件**有 settings 能力**时才有意义 —— 调用方把 schema 传进来，
 * 这里不自己去插件注册表里找（那一层依赖会让这个模块没法单测）。
 */
export function readSettings(pluginId: string, cap: SettingsCapability | undefined): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  if (!cap) return out;
  const stored = load()[pluginId] || {};
  for (const f of cap.fields) {
    const raw = stored[f.key];
    const v = raw === undefined ? null : coerceField(f, raw);
    out[f.key] = v === null ? fieldDefault(f) : v;
  }
  return out;
}

/**
 * 写一个字段。
 *
 * 值不合法就**不写**并返回 false —— 界面上的控件本来就不该产出非法值，
 * 真出现了说明有别的路径在写，宁可保持原样。
 */
export function writeSetting(pluginId: string, f: SettingField, raw: unknown): boolean {
  const v = coerceField(f, raw);
  if (v === null) return false;
  const s = load();
  const bag = s[pluginId] || {};
  bag[f.key] = v;
  s[pluginId] = bag;
  save(s);
  return true;
}

/** 把这个插件的设置恢复成默认（界面上的"恢复默认"） */
export function resetSettings(pluginId: string): void {
  const s = load();
  delete s[pluginId];
  save(s);
}

/** 清掉**全部**插件的设置（"清掉插件数据"与卸载时用） */
export function clearAllSettings(): void {
  try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
}

/** 存储占用体检要列它 */
export function settingsStorageKey(): string { return KEY; }
