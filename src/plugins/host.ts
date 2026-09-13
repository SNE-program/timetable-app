import {
  CAPABILITY_PERMISSION, type Capability, type CommandCapability, type ExportCapability,
  type ImportCapability, type InstalledPlugin, type PluginManifest, type PluginPermission,
  type SettingField, type SettingsCapability,
} from './types';
import type { FieldKey as ImportFieldKey } from '../core/courseImport';
import { clearAllSettings, maxFields, maxOptions, maxTextLength, readSettings, resetSettings } from './settings';
import { COLUMN_LABEL, SCOPE_COLUMNS, type ExportColumn, type ExportFormat, type ExportScope } from '../core/exporters';
import { builtinPlugins } from './builtin';

/**
 * 插件宿主。
 *
 * 只做四件事：校验清单、记录安装状态、管权限、把已启用插件的能力汇总出来。
 * 它**不执行任何插件代码** —— 原因见 types.ts 顶部的说明。
 */

const KEY = 'timetable.plugins.v1';

/**
 * 宿主支持的插件接口版本。
 *
 * 加一条新的能力类型、或改动已有能力的含义时，把它 +1 ——
 * 于是一份"按新版写的"插件不会装进旧版应用里（装进去只会表现得莫名其妙）。
 */
export const HOST_API_VERSION = 2;

interface Stored {
  /** 非内置插件 */
  installed: PluginManifest[];
  /** 被停用的插件 id（内置的也能停） */
  disabled: string[];
  /** 用户授予的权限 */
  granted: Record<string, PluginPermission[]>;
}

function emptyStore(): Stored {
  return { installed: [], disabled: [], granted: {} };
}

/** 上一次读取时被丢掉的问题记录（界面用它告诉用户"有几个插件记录读不出来"） */
let loadIssues: string[] = [];

export function lastLoadIssues(): string[] { return loadIssues.slice(); }

function load(): Stored {
  loadIssues = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const p = JSON.parse(raw) as Partial<Stored>;
    /*
     * 存进去的清单要**按安装时的同一套规则重新校验一遍**。
     *
     * 安装时校验过不等于以后一直可信：localStorage 可以被改，
     * 旧版本应用写入的清单也可能不符合今天的规则。不复查的话，
     * 一条畸形清单会一路进到导出菜单里 —— 表现是空表头或整页崩，
     * 而用户完全不知道是哪个插件干的。
     */
    const installed: PluginManifest[] = [];
    const rawList = Array.isArray(p.installed) ? p.installed : [];
    for (const item of rawList) {
      const r = validateManifest(item);
      if (r.ok) installed.push(r.manifest);
      else loadIssues.push((item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        ? String((item as { id: unknown }).id) : '（没有 id）') + '：' + r.error);
    }
    return {
      installed: installed,
      disabled: Array.isArray(p.disabled) ? p.disabled : [],
      granted: p.granted && typeof p.granted === 'object' ? p.granted as Record<string, PluginPermission[]> : {},
    };
  } catch (e) {
    return emptyStore();
  }
}

function save(s: Stored): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 存不下就算了，插件是可选功能 */ }
}

/* ------------------------------ 清单校验 ------------------------------ */

const VALID_COLUMNS = Object.keys(COLUMN_LABEL) as ExportColumn[];
const VALID_SCOPES: ExportScope[] = ['week', 'day', 'term', 'courses', 'tasks', 'attendance'];
const VALID_FORMATS: ExportFormat[] = ['csv', 'markdown', 'json', 'text'];

export type ParseResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

/**
 * 校验一份插件包。
 *
 * 校验写得比"能跑就行"严得多：插件是可以从聊天软件里转发过来的文件，
 * 一个畸形清单如果被放进去，会在每次打开设置页时炸掉。宁可装不上，
 * 也要保证装上的一定是干净的 —— 而且报错必须说清是哪一条不对。
 */
export function parseManifest(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: '不是合法的 JSON：' + (e as Error).message };
  }
  return validateManifest(raw);
}

/**
 * 校验一份**已经解析好的**清单对象。
 *
 * 拆出来是为了 `load()` 能对存起来的清单跑同一套规则 —— 见那边的说明。
 */
export function validateManifest(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '插件包应该是一个 JSON 对象' };
  const m = raw as Record<string, unknown>;

  if (m.format !== 'timetable-plugin') return { ok: false, error: 'format 必须是 "timetable-plugin"' };
  if (m.version !== 1) return { ok: false, error: '只支持 version 1 的插件包（当前是 ' + String(m.version) + '）' };
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(m.id)) {
    return { ok: false, error: 'id 只能由字母、数字、点、下划线、短横线组成（2-64 位）' };
  }
  if (typeof m.name !== 'string' || !m.name.trim()) return { ok: false, error: '缺少 name' };

  /*
   * 接口版本：不写按 1 算。比宿主新的插件直接拒 ——
   * 它对能力的期望宿主还没实现，装进去只会表现得莫名其妙。
   */
  const api = m.apiVersion === undefined ? 1 : m.apiVersion;
  if (typeof api !== 'number' || !isFinite(api) || api < 1) {
    return { ok: false, error: 'apiVersion 必须是正整数' };
  }
  if (api > HOST_API_VERSION) {
    return { ok: false, error: '这个插件需要更新版本的应用（它按插件接口 v' + api + ' 写，当前支持到 v' + HOST_API_VERSION + '）' };
  }
  if (m.minAppVersion !== undefined && (typeof m.minAppVersion !== 'string' || !/^[0-9]+(\.[0-9]+){0,2}$/.test(m.minAppVersion))) {
    return { ok: false, error: 'minAppVersion 应该形如 1.10 或 1.10.0' };
  }

  const perms = Array.isArray(m.permissions) ? m.permissions : [];
  for (const p of perms) {
    if (p !== 'read:timetable') return { ok: false, error: '不认识的权限：' + String(p) };
  }

  const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
  if (caps.length === 0) return { ok: false, error: '插件至少要提供一个能力' };
  if (caps.length > 8) return { ok: false, error: '一个插件的能数量上限是 8 个' };
  /* 设置项要按 key 被导出能力引用，所以得跨能力收集 */
  const settingFields: Record<string, SettingField> = {};

  const seen = new Set<string>();
  const outCaps: Capability[] = [];
  for (const c of caps) {
    const cap = c as Record<string, unknown>;
    if (cap.type !== 'export' && cap.type !== 'command' && cap.type !== 'settings' && cap.type !== 'import') {
      return { ok: false, error: '不支持的能力类型：' + String(cap.type) };
    }
    if (typeof cap.id !== 'string' || !cap.id) return { ok: false, error: '能力缺少 id' };
    if (seen.has(cap.id)) return { ok: false, error: '能力 id 重复：' + cap.id };
    seen.add(cap.id);
    if (typeof cap.name !== 'string' || !cap.name.trim()) return { ok: false, error: '能力 ' + cap.id + ' 缺少 name' };

    /* 命令：动作只能指向本插件自己的某个能力，且必须在下面第二轮里核对 */
    if (cap.type === 'command') {
      const act = cap.action as Record<string, unknown> | undefined;
      if (!act || act.kind !== 'export') {
        return { ok: false, error: '命令 ' + cap.id + ' 的 action.kind 目前只能是 export' };
      }
      if (typeof act.capabilityId !== 'string' || !act.capabilityId) {
        return { ok: false, error: '命令 ' + cap.id + ' 缺少 action.capabilityId' };
      }
      if (perms.indexOf(CAPABILITY_PERMISSION.command) < 0) {
        return { ok: false, error: '命令 ' + cap.id + ' 需要声明权限 "' + CAPABILITY_PERMISSION.command + '"' };
      }
      const keys = Array.isArray(cap.keys) ? cap.keys : [];
      for (const k of keys) {
        if (typeof k !== 'string' || !/^(mod\+)?(shift\+)?(alt\+)?[a-z0-9/\[\].;,=-]+$/.test(k)) {
          return { ok: false, error: '命令 ' + cap.id + ' 的键位写法不对：' + String(k) };
        }
      }
      outCaps.push({
        type: 'command',
        id: cap.id,
        name: cap.name,
        hint: typeof cap.hint === 'string' ? cap.hint : undefined,
        action: { kind: 'export', capabilityId: act.capabilityId },
        keys: keys.length > 0 ? (keys as string[]) : undefined,
      });
      continue;
    }

    /* ---------------- 导入预设：这个学校导出来的表长什么样 ---------------- */
    if (cap.type === 'import') {
      const headersRaw = cap.headers && typeof cap.headers === 'object' && !Array.isArray(cap.headers)
        ? cap.headers as Record<string, unknown> : {};
      const headers: Partial<Record<ImportFieldKey, string[]>> = {};
      let total = 0;
      for (const key of Object.keys(headersRaw)) {
        if (IMPORT_FIELDS.indexOf(key as ImportFieldKey) < 0) {
          return { ok: false, error: '导入预设 ' + cap.id + ' 里有不认识的字段：' + key };
        }
        const list = headersRaw[key];
        if (!Array.isArray(list)) return { ok: false, error: '导入预设 ' + cap.id + ' 的 ' + key + ' 应该是字符串数组' };
        const clean: string[] = [];
        for (const h of list) {
          if (typeof h !== 'string' || !h.trim()) continue;
          const t = h.trim().slice(0, 20);
          /*
           * 表头写成通配或超短词会把别的列抢走：一个字的表头（"课"）几乎必然误匹配 ——
           * 而猜错一列就是整张课表全错。所以只收 2 个字以上、且不含通配符的写法。
           */
          if (t.length < 2) return { ok: false, error: '导入预设 ' + cap.id + ' 的表头「' + t + '」太短，至少要 2 个字' };
          if (/[*?]/.test(t)) return { ok: false, error: '导入预设 ' + cap.id + ' 的表头不能包含 * 或 ?' };
          if (clean.indexOf(t) >= 0) continue;
          clean.push(t);
        }
        if (clean.length === 0) continue;
        if (clean.length > 8) return { ok: false, error: '导入预设 ' + cap.id + ' 的「' + key + '」最多 8 种写法' };
        headers[key as ImportFieldKey] = clean;
        total += clean.length;
      }
      if (total === 0) return { ok: false, error: '导入预设 ' + cap.id + ' 至少要写一种表头写法' };
      if (total > 40) return { ok: false, error: '导入预设 ' + cap.id + ' 的表头写法总数上限是 40 条' };

      const hr = cap.headerRow;
      if (hr !== undefined && (typeof hr !== 'number' || !isFinite(hr) || hr < 0 || hr > 20)) {
        return { ok: false, error: '导入预设 ' + cap.id + ' 的 headerRow 应当是 0..20 的整数' };
      }
      const md = cap.mode;
      if (md !== undefined && md !== 'long' && md !== 'matrix') {
        return { ok: false, error: '导入预设 ' + cap.id + ' 的 mode 只能是 long 或 matrix' };
      }
      outCaps.push({
        type: 'import',
        id: cap.id,
        name: cap.name,
        hint: typeof cap.hint === 'string' ? cap.hint : undefined,
        headers: headers,
        headerRow: typeof hr === 'number' ? Math.round(hr) : undefined,
        mode: md === 'long' || md === 'matrix' ? md : undefined,
      });
      continue;
    }

    /* ---------------- 设置：插件的参数由用户填，宿主渲染表单 --------------- */
    if (cap.type === 'settings') {
      const fields = Array.isArray(cap.fields) ? cap.fields : [];
      if (fields.length === 0) return { ok: false, error: '设置能力 ' + cap.id + ' 至少要有一个字段' };
      if (fields.length > maxFields()) {
        return { ok: false, error: '设置能力 ' + cap.id + ' 的字段上限是 ' + maxFields() + ' 个' };
      }
      const out: SettingField[] = [];
      for (const raw of fields) {
        const f = raw as Record<string, unknown>;
        if (typeof f.key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/i.test(f.key)) {
          return { ok: false, error: '设置项 key 只能由字母数字下划线组成，且以字母开头：' + String(f.key) };
        }
        if (settingFields[f.key]) return { ok: false, error: '设置项 key 重复：' + f.key };
        if (typeof f.label !== 'string' || !f.label.trim()) {
          return { ok: false, error: '设置项 ' + f.key + ' 缺少 label' };
        }
        const label = f.label.trim().slice(0, 24);
        const hint = typeof f.hint === 'string' && f.hint.trim() ? f.hint.trim().slice(0, 60) : undefined;

        if (f.type === 'bool') {
          if (typeof f.default !== 'boolean') return { ok: false, error: '开关 ' + f.key + ' 的 default 必须是 true / false' };
          const field: SettingField = { key: f.key, type: 'bool', label: label, hint: hint, default: f.default };
          settingFields[f.key] = field;
          out.push(field);
          continue;
        }
        if (f.type === 'text') {
          if (typeof f.default !== 'string') return { ok: false, error: '文本项 ' + f.key + ' 的 default 必须是字符串' };
          const maxLength = typeof f.maxLength === 'number' && isFinite(f.maxLength)
            ? Math.max(1, Math.min(maxTextLength(), Math.round(f.maxLength))) : undefined;
          const field: SettingField = {
            key: f.key, type: 'text', label: label, hint: hint,
            default: f.default.slice(0, maxLength || maxTextLength()),
            maxLength: maxLength,
            placeholder: typeof f.placeholder === 'string' ? f.placeholder.slice(0, 40) : undefined,
          };
          settingFields[f.key] = field;
          out.push(field);
          continue;
        }
        if (f.type === 'number') {
          if (typeof f.default !== 'number' || !isFinite(f.default)) {
            return { ok: false, error: '数字项 ' + f.key + ' 的 default 必须是数字' };
          }
          const num = function (v: unknown): number | undefined {
            return typeof v === 'number' && isFinite(v) ? v : undefined;
          };
          const min = num(f.min);
          const max = num(f.max);
          if (min !== undefined && max !== undefined && min > max) {
            return { ok: false, error: '数字项 ' + f.key + ' 的 min 比 max 大' };
          }
          const field: SettingField = {
            key: f.key, type: 'number', label: label, hint: hint, default: f.default,
            min: min, max: max, step: num(f.step),
          };
          settingFields[f.key] = field;
          out.push(field);
          continue;
        }
        if (f.type === 'multi') {
          const options = Array.isArray(f.options) ? f.options.filter(function (x) { return typeof x === 'string' && x; }) as string[] : [];
          if (options.length === 0) return { ok: false, error: '多选项 ' + f.key + ' 至少要有一个 options' };
          if (options.length > maxOptions()) {
            return { ok: false, error: '多选项 ' + f.key + ' 的 options 上限是 ' + maxOptions() + ' 个' };
          }
          if (new Set(options).size !== options.length) return { ok: false, error: '多选项 ' + f.key + ' 的 options 有重复' };
          const def = Array.isArray(f.default) ? f.default.filter(function (x) { return typeof x === 'string'; }) as string[] : null;
          if (!def) return { ok: false, error: '多选项 ' + f.key + ' 的 default 必须是字符串数组' };
          for (const d of def) {
            if (options.indexOf(d) < 0) return { ok: false, error: '多选项 ' + f.key + ' 的默认值里有不在 options 里的项：' + d };
          }
          const max = typeof f.max === 'number' && isFinite(f.max)
            ? Math.max(1, Math.min(options.length, Math.round(f.max))) : undefined;
          const field: SettingField = {
            key: f.key, type: 'multi', label: label, hint: hint,
            default: def.slice(0, max || options.length), options: options, max: max,
          };
          settingFields[f.key] = field;
          out.push(field);
          continue;
        }
        return { ok: false, error: '设置项 ' + f.key + ' 的类型只能是 bool / text / number / multi' };
      }
      outCaps.push({ type: 'settings', id: cap.id, name: cap.name, hint: typeof cap.hint === 'string' ? cap.hint : undefined, fields: out });
      continue;
    }

    if (typeof cap.format !== 'string' || VALID_FORMATS.indexOf(cap.format as ExportFormat) < 0) {
      return { ok: false, error: '能力 ' + cap.id + ' 的 format 只能是 ' + VALID_FORMATS.join(' / ') };
    }
    if (typeof cap.scope !== 'string' || VALID_SCOPES.indexOf(cap.scope as ExportScope) < 0) {
      return { ok: false, error: '能力 ' + cap.id + ' 的 scope 只能是 ' + VALID_SCOPES.join(' / ') };
    }
    /*
     * 列必须在这个范围里有意义。
     *
     * 以前只校验"列名认不认识"，于是能写出"导出任务清单、列选教室"这种清单 ——
     * 装上之后导出的是一整列空白，用户只会觉得"这插件坏了"。现在安装时就拒。
     */
    const allowed = SCOPE_COLUMNS[cap.scope as ExportScope] || [];
    const cols = Array.isArray(cap.columns) ? cap.columns : [];
    if (cols.length === 0) return { ok: false, error: '能力 ' + cap.id + ' 至少要指定一列' };
    if (cols.length > 12) return { ok: false, error: '能力 ' + cap.id + ' 的列数上限是 12' };
    for (const col of cols) {
      if (VALID_COLUMNS.indexOf(col as ExportColumn) < 0) {
        return { ok: false, error: '能力 ' + cap.id + ' 里有不认识的列：' + String(col) };
      }
      if (allowed.indexOf(col as ExportColumn) < 0) {
        return {
          ok: false,
          error: '能力 ' + cap.id + ' 是「' + cap.scope + '」范围，没有「' + String(col) + '」这一列（可用：' + allowed.join(' / ') + '）',
        };
      }
    }
    /* 该能力需要的权限必须已经在 permissions 里声明 —— 不允许"偷偷要用" */
    const need = CAPABILITY_PERMISSION.export;
    if (perms.indexOf(need) < 0) {
      return { ok: false, error: '能力 ' + cap.id + ' 需要声明权限 "' + need + '"' };
    }
    outCaps.push({
      type: 'export',
      id: cap.id,
      name: cap.name,
      hint: typeof cap.hint === 'string' ? cap.hint : undefined,
      format: cap.format as ExportFormat,
      scope: cap.scope as ExportCapability['scope'],
      fileName: typeof cap.fileName === 'string' && cap.fileName.trim() ? cap.fileName.trim().slice(0, 60) : undefined,
      columns: cols as ExportColumn[],
      grouped: cap.grouped === true,
      /* 指向设置项的引用在下面第二轮核对 */
      columnsFrom: typeof cap.columnsFrom === 'string' ? cap.columnsFrom : undefined,
      fileNameFrom: typeof cap.fileNameFrom === 'string' ? cap.fileNameFrom : undefined,
    });
  }

  /* 第二轮：命令指向的导出能力必须真的存在（否则它会变成一个点了没反应的菜单项） */
  for (const c of outCaps) {
    if (c.type !== 'command') continue;
    const target = outCaps.filter(function (x) { return x.id === c.action.capabilityId; })[0];
    if (!target) {
      return { ok: false, error: '命令 ' + c.id + ' 指向的能力不存在：' + c.action.capabilityId };
    }
    if (target.type !== 'export') {
      return { ok: false, error: '命令 ' + c.id + ' 只能指向导出能力（' + c.action.capabilityId + ' 不是）' };
    }
  }

  /*
   * 第二轮（续）：导出能力引用的**设置项**必须存在、类型对得上、而且不会越界。
   *
   * 这里是整个"可配置"设计的安全边界：用户能在界面上勾的东西，
   * 最终会变成"导出哪些列" —— 所以字段的可选项必须在**安装时**就被钉死在
   * "这个 scope 认得的列"里，而不是等用户勾完了再检查。
   * 于是无论用户怎么勾，导出的列都不可能越界。
   */
  for (const c of outCaps) {
    if (c.type !== 'export') continue;
    if (c.columnsFrom !== undefined) {
      const f = settingFields[c.columnsFrom];
      if (!f) return { ok: false, error: '导出 ' + c.id + ' 的 columnsFrom 指向的设置项不存在：' + c.columnsFrom };
      if (f.type !== 'multi') return { ok: false, error: '导出 ' + c.id + ' 的 columnsFrom 必须指向 multi 类型的设置项' };
      const allowedCols = SCOPE_COLUMNS[c.scope] || [];
      for (const opt of f.options) {
        if (VALID_COLUMNS.indexOf(opt as ExportColumn) < 0) {
          return { ok: false, error: '导出 ' + c.id + ' 的可选列里有不认识的列：' + opt };
        }
        if (allowedCols.indexOf(opt as ExportColumn) < 0) {
          return {
            ok: false,
            error: '导出 ' + c.id + ' 是「' + c.scope + '」范围，可选列里的「' + opt + '」不属于它（可用：' + allowedCols.join(' / ') + '）',
          };
        }
      }
    }
    if (c.fileNameFrom !== undefined) {
      const f = settingFields[c.fileNameFrom];
      if (!f) return { ok: false, error: '导出 ' + c.id + ' 的 fileNameFrom 指向的设置项不存在：' + c.fileNameFrom };
      if (f.type !== 'text') return { ok: false, error: '导出 ' + c.id + ' 的 fileNameFrom 必须指向 text 类型的设置项' };
    }
  }

  return {
    ok: true,
    manifest: {
      format: 'timetable-plugin',
      version: 1,
      apiVersion: api,
      minAppVersion: typeof m.minAppVersion === 'string' ? m.minAppVersion : undefined,
      id: m.id,
      name: m.name,
      author: typeof m.author === 'string' ? m.author : undefined,
      description: typeof m.description === 'string' ? m.description : undefined,
      pluginVersion: typeof m.pluginVersion === 'string' ? m.pluginVersion : undefined,
      permissions: perms as PluginPermission[],
      capabilities: outCaps,
    },
  };
}

/* ------------------------------ 注册表 ------------------------------ */

/** 内置插件永远在列表里；用户的安装/停用/授权叠加上去 */
export function listPlugins(): InstalledPlugin[] {
  const s = load();
  const builtins = builtinPlugins();
  const builtinIds = builtins.map(function (p) { return p.id; });

  const out: InstalledPlugin[] = builtins.map(function (m) {
    return {
      manifest: m,
      enabled: s.disabled.indexOf(m.id) < 0,
      builtin: true,
      /* 内置插件视为已授权：它就是应用自己的一部分 */
      granted: m.permissions.slice(),
    };
  });

  for (const m of s.installed) {
    if (builtinIds.indexOf(m.id) >= 0) continue;   /* 不允许用同名覆盖内置插件 */
    out.push({
      manifest: m,
      enabled: s.disabled.indexOf(m.id) < 0,
      builtin: false,
      granted: s.granted[m.id] || [],
    });
  }
  return out;
}

export function installPlugin(text: string, granted: PluginPermission[]): { ok: true; id: string } | { ok: false; error: string } {
  const r = parseManifest(text);
  if (!r.ok) return r;

  const s = load();
  if (builtinPlugins().some(function (p) { return p.id === r.manifest.id; })) {
    return { ok: false, error: '这个 id 和内置插件冲突，换一个（比如加上作者前缀）' };
  }
  /* 同 id 覆盖安装：替换清单，但停用状态保留 */
  const rest = s.installed.filter(function (p) { return p.id !== r.manifest.id; });
  s.installed = rest.concat([r.manifest]);
  s.granted[r.manifest.id] = granted.slice();
  save(s);
  return { ok: true, id: r.manifest.id };
}

export function uninstallPlugin(id: string): void {
  const s = load();
  s.installed = s.installed.filter(function (p) { return p.id !== id; });
  s.disabled = s.disabled.filter(function (x) { return x !== id; });
  delete s.granted[id];
  save(s);
  /*
   * 设置也一起删掉。
   *
   * 不删的话它会变成"清不掉的残留"：插件卸了，用户在存储体检里仍然看到
   * 那几 KB，而且下次装回同一个 id 会神秘地沿用上次的值 —— 用户以为重装是干净的。
   */
  resetSettings(id);
}

export function setPluginEnabled(id: string, on: boolean): void {
  const s = load();
  const has = s.disabled.indexOf(id) >= 0;
  if (on && has) s.disabled = s.disabled.filter(function (x) { return x !== id; });
  if (!on && !has) s.disabled.push(id);
  save(s);
}

export function grantPermissions(id: string, perms: PluginPermission[]): void {
  const s = load();
  s.granted[id] = perms.slice();
  save(s);
}

/** 这个插件当前能不能用：启用 + 权限齐 */
export function isPluginActive(p: InstalledPlugin): boolean {
  if (!p.enabled) return false;
  for (const need of p.manifest.permissions) {
    if (p.granted.indexOf(need) < 0) return false;
  }
  return true;
}

export interface ActiveExport {
  pluginId: string;
  pluginName: string;
  capability: ExportCapability;
  /**
   * 插件清单本身。
   *
   * 带上它是因为"这次导出到底用哪几列、叫什么名字"要读**用户设置**，
   * 而设置是挂在清单上的（见 resolveExportColumns）。让调用方再按 id 去
   * 注册表里找一遍，等于把同一份数据查两次，两处还可能查到不同的状态。
   */
  manifest: PluginManifest;
}

/**
 * 汇总所有**已启用且权限齐**的插件所提供的导出格式。
 * 导出菜单直接吃这个列表，所以停用插件或撤销权限会立刻生效。
 */
export function activeExports(): ActiveExport[] {
  const out: ActiveExport[] = [];
  for (const p of listPlugins()) {
    if (!isPluginActive(p)) continue;
    for (const c of p.manifest.capabilities) {
      if (c.type === 'export') {
        out.push({ pluginId: p.manifest.id, pluginName: p.manifest.name, capability: c, manifest: p.manifest });
      }
    }
  }
  return out;
}

export interface ActiveCommand {
  pluginId: string;
  pluginName: string;
  command: CommandCapability;
}

/**
 * 汇总已启用插件的命令（可以绑快捷键的那些）。
 *
 * 与 activeExports 同一套过滤条件：停用或撤权之后命令立刻消失。
 * 注册进命令表由 app/builtinCommands.ts 的 reloadPluginCommands() 负责 ——
 * 宿主保持"不知道界面"，界面也不直接读 localStorage。
 */
export function activeCommands(): ActiveCommand[] {
  const out: ActiveCommand[] = [];
  for (const p of listPlugins()) {
    if (!isPluginActive(p)) continue;
    for (const c of p.manifest.capabilities) {
      if (c.type === 'command') {
        out.push({ pluginId: p.manifest.id, pluginName: p.manifest.name, command: c });
      }
    }
  }
  return out;
}

export interface ActiveImport {
  pluginId: string;
  pluginName: string;
  capability: ImportCapability;
}

/** 汇总已启用插件的导入预设（导入弹层里的"这是哪个学校的表"那一排） */
export function activeImports(): ActiveImport[] {
  const out: ActiveImport[] = [];
  for (const p of listPlugins()) {
    if (!isPluginActive(p)) continue;
    for (const c of p.manifest.capabilities) {
      if (c.type === 'import') out.push({ pluginId: p.manifest.id, pluginName: p.manifest.name, capability: c });
    }
  }
  return out;
}

/** 导入预设认识的字段（校验用；与 core/courseImport 的 FIELD_ORDER 一致） */
const IMPORT_FIELDS: ImportFieldKey[] = ['name', 'teacher', 'day', 'period', 'weeks', 'place'];

/* ------------------------------ 设置：解析成"这次到底怎么做" ------------------------------ */

/** 这个插件声明的设置能力（没有就是 undefined） */
export function settingsCapability(m: PluginManifest): SettingsCapability | undefined {
  return m.capabilities.filter(function (c): c is SettingsCapability { return c.type === 'settings'; })[0];
}

/**
 * 这次导出**实际用哪几列**。
 *
 * 用户勾了就用勾的（顺序也按选项顺序走，不受勾选先后影响 ——
 * 同一份设置导出两次，"列的顺序每次都不一样"会让人以为出了问题）；
 * 没勾、或插件压根没接设置，就用清单里声明的那组。
 */
export function resolveExportColumns(m: PluginManifest, cap: ExportCapability): ExportColumn[] {
  if (!cap.columnsFrom) return cap.columns;
  const s = settingsCapability(m);
  if (!s) return cap.columns;
  const field = s.fields.filter(function (f) { return f.key === cap.columnsFrom; })[0];
  if (!field || field.type !== 'multi') return cap.columns;
  const picked = readSettings(m.id, s)[field.key];
  if (!Array.isArray(picked) || picked.length === 0) return cap.columns;
  const ordered = field.options.filter(function (o) { return picked.indexOf(o) >= 0; }) as ExportColumn[];
  return ordered.length > 0 ? ordered : cap.columns;
}

/** 这次导出**用什么文件名**（不含扩展名）；没有就返回 undefined（由调用方给默认名） */
export function resolveExportFileName(m: PluginManifest, cap: ExportCapability): string | undefined {
  if (!cap.fileNameFrom) return cap.fileName;
  const s = settingsCapability(m);
  if (!s) return cap.fileName;
  const field = s.fields.filter(function (f) { return f.key === cap.fileNameFrom })[0];
  if (!field || field.type !== 'text') return cap.fileName;
  const v = readSettings(m.id, s)[field.key];
  if (typeof v !== 'string') return cap.fileName;
  const trimmed = v.trim();
  return trimmed ? trimmed : cap.fileName;
}

/** 清空全部插件状态：安装记录 + 设置（测试与"清掉插件数据"用） */
export function resetPlugins(): void {
  try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
  clearAllSettings();
}
