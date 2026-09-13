import { describe, expect, it } from 'vitest';
import {
  FORMAT_EXT, SCOPE_COLUMNS, courseRows, csvCell, exportFileName, renderExport, rowsForScope, termRows, toCsv,
  toGroupedMarkdown, toJson, toMarkdown, toText, weekRows, type ExportColumn,
} from './exporters';
import { buildDemoData, buildEmptyData } from './demo';
import type { AttendanceRecord, Task, TimetableData } from './types';

describe('导出格式', function () {
  it('CSV 会把逗号、引号、换行包起来并翻倍引号（RFC4180）', function () {
    expect(csvCell('普通')).toBe('普通');
    expect(csvCell('含,逗号')).toBe('"含,逗号"');
    expect(csvCell('含"引号')).toBe('"含""引号"');
    expect(csvCell('含\n换行')).toBe('"含\n换行"');
  });

  it('CSV 带 UTF-8 BOM —— 不加 Excel 打开中文全乱码', function () {
    const csv = toCsv([{ a: '1' }], ['date']);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('CSV 用 CRLF 换行', function () {
    const csv = toCsv([{ date: '2026-09-10' }], ['date']);
    expect(csv.indexOf('\r\n')).toBeGreaterThan(0);
  });

  it('Markdown 会转义竖线，否则表格被撑破', function () {
    const md = toMarkdown([{ course: '高数 | 实验班' }], ['course']);
    expect(md).toContain('\\|');
  });

  it('Markdown 表头与分隔行都存在', function () {
    const md = toMarkdown([{ date: '2026-09-10', course: '高数' }], ['date', 'course']);
    const lines = md.trim().split('\n');
    expect(lines[0]).toContain('日期');
    expect(lines[0]).toContain('课程');
    expect(lines[1]).toContain('---');
    expect(lines[2]).toContain('高数');
  });

  it('当前周导出拿到的行数与课表一致', function () {
    const d = buildDemoData();
    const rows = weekRows(d, 1, ['date', 'course']);
    /* 第一周总该有课 —— 内置示例是每周都排的 */
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[0].course).toBeTruthy();
  });

  it('整学期导出会封顶，不设结束的学期不会导出无穷大', function () {
    const d = buildEmptyData();
    d.term.totalWeeks = undefined;
    const rows = termRows(d, ['week', 'course']);
    expect(rows.length).toBe(0);   /* 没课自然是 0 行，但关键是不能卡死 */
  });

  it('课程清单按课程去重，一门课一行', function () {
    const d = buildDemoData();
    const rows = courseRows(d);
    expect(rows.length).toBe(d.courses.length);
    expect(rows[0].course).toBe(d.courses[0].name);
  });

  it('分组 Markdown 里每门课都有小节标题', function () {
    const d = buildDemoData();
    const md = toGroupedMarkdown(d);
    expect(md).toContain('# ' + d.term.name);
    for (const c of d.courses) expect(md).toContain('## ' + c.name);
  });

  it('文件名会去掉非法字符', function () {
    expect(exportFileName('我的/课表:第一周', '.csv')).toBe('我的_课表_第一周.csv');
  });

  it('空课表也能导出，不抛异常', function () {
    const d = buildEmptyData();
    expect(function () { toCsv(weekRows(d, 1, ['date']), ['date']); }).not.toThrow();
    expect(function () { toGroupedMarkdown(d); }).not.toThrow();
  });
});

describe('范围 → 行（新增任务与考勤）', function () {
  function data(over: Record<string, unknown>): TimetableData {
    return Object.assign(buildEmptyData(), over) as unknown as TimetableData;
  }

  it('任务清单：一行一项，完成状态说人话，截止时间带上时刻', function () {
    const tasks: Task[] = [
      { id: 't1', title: '写实验报告', due: '2026-03-05', dueMinutes: 14 * 60, done: false },
      { id: 't2', title: '交作业', done: true },
    ];
    const rows = rowsForScope(data({ tasks: tasks }), 'tasks', ['task', 'due', 'done']);
    expect(rows.length).toBe(2);
    expect(rows[0].task).toBe('写实验报告');
    expect(rows[0].due).toBe('2026-03-05 14:00');
    expect(rows[0].done).toBe('未完成');
    expect(rows[1].done).toBe('已完成');
  });

  it('出勤记录：状态翻成中文', function () {
    const att: AttendanceRecord[] = [
      { id: 'a1', sessionId: 's1', date: '2026-03-02', status: 'late' },
      { id: 'a2', sessionId: 's1', date: '2026-03-09', status: 'present' },
    ];
    const rows = rowsForScope(data({ attendance: att }), 'attendance', ['date', 'status']);
    expect(rows[0].status).toBe('迟到');
    expect(rows[1].status).toBe('到课');
  });

  it('空的课表导出任务 / 考勤不会炸，只是 0 行', function () {
    expect(rowsForScope(data({}), 'tasks', SCOPE_COLUMNS.tasks).length).toBe(0);
    expect(rowsForScope(data({}), 'attendance', SCOPE_COLUMNS.attendance).length).toBe(0);
  });
});

describe('新增输出格式', function () {
  const rows = [{ course: '高等数学', teacher: '王老师' }, { course: '英语', teacher: '' }];
  const cols: ExportColumn[] = ['course', 'teacher'];

  it('JSON 自描述：带列 id 与中文标签，方便再加工', function () {
    const parsed = JSON.parse(toJson(rows, cols, '标题'));
    expect(parsed.title).toBe('标题');
    expect(parsed.columns).toEqual([{ id: 'course', label: '课程' }, { id: 'teacher', label: '教师' }]);
    expect(parsed.rows[0].course).toBe('高等数学');
  });

  it('纯文本：一行一条；空值写成破折号（否则看不出是缺了还是为空）', function () {
    const t = toText(rows, cols);
    expect(t).toContain('1. 课程 高等数学 · 教师 王老师');
    expect(t).toContain('2. 课程 英语 · 教师 —');
  });

  it('没有内容时明说「没有内容」，不返回空字符串', function () {
    expect(toText([], cols)).toContain('没有内容');
  });

  it('renderExport 按格式分发，扩展名对得上', function () {
    expect(renderExport(rows, cols, 'csv').indexOf('课程,教师')).toBeGreaterThan(-1);
    expect(renderExport(rows, cols, 'markdown')).toContain('| 课程 | 教师 |');
    expect(renderExport(rows, cols, 'json').indexOf('"columns"')).toBeGreaterThan(-1);
    expect(renderExport(rows, cols, 'text')).toContain('1. ');
    expect(FORMAT_EXT.json).toBe('.json');
    expect(FORMAT_EXT.text).toBe('.txt');
  });

  it('每个范围认识哪些列是显式声明的，界面与校验都读它', function () {
    expect(SCOPE_COLUMNS.tasks).toContain('task');
    expect(SCOPE_COLUMNS.tasks).not.toContain('location');
    expect(SCOPE_COLUMNS.attendance).toContain('status');
    expect(SCOPE_COLUMNS.week).toContain('location');
  });
});
