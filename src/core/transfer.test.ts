import { describe, expect, it } from 'vitest';
import { parseTimetable, serializeTimetable } from './transfer';
import { buildDemoData, buildEmptyData } from './demo';

describe('课表导入导出', function () {
  it('导出再导入能还原', function () {
    const src = buildDemoData();
    const r = parseTimetable(serializeTimetable(src));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.courses.length).toBe(src.courses.length);
    expect(r.data.sessions.length).toBe(src.sessions.length);
    expect(r.data.overrides.length).toBe(src.overrides.length);
    expect(r.data.term.startDate).toBe(src.term.startDate);
    expect(r.warnings).toEqual([]);
  });

  it('空课表也能来回', function () {
    const r = parseTimetable(serializeTimetable(buildEmptyData()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.courses.length).toBe(0);
  });

  it('不是 JSON 就报错', function () {
    const r = parseTimetable('这不是 json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });

  it('缺关键字段会明确拒绝', function () {
    expect(parseTimetable('{}').ok).toBe(false);
    expect(parseTimetable('{"term":{"startDate":"2025-09-01"}}').ok).toBe(false);
    const noSessions = parseTimetable('{"term":{"startDate":"2025-09-01"},"courses":[],"schemes":[{"id":"a","name":"x","periods":[]}]}');
    expect(noSessions.ok).toBe(false);
  });

  it('旧版文件缺 reminderRules 时可导入并提示', function () {
    const src = buildDemoData() as unknown as Record<string, unknown>;
    delete src.reminderRules;
    const r = parseTimetable(JSON.stringify(src));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.reminderRules).toEqual([]);
      expect(r.warnings.some(function (w) { return w.indexOf('提醒规则') >= 0; })).toBe(true);
    }
  });

  it('作息方案引用不存在时回退并提示', function () {
    const src = JSON.parse(serializeTimetable(buildDemoData()));
    src.term.periodSchemeId = 'does-not-exist';
    const r = parseTimetable(JSON.stringify(src));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.term.periodSchemeId).toBe(r.data.schemes[0].id);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it('丢弃指向不存在课程的时段', function () {
    const src = JSON.parse(serializeTimetable(buildDemoData()));
    src.sessions.push({ id: 'ghost', courseId: 'nope', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: { type: 'all' } });
    const r = parseTimetable(JSON.stringify(src));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sessions.some(function (s) { return s.id === 'ghost'; })).toBe(false);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it('丢弃指向不存在时段的调课记录', function () {
    const src = JSON.parse(serializeTimetable(buildDemoData()));
    src.overrides.push({ id: 'ghost-o', sessionId: 'nope', date: '2025-09-01', action: 'cancel' });
    const r = parseTimetable(JSON.stringify(src));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.overrides.some(function (o) { return o.id === 'ghost-o'; })).toBe(false);
  });

  it('支持不设结束的学期', function () {
    const src = JSON.parse(serializeTimetable(buildDemoData()));
    delete src.term.totalWeeks;
    const r = parseTimetable(JSON.stringify(src));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.term.totalWeeks).toBeUndefined();
  });
});
