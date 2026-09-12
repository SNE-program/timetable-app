import { addDays, dateOf, dayOfWeekOf, mondayOf, parseISODate, toISODate, toMinutes, weekOfDate, weeksOf } from './engine';
import type { Course, ISODate, PeriodScheme, Session, Term, TimetableData, WeekSelector } from './types';

/* =====================================================================
   ICS 读写。导出用 RRULE 保持紧凑；导入先把事件展开成"具体发生次数"，
   再归组成课程与上课时段 —— 这样教务导出那种扁平 ICS 也能吃。
   ===================================================================== */

const CRLF = '\r\n';
const PRODID = '-//Timetable App//课表//CN';

/* ------------------------------ 文本处理 ------------------------------ */

function escapeText(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unescapeText(s: string): string {
  return String(s)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * RFC5545 要求每行不超过 75 个八位组，超出要折行。
 *
 * 这里用 TextEncoder 而不是 Buffer：Buffer 是 Node 专有全局，
 * 单测跑在 Node 里所以一直没暴露，真机 WebView 里会直接 ReferenceError。
 * 折行后每行开头要多一个空格，所以续行只能放 74 个八位组。
 */
const utf8 = new TextEncoder();

function fold(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = utf8.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curLen + len > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  if (cur) out.push(cur);
  return out.join(CRLF + ' ');
}

/** 反向：把折行还原成逻辑行 */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (out.length) out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/* ------------------------------ 时间处理 ------------------------------ */

function pad(n: number, w?: number): string { return String(n).padStart(w || 2, '0'); }

function stampUTC(d: Date): string {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}

/** 本地浮动时间：不带 Z、不带 TZID，日历按本地时区解释，正是课表想要的 */
function stampLocal(date: ISODate, minutes: number): string {
  const p = date.split('-');
  return p[0] + p[1] + p[2] + 'T' + pad(Math.floor(minutes / 60)) + pad(minutes % 60) + '00';
}

interface IcsDateTime { date: ISODate; minutes: number; allDay: boolean; }

function parseIcsDateTime(value: string, params: Record<string, string>): IcsDateTime | null {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (m) {
    const isUtc = !!m[7];
    if (isUtc) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0));
      return { date: toISODate(d), minutes: d.getHours() * 60 + d.getMinutes(), allDay: false };
    }
    return {
      date: m[1] + '-' + m[2] + '-' + m[3],
      minutes: Number(m[4]) * 60 + Number(m[5]),
      allDay: false,
    };
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { date: m[1] + '-' + m[2] + '-' + m[3], minutes: 0, allDay: true };
  return null;
}

/* ------------------------------ 导出 ------------------------------ */

export interface IcsExportOptions {
  /** 导出范围；不传则用学期范围，学期不设结束时取 52 周 */
  maxWeeks?: number;
  /** 是否写入 VALARM 提醒 */
  includeAlarms?: boolean;
}

function weeksOfBounded(data: TimetableData, session: Session, maxWeeks: number): number[] {
  const list = weeksOf(session.weeks, data.term.totalWeeks === undefined ? maxWeeks : data.term.totalWeeks);
  return list.filter(function (w) { return w <= maxWeeks; });
}

/** 把周次压缩成 RRULE 能表达的形式；表达不了就返回 null（退化成逐条事件） */
function rruleFor(weeks: number[], firstDate: ISODate, scheme: PeriodScheme, data: TimetableData): string | null {
  if (weeks.length === 0) return null;
  const lastWeek = weeks[weeks.length - 1];
  const lastDate = toISODate(dateOf(data.term, lastWeek, dayOfWeekOf(parseISODate(firstDate))));
  const lastPeriod = scheme.periods[scheme.periods.length - 1];
  const until = stampLocal(lastDate, lastPeriod ? toMinutes(lastPeriod.end) : 0);

  if (weeks.length === 1) return null;
  const step = weeks.length > 1 ? weeks[1] - weeks[0] : 1;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] - weeks[i - 1] !== step) return null;
  }
  if (step !== 1 && step !== 2) return null;
  const interval = step === 2 ? ';INTERVAL=2' : '';
  return 'FREQ=WEEKLY' + interval + ';UNTIL=' + until;
}

export function exportIcs(data: TimetableData, opts?: IcsExportOptions): string {
  const maxWeeks = (opts && opts.maxWeeks) || (data.term.totalWeeks === undefined ? 52 : data.term.totalWeeks);
  const includeAlarms = !(opts && opts.includeAlarms === false);
  const scheme = data.schemes.find(function (s) { return s.id === data.term.periodSchemeId; }) || data.schemes[0];
  const now = new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + PRODID,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(data.term.name || '我的课表'),
  ];

  for (const session of data.sessions) {
    const course = data.courses.find(function (c) { return c.id === session.courseId; });
    if (!course) continue;

    const startP = scheme.periods.find(function (p) { return p.index === session.periodStart; });
    const endP = scheme.periods.find(function (p) { return p.index === session.periodEnd; });
    if (!startP || !endP) continue;

    const weeks = weeksOfBounded(data, session, maxWeeks);
    if (weeks.length === 0) continue;

    const firstDate = toISODate(dateOf(data.term, weeks[0], session.dayOfWeek));
    const startMin = toMinutes(startP.start);
    const endMin = toMinutes(endP.end);
    const title = course.name + (session.kind === 'lab' ? '（实验）' : '');
    const desc = [course.teacher ? '教师：' + course.teacher : '', course.note || ''].filter(Boolean).join('\n');

    /* 停课：作为 EXDATE 排除 */
    const cancelled = data.overrides
      .filter(function (o) { return o.sessionId === session.id && o.action === 'cancel'; })
      .map(function (o) { return stampLocal(o.date, startMin); });

    /* 被挪走的那几次，原位置也要排除 */
    const movedAway = data.overrides.filter(function (o) {
      return o.sessionId === session.id && o.action === 'reschedule' &&
        (o.patch && (o.patch.newDate || (o.patch.dayOfWeek && o.patch.dayOfWeek !== session.dayOfWeek)));
    }).map(function (o) { return stampLocal(o.date, startMin); });

    const exdates = cancelled.concat(movedAway);
    const rrule = rruleFor(weeks, firstDate, scheme, data);
    const chunks: number[][] = rrule ? [weeks] : weeks.map(function (w) { return [w]; });

    for (const chunk of chunks) {
      const chunkFirst = toISODate(dateOf(data.term, chunk[0], session.dayOfWeek));
      const chunkRrule = rrule ? rrule : null;
      const uid = session.id + '-' + chunk[0] + '@timetable';
      const ev: string[] = [
        'BEGIN:VEVENT',
        'UID:' + uid,
        'DTSTAMP:' + stampUTC(now),
        'DTSTART:' + stampLocal(chunkFirst, startMin),
        'DTEND:' + stampLocal(chunkFirst, endMin),
        'SUMMARY:' + escapeText(title),
      ];
      if (session.location) ev.push('LOCATION:' + escapeText(session.location));
      if (desc) ev.push('DESCRIPTION:' + escapeText(desc));
      if (chunkRrule) ev.push('RRULE:' + chunkRrule);
      if (!rrule && exdates.length === 0) {
        /* 逐条事件，不需要 RRULE */
      }
      if (exdates.length) ev.push('EXDATE:' + exdates.join(','));
      if (includeAlarms) {
        const rule = data.reminderRules.find(function (r) { return r.scope === 'session' && r.sessionId === session.id; })
          || data.reminderRules.find(function (r) { return r.scope === 'course' && r.courseId === session.courseId; });
        const offs = rule ? (rule.enabled ? rule.offsetsMinutes : []) : [15];
        for (const off of offs) ev.push('BEGIN:VALARM', 'TRIGGER:-PT' + off + 'M', 'ACTION:DISPLAY', 'DESCRIPTION:' + escapeText(title), 'END:VALARM');
      }
      ev.push('END:VEVENT');
      for (const l of ev) lines.push(l);
    }

    /* 补课 / 改期：作为独立事件写出去 */
    for (const o of data.overrides) {
      if (o.sessionId !== session.id || o.action !== 'reschedule' || !o.patch) continue;
      let targetDate: ISODate | null = null;
      if (o.patch.newDate) targetDate = o.patch.newDate;
      else if (o.patch.dayOfWeek && o.patch.dayOfWeek !== session.dayOfWeek) {
        targetDate = toISODate(dateOf(data.term, weekOfDate(data.term, o.date), o.patch.dayOfWeek));
      }
      if (!targetDate) continue;
      const ps = scheme.periods.find(function (p) { return p.index === (o.patch!.periodStart || session.periodStart); });
      const pe = scheme.periods.find(function (p) { return p.index === (o.patch!.periodEnd || session.periodEnd); });
      if (!ps || !pe) continue;
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + o.id + '@timetable',
        'DTSTAMP:' + stampUTC(now),
        'DTSTART:' + stampLocal(targetDate, toMinutes(ps.start)),
        'DTEND:' + stampLocal(targetDate, toMinutes(pe.end)),
        'SUMMARY:' + escapeText(title + '（补课）'),
        'LOCATION:' + escapeText(o.patch.location || session.location || ''),
        'DESCRIPTION:' + escapeText(o.reason || '调课'),
        'END:VEVENT'
      );
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

/* ------------------------------ 解析 ------------------------------ */

interface RawEvent { props: Record<string, string>; params: Record<string, Record<string, string>>; }

function parseProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name: name, params: params, value: value };
}

function parseIcs(text: string): RawEvent[] {
  const lines = unfold(text);
  const events: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { props: {}, params: {} }; depth = 0; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (line.indexOf('BEGIN:VALARM') === 0) { depth++; continue; }
    if (line.indexOf('END:VALARM') === 0) { depth--; continue; }
    if (depth > 0) continue;
    const p = parseProperty(line);
    if (!p) continue;
    if (p.name === 'EXDATE' || p.name === 'RDATE') {
      cur.props[p.name] = cur.props[p.name] ? cur.props[p.name] + ',' + p.value : p.value;
      cur.params[p.name] = p.params;
      continue;
    }
    if (cur.props[p.name] === undefined) {
      cur.props[p.name] = p.value;
      cur.params[p.name] = p.params;
    }
  }
  return events;
}

interface Occurrence { date: ISODate; startMin: number; endMin: number; summary: string; location: string; }

/** 把一条 VEVENT（含 RRULE / EXDATE）展开成具体发生次数 */
function expandRawEvent(ev: RawEvent): Occurrence[] {
  const dtStart = ev.props.DTSTART ? parseIcsDateTime(ev.props.DTSTART, ev.params.DTSTART || {}) : null;
  if (!dtStart || dtStart.allDay) return [];
  const dtEnd = ev.props.DTEND ? parseIcsDateTime(ev.props.DTEND, ev.params.DTEND || {}) : null;
  let endMin = dtEnd && dtEnd.date === dtStart.date ? dtEnd.minutes : dtStart.minutes + 45;
  if (endMin <= dtStart.minutes) endMin = dtStart.minutes + 45;

  const summary = unescapeText(ev.props.SUMMARY || '').trim() || '未命名课程';
  const location = unescapeText(ev.props.LOCATION || '').trim();

  const exdates: Record<string, boolean> = {};
  if (ev.props.EXDATE) {
    for (const piece of ev.props.EXDATE.split(',')) {
      const d = parseIcsDateTime(piece.trim(), {});
      if (d) exdates[d.date] = true;
    }
  }

  const out: Occurrence[] = [];
  const push = function (date: ISODate) {
    if (exdates[date]) return;
    out.push({ date: date, startMin: dtStart.minutes, endMin: endMin, summary: summary, location: location });
  };

  const rrule = ev.props.RRULE || '';
  if (!rrule) { push(dtStart.date); return out; }

  const rule: Record<string, string> = {};
  for (const seg of rrule.split(';')) {
    const eq = seg.indexOf('=');
    if (eq > 0) rule[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  if ((rule.FREQ || '').toUpperCase() !== 'WEEKLY') { push(dtStart.date); return out; }

  const interval = Number(rule.INTERVAL || 1) || 1;
  let count = rule.COUNT ? Number(rule.COUNT) : 0;
  let until: ISODate | null = null;
  if (rule.UNTIL) {
    const u = parseIcsDateTime(rule.UNTIL, {});
    if (u) until = u.date;
  }
  if (!count && !until) count = 53;

  const start = parseISODate(dtStart.date);
  for (let i = 0; i < 400; i++) {
    const date = toISODate(addDays(start, i * 7 * interval));
    if (until && date > until) break;
    if (count && out.length >= count) break;
    push(date);
  }
  return out;
}

/* ------------------------------ 归组 ------------------------------ */

function compressWeeks(weeks: number[]): WeekSelector {
  const uniq = Array.from(new Set(weeks)).sort(function (a, b) { return a - b; });
  if (uniq.length === 0) return { type: 'list', weeks: [] };
  if (uniq.length === 1) return { type: 'list', weeks: uniq };
  const step = uniq[1] - uniq[0];
  let arithmetic = step === 1 || step === 2;
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] - uniq[i - 1] !== step) { arithmetic = false; break; }
  }
  if (!arithmetic) return { type: 'list', weeks: uniq };
  if (step === 1) return { type: 'range', from: uniq[0], to: uniq[uniq.length - 1] };
  return { type: 'stepped', from: uniq[0], to: uniq[uniq.length - 1], step: 2 };
}

function matchPeriod(scheme: PeriodScheme, minutes: number, useEnd: boolean): { index: number; drift: number } | null {
  if (scheme.periods.length === 0) return null;
  let best: { index: number; drift: number } | null = null;
  for (const p of scheme.periods) {
    const t = toMinutes(useEnd ? p.end : p.start);
    const drift = Math.abs(t - minutes);
    if (!best || drift < best.drift) best = { index: p.index, drift: drift };
  }
  return best;
}

export interface IcsImportResult {
  data: TimetableData;
  courses: number;
  sessions: number;
  skipped: number;
  warnings: string[];
}

/**
 * 导入 ICS。把事件展开成具体发生次数后，按 (课程名, 星期, 节次, 教室) 归组，
 * 每一组合并成一个上课时段，周次压缩成 range / 单双周 / 列表。
 */
export function importIcs(text: string, base: TimetableData): IcsImportResult {
  const warnings: string[] = [];
  const scheme = base.schemes.find(function (s) { return s.id === base.term.periodSchemeId; }) || base.schemes[0];
  if (!scheme) {
    return { data: base, courses: 0, sessions: 0, skipped: 0, warnings: ['没有作息方案，无法导入'] };
  }

  const rawEvents = parseIcs(text);
  if (rawEvents.length === 0) warnings.push('文件里没有找到任何日程（VEVENT）');

  const all: Occurrence[] = [];
  let skipped = 0;
  for (const ev of rawEvents) {
    const occ = expandRawEvent(ev);
    if (occ.length === 0) skipped++;
    for (const o of occ) all.push(o);
  }

  /* 课表还是空的时候，把学期对齐到导入内容的第一周 —— 这是"新学期导入新课表"的主场景 */
  let term: Term = base.term;
  const dates = all.map(function (o) { return o.date; }).sort();
  if (dates.length > 0 && base.courses.length === 0 && base.sessions.length === 0) {
    const aligned = toISODate(mondayOf(parseISODate(dates[0])));
    if (aligned !== term.startDate) {
      term = Object.assign({}, term, { startDate: aligned });
      warnings.push('课表原本是空的，已把开学日期对齐到导入内容的第一周（' + aligned + '）');
    }
  }

  const groups: Record<string, Occurrence[]> = {};
  let driftWarned = 0;
  let outOfRange = 0;

  for (const o of all) {
    const ps = matchPeriod(scheme, o.startMin, false);
    const pe = matchPeriod(scheme, o.endMin, true);
    if (!ps || !pe) { skipped++; continue; }
    if ((ps.drift > 10 || pe.drift > 10) && driftWarned < 3) {
      driftWarned++;
      warnings.push('「' + o.summary + '」的时间与作息对不上（偏 ' + Math.max(ps.drift, pe.drift) + ' 分钟），已就近归到第 ' + ps.index + '-' + pe.index + ' 节');
    }
    const week = weekOfDate(term, o.date);
    if (week < 1 || (term.totalWeeks !== undefined && week > term.totalWeeks)) { outOfRange++; skipped++; continue; }
    const key = [o.summary, o.location, dayOfWeekOf(parseISODate(o.date)), ps.index, pe.index].join('\u0001');
    (groups[key] = groups[key] || []).push(o);
  }

  const courses: Course[] = [];
  const sessions: Session[] = [];
  const byName: Record<string, string> = {};
  const now = Date.now();
  let idx = 0;

  for (const key in groups) {
    const list = groups[key];
    const first = list[0];
    let courseId = byName[first.summary];
    if (!courseId) {
      courseId = 'ic' + (now + idx);
      idx++;
      byName[first.summary] = courseId;
      courses.push({
        id: courseId,
        name: first.summary,
        colorIndex: courses.length % 12,
        tags: ['导入'],
      });
    }
    sessions.push({
      id: 'is' + (now + idx) + '-' + sessions.length,
      courseId: courseId,
      dayOfWeek: dayOfWeekOf(parseISODate(first.date)),
      periodStart: matchPeriod(scheme, first.startMin, false)!.index,
      periodEnd: matchPeriod(scheme, first.endMin, true)!.index,
      weeks: compressWeeks(list.map(function (o) { return weekOfDate(term, o.date); })),
      location: first.location || undefined,
    });
  }

  const existingNames: Record<string, boolean> = {};
  for (const c of base.courses) existingNames[c.name] = true;
  const dup = courses.filter(function (c) { return existingNames[c.name]; }).length;
  if (dup > 0) warnings.push('有 ' + dup + ' 门课与现有课程同名，可能会重复显示');
  if (outOfRange > 0) {
    warnings.push(outOfRange + ' 条日程不在学期范围内，已忽略（可在设置里调整开学日期）');
  }

  return {
    data: Object.assign({}, base, {
      term: term,
      courses: base.courses.concat(courses),
      sessions: base.sessions.concat(sessions),
    }),
    courses: courses.length,
    sessions: sessions.length,
    skipped: skipped,
    warnings: warnings,
  };
}
