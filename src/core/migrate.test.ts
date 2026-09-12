import { describe, expect, it } from 'vitest';
import { migrateData } from './migrate';
import { buildDemoData, buildEmptyData, PERIODS } from './demo';
import type { TimetableData } from './types';

function legacy(): TimetableData {
  /* 模拟用户手机上存着的旧数据：两套我们后来删掉的内置作息 */
  const d = buildDemoData();
  return Object.assign({}, d, {
    term: Object.assign({}, d.term, { periodSchemeId: 'scheme-summer' }),
    schemes: [
      { id: 'scheme-summer', name: '夏季作息', periods: [{ index: 1, start: '08:00', end: '08:45' }] },
      { id: 'scheme-winter', name: '冬季作息', periods: [{ index: 1, start: '08:30', end: '09:15' }] },
    ],
  });
}

describe('数据迁移', function () {
  it('把内置的旧作息换成真实的默认作息', function () {
    const r = migrateData(legacy());
    expect(r.data.schemes.some(function (s) { return s.id === 'scheme-summer'; })).toBe(false);
    expect(r.data.schemes.some(function (s) { return s.id === 'scheme-winter'; })).toBe(false);
    expect(r.data.schemes.some(function (s) { return s.id === 'scheme-default'; })).toBe(true);
    expect(r.data.term.periodSchemeId).toBe('scheme-default');
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('换上的就是 12 节真实时间', function () {
    const r = migrateData(legacy());
    const s = r.data.schemes.find(function (x) { return x.id === 'scheme-default'; })!;
    expect(s.periods.length).toBe(12);
    expect(s.periods[0].start).toBe('08:30');
    expect(s.periods[0].end).toBe('09:15');
    expect(s.periods[11].end).toBe('21:15');
  });

  it('用户自建的作息方案不会被删掉', function () {
    const d = legacy();
    d.schemes.push({ id: 'my-scheme', name: '实训周作息', periods: PERIODS });
    const r = migrateData(d);
    expect(r.data.schemes.some(function (s) { return s.id === 'my-scheme'; })).toBe(true);
    expect(r.data.schemes.some(function (s) { return s.id === 'scheme-default'; })).toBe(true);
  });

  it('课程数据完全不动', function () {
    const before = legacy();
    const after = migrateData(before).data;
    expect(after.courses.length).toBe(before.courses.length);
    expect(after.sessions.length).toBe(before.sessions.length);
    expect(after.overrides.length).toBe(before.overrides.length);
    expect(after.term.startDate).toBe(before.term.startDate);
  });

  it('学期引用了不存在的方案时改回第一套', function () {
    const d = buildEmptyData();
    d.term.periodSchemeId = 'ghost';
    const r = migrateData(d);
    expect(r.data.term.periodSchemeId).toBe(r.data.schemes[0].id);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('补齐缺失的字段', function () {
    const d = buildEmptyData() as unknown as Record<string, unknown>;
    delete d.tasks;
    delete d.attendance;
    delete d.reminderRules;
    const r = migrateData(d as unknown as TimetableData);
    expect(Array.isArray(r.data.tasks)).toBe(true);
    expect(Array.isArray(r.data.attendance)).toBe(true);
    expect(Array.isArray(r.data.reminderRules)).toBe(true);
  });

  it('已经是新数据时不产生任何变动和提示', function () {
    const r = migrateData(buildEmptyData());
    expect(r.notes).toEqual([]);
    expect(r.data.term.periodSchemeId).toBe('scheme-default');
  });

  it('迁移是幂等的', function () {
    const once = migrateData(legacy()).data;
    const twice = migrateData(once);
    expect(twice.notes).toEqual([]);
    expect(twice.data.schemes.length).toBe(once.schemes.length);
  });
});
