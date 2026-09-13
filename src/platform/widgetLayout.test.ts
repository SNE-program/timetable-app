import { describe, expect, it } from 'vitest';
import { WIDGET_PRESETS, cellsToDp, planForPreset, previewRows, widgetPlan } from './widgetLayout';
import type { WidgetItem, WidgetPayload } from './widget';

/**
 * 小组件的**排版判据**。
 *
 * 这套判据是 v1.9.6 修的"4×2 拉窄之后什么都不显示"的根：
 * 原来不管桌面给多大都按三行排，窄了课程名那一列被挤成 0 宽、矮了后几行被裁掉。
 * 原生侧（WidgetSize.java）有一份等价实现，这里测的是应用内预览用的那一份 ——
 * 两边必须给出同样的行数，否则预览就成了骗人的东西。
 */

function item(over: Partial<WidgetItem>): WidgetItem {
  return Object.assign({
    courseId: 'c1', title: '高等数学 A', start: '08:00', end: '09:40', location: '一教 A101',
    period: '第 1-2 节', dayLabel: '周一', date: '2026-03-02', startMs: 0, endMs: 0,
  }, over);
}

describe('尺寸 → 排版计划', function () {
  it('格数与 dp 的换算与系统一致', function () {
    expect(cellsToDp(2)).toBe(110);
    expect(cellsToDp(4)).toBe(250);
    expect(widgetPlan(cellsToDp(2), cellsToDp(2), 'next').cols).toBe(2);
    expect(widgetPlan(cellsToDp(4), cellsToDp(2), 'timetable').cols).toBe(4);
  });

  it('4×2 老实放得下两行，而不是排三行然后被裁掉', function () {
    expect(widgetPlan(250, 110, 'timetable').listRows).toBe(2);
  });

  it('拉高之后多列几行，最多三行', function () {
    expect(widgetPlan(250, 180, 'timetable').listRows).toBe(3);
    expect(widgetPlan(250, 320, 'timetable').listRows).toBe(3);
  });

  it('窄于 230dp 就收起地点那一列 —— 这是课程名被挤没的直接原因', function () {
    expect(widgetPlan(250, 110, 'timetable').narrow).toBe(false);
    expect(widgetPlan(180, 110, 'timetable').narrow).toBe(true);
    expect(widgetPlan(110, 110, 'timetable').narrow).toBe(true);
  });

  it('2×2 不额外列课；拉到 2×3 之后补两节', function () {
    expect(widgetPlan(110, 110, 'next').extraRows).toBe(0);
    expect(widgetPlan(110, 180, 'next').extraRows).toBe(2);
  });

  it('四个预设尺寸都给得出行数，且不会为负', function () {
    for (const p of WIDGET_PRESETS) {
      const plan = planForPreset(p);
      expect(plan.listRows).toBeGreaterThanOrEqual(0);
      expect(plan.extraRows).toBeGreaterThanOrEqual(0);
      expect(plan.cols).toBe(p.cols);
      expect(plan.rows).toBe(p.rows);
    }
  });
});

describe('预览要显示的内容', function () {
  const now = new Date(2026, 2, 2, 9, 0, 0).getTime();   /* 3 月 2 日周一 09:00 */
  const iso = '2026-03-02';

  function payload(over: Partial<WidgetPayload>): WidgetPayload {
    return Object.assign({ term: '2026 春', todayIso: iso, today: [], upcoming: [] }, over);
  }

  it('正在上的那一节也算「下一节」，不会跳过去', function () {
    const p = payload({ upcoming: [item({ startMs: now - 600000, endMs: now + 600000 })] });
    const r = previewRows(p, now, 2);
    expect(r.next).not.toBeNull();
    expect(r.next && r.next.title).toBe('高等数学 A');
  });

  it('数据是今天的：列表里跳过已经显示在顶部的那一节', function () {
    const a = item({ title: '高等数学 A', startMs: now + 600000, endMs: now + 1200000 });
    const b = item({ title: '程序设计基础', startMs: now + 3600000, endMs: now + 4200000 });
    const r = previewRows(payload({ today: [a, b], upcoming: [a, b] }), now, 3);
    expect(r.mode).toBe('today');
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].title).toBe('程序设计基础');
  });

  it('数据过期了（todayIso 不是今天）就改成列接下来的课', function () {
    const b = item({ title: '大学英语 III', startMs: now + 3600000, endMs: now + 4200000 });
    const c = item({ title: '体育（羽毛球）', startMs: now + 7200000, endMs: now + 7800000 });
    const r = previewRows(payload({ todayIso: '2026-02-27', upcoming: [b, c] }), now, 3);
    expect(r.mode).toBe('upcoming');
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].title).toBe('体育（羽毛球）');
  });

  it('只剩一节时列表是空的：那一节已经在上面单独显示了，不重复列一遍', function () {
    const b = item({ title: '大学英语 III', startMs: now + 3600000, endMs: now + 4200000 });
    const r = previewRows(payload({ todayIso: '2026-02-27', upcoming: [b] }), now, 3);
    expect(r.next && r.next.title).toBe('大学英语 III');
    expect(r.rows.length).toBe(0);
  });

  it('没有课时 next 为 null、列表为空（界面据此显示占位文字）', function () {
    const r = previewRows(payload({}), now, 3);
    expect(r.next).toBeNull();
    expect(r.rows.length).toBe(0);
  });
});