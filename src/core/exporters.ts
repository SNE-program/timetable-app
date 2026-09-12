import type { ConcreteEvent, Course, ISODate, Session, TimetableData } from './types';
import { expandWeek, shortDateLabel, todayISO, weekOfDate } from './engine';

/**
 * 导出格式生成器。
 *
 * 这里是**纯函数**：给定课表数据和一些选项，产出一段文本。
 * 插件系统只负责"选哪些列、导出哪一段"，真正的生成逻辑全部落在这里 ——
 * 这样插件永远是声明式的（不需要执行第三方代码），而生成逻辑可以被单测锁死。
 */

export type ExportColumn =
  | 'date' | 'weekday' | 'week' | 'period' | 'start' | 'end'
  | 'course' | 'teacher' | 'location' | 'building' | 'note';

export const COLUMN_LABEL: Record<ExportColumn, string> = {
  date: '日期', weekday: '星期', week: '周次', period: '节次',
  start: '开始', end: '结束', course: '课程', teacher: '教师',
  location: '教室', building: '教学楼', note: '备注',
};

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

export interface ExportRow {
  [key: string]: string;
}

/** 把一次具体上课展开成一行 */
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

export type { ISODate };
export { shortDateLabel };
