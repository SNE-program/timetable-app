import { addDays, expandDay, pad2, parseISODate, toISODate } from './engine';
import { humanDuration } from './duration';
import type { ConcreteEvent, ISODate, ReminderRule, TimetableData } from './types';

export interface ReminderPrefs {
  /** 全局默认提前量（没有任何规则命中时使用） */
  reminderOffsets: number[];
  dailyBrief: boolean;
  /** 每日摘要的发送时刻（小时，0-23） */
  briefHour: number;
}

/**
 * 通知的种类。它决定**走哪个通知渠道**（用户可以在系统里按渠道静音）。
 *
 * `rule` 是插件规则发出来的（v1.9.15）：单开一个渠道，
 * 于是"不想被插件打扰"可以只关这一个，上课提醒不受影响。
 */
export type NotificationKind = 'class' | 'brief' | 'task' | 'rule';

export interface PlannedNotification {
  /** 去重指纹：sessionId@date#offset / brief@date */
  fingerprint: string;
  kind: NotificationKind;
  eventKey: string;
  title: string;
  body: string;
  /** 应该发出的时间（epoch ms） */
  at: number;
  date: ISODate;
  offsetMinutes: number;
  courseId?: string;
  sessionId?: string;
}

export const DEFAULT_PREFS: ReminderPrefs = { reminderOffsets: [15, 5], dailyBrief: true, briefHour: 21 };

/* ------------------------- 规则解析 ------------------------- */

/** 找出最具体的一条规则：session > course > global */
export function mostSpecificRule(
  rules: ReminderRule[], sessionId: string, courseId: string
): ReminderRule | null {
  return rules.find(function (r) { return r.scope === 'session' && r.sessionId === sessionId; })
    || rules.find(function (r) { return r.scope === 'course' && r.courseId === courseId; })
    || rules.find(function (r) { return r.scope === 'global'; })
    || null;
}

/**
 * 决定某个上课时段用哪些提前量。
 * 注意：命中一条被禁用的规则表示"这门课不提醒"，而不是继续往外层找。
 */
export function offsetsFor(
  rules: ReminderRule[], sessionId: string, courseId: string, prefs: ReminderPrefs
): number[] {
  const r = mostSpecificRule(rules, sessionId, courseId);
  if (!r) return prefs.reminderOffsets;
  if (!r.enabled) return [];
  return r.offsetsMinutes;
}

/* ------------------------- 时间工具 ------------------------- */

function atOnDate(day: Date, minutesOfDay: number): number {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0).getTime();
}

export function formatClock(minutesOfDay: number): string {
  return pad2(Math.floor(minutesOfDay / 60)) + ':' + pad2(minutesOfDay % 60);
}

/* ------------------------- 通知文案 ------------------------- */

function classNotification(e: ConcreteEvent, offsetMinutes: number, at: number): PlannedNotification {
  const where = e.location ? e.location : '教室待定';
  const parts = [e.start + '-' + e.end, where];
  if (e.teacher) parts.push(e.teacher);
  return {
    fingerprint: e.sessionId + '@' + e.date + '#' + offsetMinutes,
    kind: 'class',
    eventKey: e.key,
    title: e.title,
    body: parts.join(' · ') + (offsetMinutes > 0 ? ' · ' + humanDuration(offsetMinutes) + '后上课' : ' · 现在上课'),
    at: at,
    date: e.date,
    offsetMinutes: offsetMinutes,
    courseId: e.courseId,
    sessionId: e.sessionId,
  };
}

function briefNotification(data: TimetableData, prefs: ReminderPrefs, onDay: Date, nextDate: ISODate): PlannedNotification | null {
  const events = expandDay(data, nextDate);
  if (events.length === 0) return null;
  const at = atOnDate(onDay, prefs.briefHour * 60);
  const shown = events.slice(0, 4);
  const items = shown.map(function (e) {
    return e.start + ' ' + e.title + (e.location ? '（' + e.location + '）' : '');
  });
  if (events.length > shown.length) items.push('等 ' + events.length + ' 节');
  return {
    fingerprint: 'brief@' + nextDate,
    kind: 'brief',
    eventKey: 'brief@' + nextDate,
    title: '明天 ' + events.length + ' 节课，' + events[0].start + ' 开始',
    body: items.join(' ｜ '),
    at: at,
    date: toISODate(onDay),
    offsetMinutes: 0,
  };
}


/* ------------------------- 任务 / DDL 提醒 ------------------------- */

/** DDL 的两个提前量：提前一天、提前两小时 */
export const TASK_OFFSETS = [1440, 120];

export function planTaskNotifications(
  data: TimetableData, fromMs: number, toMs: number
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const tasks = data.tasks || [];
  for (const t of tasks) {
    if (t.done) continue;
    if (!t.due) continue;
    const course = t.courseId ? data.courses.find(function (c) { return c.id === t.courseId; }) : undefined;
    const dueMin = t.dueMinutes === undefined ? 23 * 60 + 59 : t.dueMinutes;
    const p = t.due.split('-').map(Number);
    const dueAt = new Date(p[0], p[1] - 1, p[2], Math.floor(dueMin / 60), dueMin % 60, 0, 0).getTime();
    for (const off of TASK_OFFSETS) {
      const at = dueAt - off * 60000;
      if (at < fromMs || at > toMs) continue;
      /* 正好提前一天说「明天」比「1 天后」自然；其它情况交给统一的格式化 */
      const when = off === 1440 ? '明天' : humanDuration(off) + '后';
      out.push({
        fingerprint: 'task@' + t.id + '#' + off,
        kind: 'task',
        eventKey: 'task@' + t.id,
        title: 'DDL：' + t.title,
        body: (course ? course.name + ' · ' : '') + when + '截止（' + formatClock(dueMin) + '）' + (t.note ? ' · ' + t.note : ''),
        at: at,
        date: t.due,
        offsetMinutes: off,
        courseId: t.courseId,
      });
    }
  }
  return out;
}

/* ------------------------- 主调度函数 ------------------------- */

/**
 * 把课表展开成一段时间窗口内应当触发的全部通知。
 * 纯函数：给定同样的输入必定得到同样的输出，方便测试与预览。
 */
export function planNotifications(
  data: TimetableData, prefs: ReminderPrefs, fromMs: number, toMs: number
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  if (toMs <= fromMs) return out;
  const start = new Date(fromMs);
  const days = Math.ceil((toMs - fromMs) / 86400000) + 1;

  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const date = toISODate(day);

    if (prefs.dailyBrief) {
      const nextDate = toISODate(addDays(parseISODate(date), 1));
      const brief = briefNotification(data, prefs, day, nextDate);
      if (brief && brief.at >= fromMs && brief.at <= toMs) out.push(brief);
    }

    const events = expandDay(data, date);
    for (const e of events) {
      const offsets = offsetsFor(data.reminderRules, e.sessionId, e.courseId, prefs);
      for (const off of offsets) {
        const at = atOnDate(day, e.startMinutes - off);
        if (at >= fromMs && at <= toMs) out.push(classNotification(e, off, at));
      }
    }
  }

  for (const n of planTaskNotifications(data, fromMs, toMs)) out.push(n);

  out.sort(function (a, b) { return a.at - b.at; });
  return out;
}

/** 滚动排程窗口：Android 对闹钟数量有限制，只排未来 N 天 */
export const ROLLING_WINDOW_DAYS = 7;

export function planRolling(data: TimetableData, prefs: ReminderPrefs, now: Date): PlannedNotification[] {
  const from = now.getTime();
  const to = from + ROLLING_WINDOW_DAYS * 86400000;
  return planNotifications(data, prefs, from, to);
}

/**
 * 错过补偿：App 启动时回扫过去 windowMinutes 分钟内本应发出、但日志里没有的通知。
 */
export function missedNotifications(
  planned: PlannedNotification[], fired: Record<string, number>, now: Date, windowMinutes: number
): PlannedNotification[] {
  const from = now.getTime() - windowMinutes * 60000;
  const to = now.getTime();
  return planned.filter(function (n) {
    return n.at >= from && n.at <= to && !fired[n.fingerprint];
  });
}
