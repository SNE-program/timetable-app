import {
  CAPABILITY_PERMISSION, type Capability, type CommandCapability, type ExportCapability,
  type InstalledPlugin, type PluginManifest, type PluginPermission,
} from './types';
import { COLUMN_LABEL, type ExportColumn } from '../core/exporters';
import { BUILTIN_PLUGINS } from './builtin';

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
export const HOST_API_VERSION = 1;

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
const VALID_SCOPES = ['week', 'term', 'courses'];

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

  const seen = new Set<string>();
  const outCaps: Capability[] = [];
  for (const c of caps) {
    const cap = c as Record<string, unknown>;
    if (cap.type !== 'export' && cap.type !== 'command') {
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

    if (cap.format !== 'csv' && cap.format !== 'markdown') {
      return { ok: false, error: '能力 ' + cap.id + ' 的 format 只能是 csv 或 markdown' };
    }
    if (typeof cap.scope !== 'string' || VALID_SCOPES.indexOf(cap.scope) < 0) {
      return { ok: false, error: '能力 ' + cap.id + ' 的 scope 只能是 week / term / courses' };
    }
    const cols = Array.isArray(cap.columns) ? cap.columns : [];
    if (cols.length === 0) return { ok: false, error: '能力 ' + cap.id + ' 至少要指定一列' };
    if (cols.length > 12) return { ok: false, error: '能力 ' + cap.id + ' 的列数上限是 12' };
    for (const col of cols) {
      if (VALID_COLUMNS.indexOf(col as ExportColumn) < 0) {
        return { ok: false, error: '能力 ' + cap.id + ' 里有不认识的列：' + String(col) };
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
      format: cap.format,
      scope: cap.scope as ExportCapability['scope'],
      columns: cols as ExportColumn[],
      grouped: cap.grouped === true,
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
  const builtinIds = BUILTIN_PLUGINS.map(function (p) { return p.id; });

  const out: InstalledPlugin[] = BUILTIN_PLUGINS.map(function (m) {
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
  if (BUILTIN_PLUGINS.some(function (p) { return p.id === r.manifest.id; })) {
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
        out.push({ pluginId: p.manifest.id, pluginName: p.manifest.name, capability: c });
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

/** 清空全部插件状态（测试与"恢复出厂"用） */
export function resetPlugins(): void {
  try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
}
