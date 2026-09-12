import { describe, expect, it } from 'vitest';
import {
  courseRows, csvCell, exportFileName, termRows, toCsv, toGroupedMarkdown, toMarkdown, weekRows,
} from './exporters';
import { buildDemoData, buildEmptyData } from './demo';

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
