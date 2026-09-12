import { buildEmptyData } from './demo';
import type { TimetableData } from './types';

/**
 * 用户手机上已经存着的数据需要跟着版本走。
 *
 * 最容易踩的坑：改了"新安装的默认值"，但老用户读的还是本地旧数据 ——
 * 表现就是"我明明改过了，怎么还是旧的"。
 */
export interface MigrateResult {
  data: TimetableData;
  notes: string[];
}

/** 我们曾经内置过、后来被真实作息取代的方案 id */
const LEGACY_SCHEME_IDS = ['scheme-summer', 'scheme-winter'];

export function migrateData(input: TimetableData): MigrateResult {
  const notes: string[] = [];
  let data = input;

  /* ---- 1) 用真实的默认作息替换掉内置的旧方案（用户自建的方案不动）---- */
  const hasLegacy = data.schemes.some(function (s) { return LEGACY_SCHEME_IDS.indexOf(s.id) >= 0; });
  if (hasLegacy) {
    const fresh = buildEmptyData().schemes;
    const kept = data.schemes.filter(function (s) { return LEGACY_SCHEME_IDS.indexOf(s.id) < 0; });
    const merged = kept.concat(fresh.filter(function (f) {
      return !kept.some(function (k) { return k.id === f.id; });
    }));
    let periodSchemeId = data.term.periodSchemeId;
    if (LEGACY_SCHEME_IDS.indexOf(periodSchemeId) >= 0) periodSchemeId = fresh[0].id;
    data = Object.assign({}, data, {
      schemes: merged,
      term: Object.assign({}, data.term, { periodSchemeId: periodSchemeId }),
    });
    notes.push('内置作息已更新为「' + fresh[0].name + '」（共 ' + fresh[0].periods.length + ' 节）');
  }

  /* ---- 2) 兜底：学期引用的方案不存在时，指回第一套 ---- */
  if (data.schemes.length > 0 && !data.schemes.some(function (s) { return s.id === data.term.periodSchemeId; })) {
    data = Object.assign({}, data, {
      term: Object.assign({}, data.term, { periodSchemeId: data.schemes[0].id }),
    });
    notes.push('学期引用的作息方案不存在，已改回「' + data.schemes[0].name + '」');
  }

  /* ---- 3) 补齐后加的字段，避免老数据缺字段导致崩溃 ---- */
  const fill: Partial<TimetableData> = {};
  if (!Array.isArray(data.tasks)) fill.tasks = [];
  if (!Array.isArray(data.attendance)) fill.attendance = [];
  if (!Array.isArray(data.reminderRules)) fill.reminderRules = [];
  if (!Array.isArray(data.overrides)) fill.overrides = [];
  if (Object.keys(fill).length > 0) {
    data = Object.assign({}, data, fill);
    notes.push('已补齐缺失的数据字段');
  }

  return { data: data, notes: notes };
}
