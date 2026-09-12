import type {
  ClockTime, ConcreteEvent, Conflict, Course, DayOfWeek, ISODate,
  Override, Session, Term, TimetableData, WeekSelector,
} from './types';

/** 换楼预警阈值：两节课之间少于这么多分钟且不在同一栋楼才提示 */
export const BUILDING_TRANSFER_MINUTES = 20;

/* ------------------------- 时间工具 ------------------------- */

export function toMinutes(t: ClockTime): number {
  const parts = t.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

export function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

export function toISODate(d: Date): ISODate {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function parseISODate(s: ISODate): Date {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function dayOfWeekOf(d: Date): DayOfWeek {
  const js = d.getDay();
  return (js === 0 ? 7 : js) as DayOfWeek;
}

/** 取某天所在自然周的周一 */
export function mondayOf(d: Date): Date {
  return addDays(d, 1 - dayOfWeekOf(d));
}

/* ------------------------- 周次解析 ------------------------- */

/** 学期上限；未设置表示无限 */
export function weekLimitOf(term: Term): number {
  return term.totalWeeks === undefined ? Number.POSITIVE_INFINITY : term.totalWeeks;
}

/**
 * 第 week 周是否命中这个选择器。O(1)，不物化任何数组 ——
 * 这是让时间轴可以无限延伸的关键：判断一次，而不是生成整张表。
 */
export function weekMatches(sel: WeekSelector, week: number, limit: number): boolean {
  if (week < 1 || week > limit) return false;
  if (sel.type === 'all') return true;
  if (sel.type === 'list') return sel.weeks.indexOf(week) >= 0;
  const to = sel.to === undefined ? limit : Math.min(sel.to, limit);
  if (week < sel.from || week > to) return false;
  if (sel.type === 'range') return true;
  return (week - sel.from) % sel.step === 0;
}

/**
 * 把选择器展开成具体周次。只用于界面展示与有限场景，
 * 会先按 limit 收敛，避免无限学期导致死循环。
 */
export function weeksOf(sel: WeekSelector, total?: number): number[] {
  const limit = total === undefined ? MAX_ENUM_WEEKS : total;
  const out: number[] = [];
  if (sel.type === 'list') {
    for (const w of sel.weeks) if (w >= 1 && w <= limit) out.push(w);
    return out;
  }
  const from = sel.type === 'all' ? 1 : Math.max(1, sel.from);
  for (let i = from; i <= limit; i++) {
    if (weekMatches(sel, i, limit)) out.push(i);
  }
  return out;
}

/** weeksOf 在没有给出学期上限时最多展开多少周 */
export const MAX_ENUM_WEEKS = 200;

export function describeWeeks(sel: WeekSelector, total?: number): string {
  const tail = total === undefined ? ' (不设结束)' : '';
  if (sel.type === 'all') return (total === undefined ? '每周' : '1-' + total + ' 周') + tail;
  if (sel.type === 'list') return sel.weeks.join(',') + ' 周';
  const to = sel.to === undefined ? tail : '-' + sel.to + ' 周';
  if (sel.type === 'range') return sel.from + to;
  if (sel.step === 2) return (sel.from === 1 ? '单周' : '双周') + ' (' + sel.from + (sel.to === undefined ? tail : '-' + sel.to) + ')';
  return '每 ' + sel.step + ' 周，从第 ' + sel.from + ' 周起';
}

/* ------------------------- 日期映射 ------------------------- */

export function dateOf(term: Term, week: number, dow: DayOfWeek): Date {
  return addDays(parseISODate(term.startDate), (week - 1) * 7 + (dow - 1));
}

export function weekOfDate(term: Term, date: ISODate): number {
  const start = mondayOf(parseISODate(term.startDate));
  const target = mondayOf(parseISODate(date));
  const diff = Math.round((target.getTime() - start.getTime()) / 86400000);
  return Math.floor(diff / 7) + 1;
}

export function todayISO(): ISODate { return toISODate(new Date()); }

/* ------------------------- 时间引擎 ------------------------- */

function periodTimes(data: TimetableData, index: number): { start: ClockTime; end: ClockTime } {
  const scheme = data.schemes.find(function (s) { return s.id === data.term.periodSchemeId; }) || data.schemes[0];
  const p = scheme.periods.find(function (x) { return x.index === index; });
  if (p) return { start: p.start, end: p.end };
  return { start: '00:00', end: '00:00' };
}

function courseById(data: TimetableData, id: string): Course | undefined {
  return data.courses.find(function (c) { return c.id === id; });
}

/**
 * 一次调课最终落在哪一天：
 *   - 给了 newDate：就是 newDate（补课）
 *   - 给了不同的 dayOfWeek：同一教学周内的那一天
 *   - 否则：原地修改，还是原日期
 */
function overrideTargetDate(data: TimetableData, o: Override, session: Session): ISODate | null {
  if (o.action !== 'reschedule' || !o.patch) return null;
  if (o.patch.newDate) return o.patch.newDate;
  if (o.patch.dayOfWeek && o.patch.dayOfWeek !== session.dayOfWeek) {
    const w = weekOfDate(data.term, o.date);
    return toISODate(dateOf(data.term, w, o.patch.dayOfWeek));
  }
  return o.date;
}

/** 展开某一天的全部课程事件（含 Override 修正） */
export function expandDay(data: TimetableData, date: ISODate): ConcreteEvent[] {
  const term = data.term;
  const week = weekOfDate(term, date);
  const limit = weekLimitOf(term);
  if (week < 1 || week > limit) return [];
  const dow = dayOfWeekOf(parseISODate(date));
  const events: ConcreteEvent[] = [];

  /* 第一轮：这天本来就要上的课（含原地改节次、换教室） */
  for (const session of data.sessions) {
    if (session.dayOfWeek !== dow) continue;
    if (!weekMatches(session.weeks, week, limit)) continue;

    const ovs = data.overrides.filter(function (o) { return o.sessionId === session.id && o.date === date; });
    if (ovs.some(function (o) { return o.action === 'cancel'; })) continue;

    /* 被挪走了（补课到别的日期 / 改到本周别的天）→ 今天不再出现 */
    const movedAway = ovs.some(function (o) {
      const t = overrideTargetDate(data, o, session);
      return t !== null && t !== date;
    });
    if (movedAway) continue;

    let startIdx = session.periodStart;
    let endIdx = session.periodEnd;
    let location = session.location;
    let modified: string | undefined;

    const inPlace = ovs.find(function (o) { return o.action === 'reschedule'; });
    if (inPlace && inPlace.patch) {
      if (inPlace.patch.periodStart) startIdx = inPlace.patch.periodStart;
      if (inPlace.patch.periodEnd) endIdx = inPlace.patch.periodEnd;
      if (inPlace.patch.location) location = inPlace.patch.location;
      modified = inPlace.id;
    }
    const room = ovs.find(function (o) { return o.action === 'roomChange'; });
    if (room && room.patch && room.patch.location) {
      location = room.patch.location;
      modified = room.id;
    }

    events.push(buildEvent(data, session, date, week, startIdx, endIdx, location, session.building, modified));
  }

  /* 第二轮：从别的日期挪到今天的课（补课 / 改天） */
  for (const o of data.overrides) {
    if (o.action !== 'reschedule') continue;
    if (!o.patch || o.date === date) continue;
    const session = data.sessions.find(function (s) { return s.id === o.sessionId; });
    if (!session) continue;
    if (overrideTargetDate(data, o, session) !== date) continue;

    /* 原本那一周确实有这节课，才谈得上"补" */
    const srcWeek = weekOfDate(term, o.date);
    if (!weekMatches(session.weeks, srcWeek, limit)) continue;
    /* 原日期已经停课了，就没有补课一说 */
    const srcCancelled = data.overrides.some(function (x) {
      return x.sessionId === session.id && x.date === o.date && x.action === 'cancel';
    });
    if (srcCancelled) continue;

    const startIdx = o.patch.periodStart || session.periodStart;
    const endIdx = o.patch.periodEnd || session.periodEnd;
    events.push(buildEvent(
      data, session, date, week, startIdx, endIdx,
      o.patch.location || session.location, session.building, o.id
    ));
  }

  return dedupeSort(events);
}

function buildEvent(
  data: TimetableData, session: Session, date: ISODate, week: number,
  startIdx: number, endIdx: number, location: string | undefined,
  building: string | undefined, modified: string | undefined
): ConcreteEvent {
  const course = courseById(data, session.courseId);
  const t1 = periodTimes(data, startIdx);
  const t2 = periodTimes(data, endIdx);
  return {
    key: session.id + '@' + date,
    date: date, week: week, dayOfWeek: dayOfWeekOf(parseISODate(date)),
    courseId: session.courseId, sessionId: session.id,
    title: course ? course.name : '未命名课程',
    teacher: course ? course.teacher : undefined,
    start: t1.start, end: t2.end,
    startMinutes: toMinutes(t1.start), endMinutes: toMinutes(t2.end),
    periodStart: startIdx, periodEnd: endIdx,
    location: location, building: building,
    colorIndex: course ? course.colorIndex : 0,
    kind: session.kind, modifiedBy: modified,
  };
}

function dedupeSort(events: ConcreteEvent[]): ConcreteEvent[] {
  const seen: Record<string, boolean> = {};
  const out: ConcreteEvent[] = [];
  for (const e of events) { if (!seen[e.key]) { seen[e.key] = true; out.push(e); } }
  out.sort(function (a, b) { return a.startMinutes - b.startMinutes; });
  return out;
}

/** 展开某一教学周的全部事件 */
export function expandWeek(data: TimetableData, week: number): ConcreteEvent[] {
  const all: ConcreteEvent[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = toISODate(dateOf(data.term, week, d as DayOfWeek));
    const dayEvents = expandDay(data, date);
    for (const e of dayEvents) all.push(e);
  }
  return all;
}

/** 下一节课 */
export function nextEvent(
  data: TimetableData, now: Date
): { event: ConcreteEvent; startsInMinutes: number; ongoing: boolean } | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < 8; i++) {
    const date = toISODate(addDays(now, i));
    const events = expandDay(data, date);
    for (const e of events) {
      if (i === 0 && e.endMinutes <= nowMin) continue;
      const startsIn = i === 0 ? e.startMinutes - nowMin : e.startMinutes - nowMin + i * 1440;
      return { event: e, startsInMinutes: startsIn, ongoing: i === 0 && e.startMinutes <= nowMin };
    }
  }
  return null;
}

/** 冲突检测：时间重叠 / 换楼时间过紧 */
export function conflictsOf(data: TimetableData, date: ISODate): Conflict[] {
  const events = expandDay(data, date);
  const out: Conflict[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]; const b = events[j];
      if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
        out.push({ kind: 'timeOverlap', date: date, message: a.title + ' 与 ' + b.title + ' 时间重叠' });
      } else if (a.building && b.building && a.building !== b.building && (b.startMinutes - a.endMinutes) < BUILDING_TRANSFER_MINUTES) {
        out.push({
          kind: 'locationJump', date: date,
          message: a.title + ' → ' + b.title + ' 只有 ' + (b.startMinutes - a.endMinutes) + ' 分钟换楼',
        });
      }
    }
  }
  return out;
}

/** 空闲时段 */
export function freeSlots(data: TimetableData, date: ISODate): { start: ClockTime; end: ClockTime }[] {
  const events = expandDay(data, date);
  const scheme = data.schemes.find(function (s) { return s.id === data.term.periodSchemeId; }) || data.schemes[0];
  if (!scheme || scheme.periods.length === 0) return [];
  const dayStart = toMinutes(scheme.periods[0].start);
  const last = scheme.periods[scheme.periods.length - 1];
  const dayEnd = toMinutes(last.end);
  const busy = events.slice().sort(function (a, b) { return a.startMinutes - b.startMinutes; });
  const out: { start: ClockTime; end: ClockTime }[] = [];
  let cursor = dayStart;
  const minsToClock = function (m: number) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); };
  for (const e of busy) {
    if (e.startMinutes - cursor >= 60) out.push({ start: minsToClock(cursor), end: minsToClock(e.startMinutes) });
    if (e.endMinutes > cursor) cursor = e.endMinutes;
  }
  if (dayEnd - cursor >= 60) out.push({ start: minsToClock(cursor), end: minsToClock(endOfDay(scheme)) });
  return out;
}

function endOfDay(scheme: { periods: { end: ClockTime }[] }): number {
  return toMinutes(scheme.periods[scheme.periods.length - 1].end);
}

export function timeRangeLabel(data: TimetableData, startIdx: number, endIdx: number): string {
  const a = periodTimes(data, startIdx);
  const b = periodTimes(data, endIdx);
  return a.start + '-' + b.end;
}

/** 某个上课时段从某天起接下来的若干次具体日期（供"调哪一次"使用） */
export function occurrencesOf(
  data: TimetableData, sessionId: string, fromDate: ISODate, count: number, horizonDays?: number
): ISODate[] {
  const out: ISODate[] = [];
  const horizon = horizonDays === undefined ? 400 : horizonDays;
  const start = parseISODate(fromDate);
  for (let i = 0; i < horizon && out.length < count; i++) {
    const date = toISODate(addDays(start, i));
    const evs = expandDay(data, date);
    if (evs.some(function (e) { return e.sessionId === sessionId; })) out.push(date);
  }
  return out;
}

/** 整周的冲突，供界面一次性提示 */
export function weekConflicts(data: TimetableData, week: number): Conflict[] {
  const out: Conflict[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = toISODate(dateOf(data.term, week, d as DayOfWeek));
    const list = conflictsOf(data, date);
    for (const c of list) out.push(c);
  }
  return out;
}

/** 把 ISO 日期变成"周X 9/15"这种好读的短标签 */
export function shortDateLabel(date: ISODate): string {
  const d = parseISODate(date);
  const cn = ['日', '一', '二', '三', '四', '五', '六'];
  return '周' + cn[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
}
