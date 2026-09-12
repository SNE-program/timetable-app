import { describe, expect, it } from 'vitest';
import { exportIcs, importIcs } from './ics';
import { buildDemoData, buildEmptyData } from './demo';
import { expandWeek, toISODate, dateOf } from './engine';

describe('ICS 导出', function () {
  const data = buildDemoData();
  const ics = exportIcs(data);

  it('是合法的 VCALENDAR 外壳', function () {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:');
  });

  it('用 CRLF 换行（RFC5545 要求）', function () {
    const lfOnly = ics.split('\n').filter(function (l, i, arr) { return l !== '' && !l.endsWith('\r') && i < arr.length - 1; });
    expect(lfOnly.length).toBe(0);
  });

  it('每行不超过 75 个八位组', function () {
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('在没有 Buffer 的环境（真机 WebView）里也能导出', function () {
    /* Buffer 是 Node 专有全局；浏览器里 undefined，
       之前 fold() 直接 ReferenceError，而单测跑在 Node 里发现不了 */
    const saved = (globalThis as any).Buffer;
    try {
      (globalThis as any).Buffer = undefined;
      const out = exportIcs(data);
      expect(out).toContain('BEGIN:VCALENDAR');
      for (const line of out.split('\r\n')) {
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      }
    } finally {
      (globalThis as any).Buffer = saved;
    }
  });

  it('事件数与时段数一致，并且带 UID / DTSTAMP', function () {
    const begins = (ics.match(/BEGIN:VEVENT/g) || []).length;
    expect(begins).toBeGreaterThan(0);
    expect((ics.match(/UID:/g) || []).length).toBe(begins);
    expect((ics.match(/DTSTAMP:/g) || []).length).toBe(begins);
  });

  it('每周的课用 RRULE 压缩，而不是展开成几十条', function () {
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    const begins = (ics.match(/BEGIN:VEVENT/g) || []).length;
    /* 示例课表 14 个时段，不压缩会变成上百条 */
    expect(begins).toBeLessThan(40);
  });

  it('单双周用 INTERVAL=2 表达', function () {
    expect(ics).toContain('INTERVAL=2');
  });

  it('停课的日期写进 EXDATE', function () {
    expect(ics).toContain('EXDATE:');
  });

  it('写入 VALARM 提醒', function () {
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT15M');
  });

  it('空课表也能导出成合法文件', function () {
    const empty = exportIcs(buildEmptyData());
    expect(empty).toContain('BEGIN:VCALENDAR');
    expect(empty).not.toContain('BEGIN:VEVENT');
  });
});

describe('ICS 导入', function () {
  it('自己导出的能读回来', function () {
    const src = buildDemoData();
    const r = importIcs(exportIcs(src), buildEmptyData());
    expect(r.courses).toBeGreaterThan(0);
    expect(r.sessions).toBeGreaterThan(0);
    const names = r.data.courses.map(function (c) { return c.name; });
    expect(names).toContain('高等数学 A');
  });

  it('往返后课表内容一致（周次与节次对得上）', function () {
    const src = buildDemoData();
    const r = importIcs(exportIcs(src), buildEmptyData());
    const before = expandWeek(src, 6).length;
    const after = expandWeek(r.data, 6).length;
    expect(after).toBe(before);
  });

  it('能吃教务导出那种扁平事件（没有 RRULE）', function () {
    const flat = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//x//CN',
      'BEGIN:VEVENT', 'UID:1', 'DTSTAMP:20250901T000000Z',
      'DTSTART:20250901T080000', 'DTEND:20250901T094000',
      'SUMMARY:大学物理', 'LOCATION:理科楼 201', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:2', 'DTSTAMP:20250901T000000Z',
      'DTSTART:20250908T080000', 'DTEND:20250908T094000',
      'SUMMARY:大学物理', 'LOCATION:理科楼 201', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const r = importIcs(flat, buildEmptyData());
    expect(r.courses).toBe(1);
    expect(r.sessions).toBe(1);
    expect(r.data.courses[0].name).toBe('大学物理');
    expect(r.data.sessions[0].location).toBe('理科楼 201');
    expect(r.data.sessions[0].dayOfWeek).toBe(1);
    /* 连续两周会被压缩成 range */
    expect(r.data.sessions[0].weeks).toEqual({ type: 'range', from: 1, to: 2 });
  });

  it('单双周能被识别成 stepped', function () {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
    let n = 0;
    for (const d of ['20250901', '20250915', '20250929']) {
      n++;
      lines.push('BEGIN:VEVENT', 'UID:' + n, 'DTSTAMP:20250901T000000Z',
        'DTSTART:' + d + 'T100000', 'DTEND:' + d + 'T114000',
        'SUMMARY:数据结构', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const r = importIcs(lines.join('\r\n'), buildEmptyData());
    expect(r.data.sessions[0].weeks).toEqual({ type: 'stepped', from: 1, to: 5, step: 2 });
  });

  it('折行的长标题能还原', function () {
    const longName = '这是一门名字特别特别长的课程名称用来测试折行还原是否正常工作啊啊啊啊啊';
    const ic = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:1', 'DTSTAMP:20250901T000000Z',
      'DTSTART:20250901T080000', 'DTEND:20250901T084500',
      'SUMMARY:' + longName, 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const r = importIcs(ic, buildEmptyData());
    expect(r.data.courses[0].name).toBe(longName);
  });

  it('转义字符能还原', function () {
    const ic = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:1', 'DTSTAMP:20250901T000000Z',
      'DTSTART:20250901T080000', 'DTEND:20250901T084500',
      'SUMMARY:数学\\, 分析', 'LOCATION:A\\;301', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const r = importIcs(ic, buildEmptyData());
    expect(r.data.courses[0].name).toBe('数学, 分析');
    expect(r.data.sessions[0].location).toBe('A;301');
  });

  it('空文件不炸，只是没有内容', function () {
    const r = importIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', buildEmptyData());
    expect(r.courses).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('时间对不上作息时给出提示', function () {
    const ic = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:1', 'DTSTAMP:20250901T000000Z',
      'DTSTART:20250901T073000', 'DTEND:20250901T083000',
      'SUMMARY:奇怪的课', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const r = importIcs(ic, buildEmptyData());
    expect(r.warnings.some(function (w) { return w.indexOf('作息') >= 0; })).toBe(true);
  });
});
