import type { PeriodScheme, TimetableData } from './types';

/** 导出：完整、可读、可迁移 */
export function serializeTimetable(data: TimetableData): string {
  return JSON.stringify(data, null, 2);
}

export interface ParseOk { ok: true; data: TimetableData; warnings: string[]; }
export interface ParseFail { ok: false; error: string; }
export type ParseResult = ParseOk | ParseFail;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 导入：不信任任何输入，逐项校验。
 * 缺的字段补默认值而不是直接失败，缺的关键结构才报错。
 */
export function parseTimetable(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: '文件不是合法的 JSON' };
  }
  if (!isObj(raw)) return { ok: false, error: '文件内容不是一个对象' };

  const warnings: string[] = [];
  const term = raw.term;
  if (!isObj(term) || typeof term.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(term.startDate)) {
    return { ok: false, error: '缺少合法的学期信息（term.startDate）' };
  }
  if (!Array.isArray(raw.courses)) return { ok: false, error: '缺少课程列表（courses）' };
  if (!Array.isArray(raw.sessions)) return { ok: false, error: '缺少上课时段（sessions）' };
  if (!Array.isArray(raw.schemes) || raw.schemes.length === 0) {
    return { ok: false, error: '缺少作息方案（schemes）' };
  }

  const schemes = raw.schemes as PeriodScheme[];
  const schemeIds = schemes.map(function (s) { return s.id; });
  const termObj = term as Record<string, unknown>;
  let periodSchemeId = String(termObj.periodSchemeId || '');
  if (schemeIds.indexOf(periodSchemeId) < 0) {
    warnings.push('学期引用的作息方案不存在，已改用第一套');
    periodSchemeId = schemeIds[0];
  }

  const sessionIds: Record<string, boolean> = {};
  const sessions = (raw.sessions as TimetableData['sessions']).filter(function (s) {
    if (!s || typeof s.id !== 'string' || typeof s.courseId !== 'string') return false;
    sessionIds[s.id] = true;
    return true;
  });
  if (sessions.length !== (raw.sessions as unknown[]).length) {
    warnings.push('丢弃了 ' + ((raw.sessions as unknown[]).length - sessions.length) + ' 条格式不正确的时段');
  }

  const courseIds: Record<string, boolean> = {};
  const courses = (raw.courses as TimetableData['courses']).filter(function (c) {
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') return false;
    courseIds[c.id] = true;
    return true;
  });

  const orphans = sessions.filter(function (s) { return !courseIds[s.courseId]; }).length;
  if (orphans > 0) warnings.push(orphans + ' 条时段找不到对应课程，已丢弃');

  const overrides = Array.isArray(raw.overrides)
    ? (raw.overrides as TimetableData['overrides']).filter(function (o) { return o && sessionIds[o.sessionId]; })
    : [];
  if (Array.isArray(raw.overrides) && overrides.length !== (raw.overrides as unknown[]).length) {
    warnings.push('丢弃了指向已不存在时段的调课记录');
  }

  const reminderRules = Array.isArray(raw.reminderRules) ? (raw.reminderRules as TimetableData['reminderRules']) : [];
  if (!Array.isArray(raw.reminderRules)) warnings.push('文件里没有提醒规则，已按默认规则处理');
  const tasks = Array.isArray(raw.tasks) ? (raw.tasks as TimetableData['tasks']) : [];
  const attendance = Array.isArray(raw.attendance) ? (raw.attendance as TimetableData['attendance']) : [];

  const data: TimetableData = {
    term: {
      id: String(termObj.id || 'term-1'),
      name: String(termObj.name || '我的课表'),
      startDate: termObj.startDate as string,
      totalWeeks: typeof termObj.totalWeeks === 'number' ? termObj.totalWeeks : undefined,
      periodSchemeId: periodSchemeId,
    },
    schemes: schemes,
    courses: courses.filter(function (c) { return courseIds[c.id]; }),
    sessions: sessions.filter(function (s) { return courseIds[s.courseId]; }),
    overrides: overrides,
    reminderRules: reminderRules,
    tasks: tasks,
    attendance: attendance,
  };

  return { ok: true, data: data, warnings: warnings };
}
