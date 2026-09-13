import type { ConcreteEvent, Course, ISODate, Session, TimetableData } from './types';
import { expandDay, expandWeek, shortDateLabel, todayISO, weekOfDate } from './engine';

/**
 * 导出格式生成器。
 *
 * 这里是**纯函数**：给定课表数据和一些选项，产出一段文本。
 * 插件系统只负责"选哪些列、导出哪一段"，真正的生成逻辑全部落在这里 ——
 * 这样插件永远是声明式的（不需要执行第三方代码），而生成逻辑可以被单测锁死。
 */

/**
 * 可导出的列。
 *
 * 分三组，对应三种数据（见 SCOPE_COLUMNS）：
 *   课表：date / weekday / week / period / start / end / course / teacher / location / building / note
 *   任务：task / due / done / course / note
 *   出勤：date / course / status / note
 *
 * 不同数据共用一个列名空间（`course`、`note` 都有意义），各 scope 只填自己认识的那些。
 */
export type ExportColumn =
  | 'date' | 'weekday' | 'week' | 'period' | 'start' | 'end'
  | 'course' | 'teacher' | 'location' | 'building' | 'note'
  | 'task' | 'due' | 'done' | 'status';

export const COLUMN_LABEL: Record<ExportColumn, string> = {
  date: '日期', weekday: '星期', week: '周次', period: '节次',
  start: '开始', end: '结束', course: '课程', teacher: '教师',
  location: '教室', building: '教学楼', note: '备注',
  task: '任务', due: '截止', done: '状态', status: '考勤',
};

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

export interface ExportRow {
  [key: string]: string;
}

/** 把一次具体上课展开成一行。任务/考勤那几列在课表里没有对应值，留空 */
export function eventToRow(e: ConcreteEvent, week: number, cols: ExportColumn[]): ExportRow {
  const all: Record<ExportColumn, string> = {
    date: e.date,
    weekday: '周' + WEEKDAY_CN[e.dayOfWeek - 1],
    week: '第 ' + week + ' 周',
    period: e.periodStart === e.periodEnd ? String(e.periodStart) : e.periodStart + '-' + e.periodEnd,
    start: e.start,
    end: e.end,
    course: e.title,
    teacher: e.teacher || '',
    location: e.location || '',
    building: e.building || '',
    note: e.kind === 'lab' ? '实验' : e.kind === 'exam' ? '考试' : e.kind === 'pe' ? '体育' : '',
    /* 下面四列属于任务 / 考勤数据，课表里没有它们的值 */
    task: '', due: '', done: '', status: '',
  };
  const row: ExportRow = {};
  for (const c of cols) row[c] = all[c];
  return row;
}

/** 指定周的全部课程 */
export function weekRows(data: TimetableData, week: number, cols: ExportColumn[]): ExportRow[] {
  return expandWeek(data, week).map(function (e) { return eventToRow(e, week, cols); });
}

/** 整学期（按周展开；不设结束的学期只展开前 maxWeeks 周，避免导出无穷大） */
export function termRows(data: TimetableData, cols: ExportColumn[], maxWeeks?: number): ExportRow[] {
  const limit = data.term.totalWeeks === undefined
    ? Math.min(maxWeeks || 20, 20)
    : Math.min(data.term.totalWeeks, maxWeeks || data.term.totalWeeks);
  const out: ExportRow[] = [];
  for (let w = 1; w <= limit; w++) {
    out.push.apply(out, weekRows(data, w, cols));
  }
  return out;
}

/** 课程 / 教师 / 教室清单：去重后一行一门课，适合做通讯录或检查录入是否有漏 */
export function courseRows(data: TimetableData): ExportRow[] {
  return data.courses.map(function (c: Course) {
    const mine = data.sessions.filter(function (s: Session) { return s.courseId === c.id; });
    const rooms: string[] = [];
    for (const s of mine) {
      const r = [s.building, s.location].filter(Boolean).join(' ');
      if (r && rooms.indexOf(r) < 0) rooms.push(r);
    }
    const periods = mine.map(function (s) {
      return '周' + WEEKDAY_CN[s.dayOfWeek - 1] + ' 第' + s.periodStart + '-' + s.periodEnd + '节';
    });
    return {
      course: c.name,
      teacher: c.teacher || '',
      location: rooms.join(' / '),
      period: periods.join('；'),
      note: (c.tags || []).join(' '),
    };
  });
}

/** CSV 单元格转义：含逗号、引号、换行时必须包起来并把引号翻倍（RFC4180） */
export function csvCell(v: string): string {
  const s = String(v === undefined || v === null ? '' : v);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 生成 CSV。
 * 加 UTF-8 BOM —— 不加的话 Excel 打开中文会全是乱码，这是最常见的"导出坏了"投诉。
 */
export function toCsv(rows: ExportRow[], cols: ExportColumn[], withBom: boolean = true): string {
  const head = cols.map(function (c) { return csvCell(COLUMN_LABEL[c]); }).join(',');
  const body = rows.map(function (r) {
    return cols.map(function (c) { return csvCell(r[c] || ''); }).join(',');
  });
  return (withBom ? '\uFEFF' : '') + [head].concat(body).join('\r\n') + '\r\n';
}

/** Markdown 表格；竖线要转义，否则表格会被撑破 */
export function toMarkdown(rows: ExportRow[], cols: ExportColumn[], title?: string): string {
  const esc = function (v: string): string {
    return String(v === undefined || v === null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  };
  const lines: string[] = [];
  if (title) lines.push('# ' + title, '');
  lines.push('| ' + cols.map(function (c) { return COLUMN_LABEL[c]; }).join(' | ') + ' |');
  lines.push('| ' + cols.map(function () { return '---'; }).join(' | ') + ' |');
  for (const r of rows) {
    lines.push('| ' + cols.map(function (c) { return esc(r[c] || ''); }).join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

/** 按课程分组的小节式 Markdown，适合粘进笔记 */
export function toGroupedMarkdown(data: TimetableData): string {
  const rows = courseRows(data);
  const lines: string[] = ['# ' + data.term.name + ' · 课程清单', ''];
  lines.push('共 ' + data.courses.length + ' 门课，' + data.sessions.length + ' 个上课时段。', '');
  for (const r of rows) {
    lines.push('## ' + (r.course || '未命名'));
    if (r.teacher) lines.push('- 教师：' + r.teacher);
    if (r.location) lines.push('- 教室：' + r.location);
    if (r.period) lines.push('- 时间：' + r.period);
    if (r.note) lines.push('- 标签：' + r.note);
    lines.push('');
  }
  return lines.join('\n');
}

/** 导出时用的默认文件名（去文件名里的非法字符） */
export function exportFileName(base: string, ext: string): string {
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  return safe + ext;
}

/** 当前周次，导出入口常用 */
export function currentWeek(data: TimetableData): number {
  return weekOfDate(data.term, todayISO());
}

/* ------------------------------ 任务与出勤 ------------------------------ */

/** 任务 / DDL 清单：一行一项 */
export function taskRows(data: TimetableData, cols: ExportColumn[]): ExportRow[] {
  const courseName = function (id: string | undefined): string {
    if (!id) return '';
    const c = data.courses.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : '';
  };
  return data.tasks.map(function (t) {
    const all: Record<string, string> = {
      task: t.title || '',
      due: t.due ? t.due + (t.dueMinutes !== undefined ? ' ' + minutesToClock(t.dueMinutes) : '') : '',
      done: t.done ? '已完成' : '未完成',
      course: courseName(t.courseId),
      note: t.note || '',
    };
    const row: ExportRow = {};
    for (const c of cols) row[c] = all[c] || '';
    return row;
  });
}

/** 出勤记录：一次打卡一行 */
export function attendanceRows(data: TimetableData, cols: ExportColumn[]): ExportRow[] {
  const STATUS: Record<string, string> = { present: '到课', late: '迟到', absent: '缺勤', leave: '请假' };
  const courseName = function (id: string): string {
    const c = data.courses.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : '';
  };
  const sessionCourse = function (sessionId: string): string {
    const s = data.sessions.filter(function (x) { return x.id === sessionId; })[0];
    return s ? courseName(s.courseId) : '';
  };
  return data.attendance.map(function (a) {
    const all: Record<string, string> = {
      date: a.date,
      course: sessionCourse(a.sessionId),
      status: STATUS[a.status] || String(a.status),
      note: a.note || '',
    };
    const row: ExportRow = {};
    for (const c of cols) row[c] = all[c] || '';
    return row;
  });
}

function minutesToClock(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
}

/* ------------------------------ 范围 → 行 ------------------------------ */

export type ExportScope = 'week' | 'term' | 'courses' | 'day' | 'tasks' | 'attendance';

/**
 * 每个范围认识哪些列。
 *
 * 用途有两个：插件清单在**安装时**就能查出"给任务导出选教室列"这种没意义的组合；
 * 界面上的说明也能直接列出每种范围支持哪些列。
 */
export const SCOPE_COLUMNS: Record<ExportScope, ExportColumn[]> = {
  week: ['date', 'weekday', 'week', 'period', 'start', 'end', 'course', 'teacher', 'location', 'building', 'note'],
  term: ['date', 'weekday', 'week', 'period', 'start', 'end', 'course', 'teacher', 'location', 'building', 'note'],
  day: ['date', 'weekday', 'week', 'period', 'start', 'end', 'course', 'teacher', 'location', 'building', 'note'],
  courses: ['course', 'teacher', 'location', 'period', 'note'],
  tasks: ['task', 'due', 'done', 'course', 'note'],
  attendance: ['date', 'course', 'status', 'note'],
};

/** 按范围取行。所有导出路径都走这里，插件与内置导出因此不会有两套行为 */
export function rowsForScope(data: TimetableData, scope: ExportScope, cols: ExportColumn[], week?: number): ExportRow[] {
  switch (scope) {
    case 'day': {
      const date = todayISO();
      const w = weekOfDate(data.term, date);
      return expandDay(data, date).map(function (e) { return eventToRow(e, w, cols); });
    }
    case 'week': return weekRows(data, week === undefined ? currentWeek(data) : week, cols);
    case 'term': return termRows(data, cols);
    case 'courses': return courseRows(data).map(function (r) { const o: ExportRow = {}; for (const c of cols) o[c] = r[c] || ''; return o; });
    case 'tasks': return taskRows(data, cols);
    case 'attendance': return attendanceRows(data, cols);
    default: return [];
  }
}

/* ------------------------------ 格式 ------------------------------ */

export type ExportFormat = 'csv' | 'markdown' | 'json' | 'text';

export const FORMAT_EXT: Record<ExportFormat, string> = {
  csv: '.csv', markdown: '.md', json: '.json', text: '.txt',
};

/** 范围的中文名（界面上显示用：插件面板与导出弹层都读它） */
export const SCOPE_LABEL: Record<ExportScope, string> = {
  week: '某一周', day: '今天', term: '整学期', courses: '课程清单', tasks: '任务清单', attendance: '出勤记录',
};

/** JSON：自描述（带列 id 与中文标签），既好解析也看得懂 */
export function toJson(rows: ExportRow[], cols: ExportColumn[], title?: string): string {
  return JSON.stringify({
    title: title || undefined,
    columns: cols.map(function (c) { return { id: c, label: COLUMN_LABEL[c] }; }),
    rows: rows,
  }, null, 2) + '\n';
}

/** 纯文本：一行一条、字段用「标签 值」列出 —— 适合直接粘进聊天或备忘录 */
export function toText(rows: ExportRow[], cols: ExportColumn[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(title, '');
  rows.forEach(function (r, i) {
    lines.push((i + 1) + '. ' + cols.map(function (c) { return COLUMN_LABEL[c] + ' ' + (r[c] || '—'); }).join(' · '));
  });
  if (rows.length === 0) lines.push('（没有内容）');
  return lines.join('\n') + '\n';
}

/** 一份渲染入口：格式再多，调用方也只有这一个分支点 */
export function renderExport(rows: ExportRow[], cols: ExportColumn[], format: ExportFormat, title?: string): string {
  if (format === 'csv') return toCsv(rows, cols);
  if (format === 'json') return toJson(rows, cols, title);
  if (format === 'text') return toText(rows, cols, title);
  return toMarkdown(rows, cols, title);
}

export type { ISODate };
export { shortDateLabel };
