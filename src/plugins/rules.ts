import { addDays, expandDay, pad2, parseISODate, toISODate } from '../core/engine';
import { humanDuration } from '../core/duration';
import type { PlannedNotification, NotificationKind } from '../core/reminders';
import type { TimetableData } from '../core/types';
import type { RuleCapability } from './types';

/**
 * 插件规则的排程器（纯函数）。
 *
 * ## 它做的事只有一件
 *
 * 把"插件声明的规则 + 用户的课表"展开成**与内置提醒同一种**的排程项
 * （`PlannedNotification`）。于是后面那一整套都不用重写：
 *
 *   - 去重（`fingerprint` + `timetable.notiflog.v1` 日志）
 *   - 错过补偿（启动时回扫 15 分钟）
 *   - 滚动排程（只排未来 7 天，Android 对闹钟数量有限制）
 *
 * **这是"插件只是参数"最实在的样子**：排程、去重、补发、发送全部是宿主已有的代码。
 *
 * ## 三条硬限制，都由宿主定
 *
 *   1. 模板占位符必须来自白名单（安装时校验，运行时再兜一次）；
 *   2. 每小时最多 `RULE_PER_HOUR_MAX` 条 —— 用户装了插件不等于同意被刷屏，
 *      而通知是**应用发的**，刷屏的责任在应用；
 *   3. 文案长度上限 40 / 120 —— 通知栏放不下更多。
 */

/** 每个插件最多几条规则 */
export const RULE_MAX_PER_PLUGIN = 4;

/**
 * 所有插件加起来、**每小时**最多发几条规则通知。
 *
 * 为什么是 6：一上午最多 4 节课，加上任务提醒，正常使用很难超过；
 * 而"装了个插件之后手机一小时响二十次"是不可接受的 —— 那会让人直接关掉整个应用的通知，
 * 连真正重要的上课提醒一起关掉。**保护通知渠道的可信度，比多提醒一条更重要。**
 */
export const RULE_PER_HOUR_MAX = 6;

/** 一条规则最早/最晚能提前多久（分钟）：1 分钟到 7 天 */
export const RULE_MIN_MINUTES = 1;
export const RULE_MAX_MINUTES = 7 * 24 * 60;

/** 规则排出来的通知走这个 kind（`reminderRuntime` 据此选渠道） */
export const RULE_KIND: NotificationKind = 'rule';

export interface ActiveRule {
  pluginId: string;
  pluginName: string;
  capability: RuleCapability;
}

function clock(minutesOfDay: number): string {
  return pad2(Math.floor(minutesOfDay / 60)) + ':' + pad2(minutesOfDay % 60);
}

function atOnDate(day: Date, minutesOfDay: number): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0).getTime();
}

/**
 * 模板里没在白名单里的占位符一律**抹掉**（连同花括号）。
 *
 * 安装时已经拒过一遍了，这里再兜一次的理由很实际：规则可以从 localStorage 里被改，
 * 而"一个没被替换的 {something} 直接发到通知栏"是用户看得见、却完全看不懂的东西。
 */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return String(text || '').replace(/\{[a-z0-9._]+\}/gi, function (m) {
    const hit = vars[m];
    return hit === undefined ? '' : hit;
  });
}

/** 每条规则能用的变量（缺的给空串 —— 通知里宁可少一段，也不要漏出占位符） */
function varsForTask(t: { title: string; due?: string; dueMinutes?: number; note?: string; courseId?: string }, courses: TimetableData['courses'], minutes: number): Record<string, string> {
  const course = t.courseId ? courses.filter(function (c) { return c.id === t.courseId })[0] : undefined;
  const dueMin = t.dueMinutes === undefined ? 23 * 60 + 59 : t.dueMinutes;
  return {
    '{task.title}': t.title || '',
    '{task.due}': t.due ? t.due + ' ' + clock(dueMin) : '',
    '{task.course}': course ? course.name : '',
    '{task.note}': t.note || '',
    '{minutes}': String(minutes),
  };
}

interface RuleScope {
  '{course.name}': string;
  '{course.room}': string;
  '{course.teacher}': string;
  '{class.start}': string;
  '{class.end}': string;
  '{today.count}': string;
  '{today.first}': string;
  '{term.name}': string;
  '{week}': string;
}

function baseVars(data: TimetableData, day: Date, minutes: number): RuleScope & Record<string, string> {
  const date = toISODate(day);
  const events = expandDay(data, date);
  const first = events[0];
  return {
    '{course.name}': '',
    '{course.room}': '',
    '{course.teacher}': '',
    '{class.start}': '',
    '{class.end}': '',
    '{today.count}': String(events.length),
    '{today.first}': first ? first.title : '',
    '{term.name}': data.term && data.term.name ? data.term.name : '',
    '{week}': String(weekOf(data, day)),
    '{minutes}': String(minutes),
  };
}

/** 当前周次（与界面上的"第 N 周"同一个算法，但仍然夹在学期范围内） */
function weekOf(data: TimetableData, day: Date): number {
  const start = data.term && data.term.startDate ? parseISODate(data.term.startDate) : null;
  if (!start) return 1;
  const ms = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
    - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const w = Math.floor(ms / (7 * 86400000)) + 1;
  const max = data.term && data.term.totalWeeks ? data.term.totalWeeks : 20;
  return Math.min(Math.max(1, w), Math.max(1, max));
}

function clip(s: string, max: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * 展开全部规则 → 排程项。
 *
 * 入参里的 `fromMs`/`toMs` 与内置提醒用的是同一个窗口（未来 7 天），
 * 所以两边的排程天然在同一时间轴上，排序、补发都不会错位。
 */
export function planRuleNotifications(
  rules: ActiveRule[], data: TimetableData, fromMs: number, toMs: number
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  if (!rules || rules.length === 0 || toMs <= fromMs) return out;
  const startDay = new Date(fromMs);
  const days = Math.ceil((toMs - fromMs) / 86400000) + 1;

  for (const r of rules) {
    const cap = r.capability;
    const minutes = typeof cap.when.minutes === 'number' ? cap.when.minutes : 0;

    /* ---- 任务到期前 N 分钟 ---- */
    if (cap.when.event === 'task.dueSoon') {
      for (const t of data.tasks || []) {
        if (t.done || !t.due) continue;
        const p = t.due.split('-').map(Number);
        if (p.length !== 3 || !isFinite(p[0])) continue;
        const dueMin = t.dueMinutes === undefined ? 23 * 60 + 59 : t.dueMinutes;
        const dueAt = new Date(p[0], p[1] - 1, p[2], Math.floor(dueMin / 60), dueMin % 60, 0, 0).getTime();
        const at = dueAt - minutes * 60000;
        if (at < fromMs || at > toMs) continue;
        const vars = Object.assign(baseVars(data, new Date(dueAt), minutes), varsForTask(t, data.courses, minutes));
        out.push({
          fingerprint: 'rule:' + r.pluginId + ':' + cap.id + '@task:' + t.id + '#' + minutes,
          kind: RULE_KIND,
          eventKey: 'rule@' + r.pluginId + ':' + cap.id + ':' + t.id,
          title: clip(fillTemplate(cap.then.notify.title, vars), 40),
          body: clip(fillTemplate(cap.then.notify.body, vars), 120),
          at: at,
          date: t.due,
          offsetMinutes: minutes,
          courseId: t.courseId,
        });
      }
      continue;
    }

    for (let i = 0; i < days; i++) {
      const day = addDays(startDay, i);
      const date = toISODate(day);

      /* ---- 每天固定时刻 ---- */
      if (cap.when.event === 'daily.at') {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(cap.when.at || ''));
        if (!m) continue;
        const minuteOfDay = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]));
        const at = atOnDate(day, minuteOfDay);
        if (at < fromMs || at > toMs) continue;
        const vars = baseVars(data, day, minutes);
        /* 今天一节课都没有就不打扰（用户装这类规则是为了"今天有什么"，不是说早安） */
        if (vars['{today.count}'] === '0') continue;
        out.push({
          fingerprint: 'rule:' + r.pluginId + ':' + cap.id + '@day:' + date,
          kind: RULE_KIND,
          eventKey: 'rule@' + r.pluginId + ':' + cap.id + ':' + date,
          title: clip(fillTemplate(cap.then.notify.title, vars), 40),
          body: clip(fillTemplate(cap.then.notify.body, vars), 120),
          at: at,
          date: date,
          offsetMinutes: 0,
        });
        continue;
      }

      /* ---- 上课前 N 分钟 ---- */
      if (cap.when.event === 'class.before') {
        for (const e of expandDay(data, date)) {
          const at = atOnDate(day, e.startMinutes - minutes);
          if (at < fromMs || at > toMs) continue;
          const vars = Object.assign(baseVars(data, day, minutes), {
            '{course.name}': e.title,
            '{course.room}': e.location || '',
            '{course.teacher}': e.teacher || '',
            '{class.start}': e.start,
            '{class.end}': e.end,
          });
          out.push({
            fingerprint: 'rule:' + r.pluginId + ':' + cap.id + '@' + e.sessionId + ':' + date + '#' + minutes,
            kind: RULE_KIND,
            eventKey: 'rule@' + r.pluginId + ':' + cap.id + ':' + e.key,
            title: clip(fillTemplate(cap.then.notify.title, vars), 40),
            body: clip(fillTemplate(cap.then.notify.body, vars), 120),
            at: at,
            date: date,
            offsetMinutes: minutes,
            courseId: e.courseId,
            sessionId: e.sessionId,
          });
        }
      }
    }
  }

  return out;
}

/**
 * 频率上限：任意一个**滑动小时**内最多 `perHour` 条。
 *
 * 实现方式是"先按时间排序，再看每条往前一小时里有几条已经留下"——
 * 而不是按整点分桶。分桶会出现"59 分发 6 条、01 分发 6 条"这种一分钟内十二条的情况，
 * 而用户感受到的打扰就是按分钟计的。
 *
 * 被丢掉的项**不写进日志**，所以下一个窗口它还会被重新排上（不会静默丢失）。
 */
export function applyRateLimit(items: PlannedNotification[], perHour: number): PlannedNotification[] {
  const sorted = items.slice().sort(function (a, b) { return a.at - b.at; });
  const kept: PlannedNotification[] = [];
  for (const n of sorted) {
    const since = n.at - 3600000;
    let count = 0;
    for (const k of kept) if (k.at > since) count++;
    if (count >= perHour) continue;
    kept.push(n);
  }
  return kept;
}

/** 排序 + 限流 + 去重后的规则排程（`reminderRuntime` 直接用它） */
export function planRuleNotificationsLimited(
  rules: ActiveRule[], data: TimetableData, fromMs: number, toMs: number
): PlannedNotification[] {
  const raw = planRuleNotifications(rules, data, fromMs, toMs);
  const seen: Record<string, boolean> = {};
  const unique: PlannedNotification[] = [];
  for (const n of raw) {
    if (seen[n.fingerprint]) continue;
    seen[n.fingerprint] = true;
    unique.push(n);
  }
  return applyRateLimit(unique, RULE_PER_HOUR_MAX);
}

/** 给界面用的一句话描述：这条规则什么时候会响 */
export function describeRule(cap: RuleCapability): string {
  const m = typeof cap.when.minutes === 'number' ? cap.when.minutes : 0;
  if (cap.when.event === 'task.dueSoon') return '任务截止前 ' + humanDuration(m);
  if (cap.when.event === 'class.before') return '每节课开始前 ' + humanDuration(m);
  return '每天 ' + String(cap.when.at || '—');
}
