import { describe, expect, it } from 'vitest';
import { UPCOMING_MAX, buildWidgetPayload } from './widget';
import { buildDemoData } from '../core/demo';
import { dateOf, toISODate, weekOfDate } from '../core/engine';

/** 演示数据是「本周一往前 6 周」开始的，所以先算出一个确实有课的时刻 */
function aClassTime(): { now: Date; iso: string; week: number } {
  const d = buildDemoData();
  const week = 7;
  const dt = dateOf(d.term, week, 2);   /* 周二 */
  dt.setHours(0, 0, 0, 0);
  return { now: dt, iso: toISODate(dt), week: week };
}

/** 小组件侧的取法：接下来第一节 = 第一项 endMs > now（原生那边就是这么写的） */
function pickNext(p: { upcoming: { endMs: number; startMs: number }[] }, now: Date): { endMs: number; startMs: number } | null {
  return p.upcoming.filter(function (it) { return it.endMs > now.getTime(); })[0] || null;
}

describe('小组件数据', function () {
  it('学期名字与"今天是哪天"都带过去', function () {
    const d = buildDemoData();
    const now = new Date();
    const p = buildWidgetPayload(d, now);
    expect(p.term).toBe(d.term.name);
    expect(p.todayIso).toBe(toISODate(now));
  });

  it('upcoming 的第一节，startMs 落在它自己那一天', function () {
    const d = buildDemoData();
    const t = aClassTime();
    const p = buildWidgetPayload(d, t.now);
    const nx = p.upcoming.filter(function (it) { return it.endMs > t.now.getTime(); })[0];
    expect(nx).toBeTruthy();
    const n = new Date(nx.startMs);
    const at = new Date(nx.endMs);
    const hm = ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2);
    expect(hm).toBe(nx.start);
    expect(at.getTime()).toBeGreaterThan(n.getTime());
    expect(nx.date).toBe(toISODate(n));
  });

  it('★ 上完一节之后，"下一节"会自动变成再下一节（不必等应用推送）', function () {
    const d = buildDemoData();
    const t = aClassTime();
    t.now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, t.now);
    const first = p.upcoming.filter(function (it) { return it.endMs > t.now.getTime(); })[0];
    expect(first).toBeTruthy();
    /* 假装时间来到第一节结束之后 */
    const later = new Date(first.endMs + 60 * 1000);
    const second = p.upcoming.filter(function (it) { return it.endMs > later.getTime(); })[0];
    expect(second).toBeTruthy();
    expect(second.startMs).toBeGreaterThan(first.startMs);
  });

  it('今天列表里不含已经上完的课，但 upcoming 里还有之后的课', function () {
    const d = buildDemoData();
    const t = aClassTime();
    t.now.setHours(23, 0, 0, 0);
    const p = buildWidgetPayload(d, t.now);
    expect(p.today.length).toBe(0);
    expect(p.upcoming.length).toBeGreaterThan(0);
  });

  it('早上的时候今天列表里有一整天的课', function () {
    const d = buildDemoData();
    const t = aClassTime();
    t.now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, t.now);
    expect(p.today.length).toBeGreaterThan(0);
    for (const it of p.today) {
      expect(it.title).toBeTruthy();
      expect(it.dayLabel).toMatch(/^周[一二三四五六日]$/);
      expect(it.endMs).toBeGreaterThan(it.startMs);
      expect(it.date).toBe(p.todayIso);
    }
  });

  it('★ "今天"那一栏按传入的时刻算，而不是真实的今天', function () {
    const d = buildDemoData();
    const t = aClassTime();
    t.now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, t.now);
    expect(p.today.length).toBeGreaterThan(0);
    for (const it of p.today) expect(it.dayLabel).toBe('周二');
    const monday = new Date(t.now.getTime() - 24 * 3600 * 1000);
    const p2 = buildWidgetPayload(d, monday);
    for (const it of p2.today) expect(it.dayLabel).toBe('周一');
    expect(t.iso).toBe(toISODate(t.now));
  });

  it('upcoming 不超过上限，而且按时间递增', function () {
    const d = buildDemoData();
    const t = aClassTime();
    t.now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, t.now);
    expect(p.upcoming.length).toBeLessThanOrEqual(UPCOMING_MAX);
    for (let i = 1; i < p.upcoming.length; i++) {
      expect(p.upcoming[i].startMs).toBeGreaterThan(p.upcoming[i - 1].startMs);
    }
  });

  it('空课表也不会炸，upcoming 是空的', function () {
    const d = buildDemoData();
    d.sessions = [];
    d.courses = [];
    const p = buildWidgetPayload(d, new Date());
    expect(p.today.length).toBe(0);
    expect(p.upcoming.length).toBe(0);
    expect(pickNext(p, new Date())).toBeNull();
  });

  it('产出的 JSON 在小组件侧能原样解析（字段名对得上）', function () {
    const d = buildDemoData();
    const t = aClassTime();
    t.now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, t.now);
    const back = JSON.parse(JSON.stringify(p));
    expect(typeof back.term).toBe('string');
    expect(typeof back.todayIso).toBe('string');
    expect(Array.isArray(back.today)).toBe(true);
    expect(Array.isArray(back.upcoming)).toBe(true);
    expect(Object.keys(back.upcoming[0]).sort()).toEqual(
      ['courseId', 'date', 'dayLabel', 'end', 'endMs', 'location', 'period', 'start', 'startMs', 'title']
    );
  });

  it('startMs 是合理的 epoch 毫秒，不是被放大过的值', function () {
    const d = buildDemoData();
    const t = aClassTime();
    t.now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, t.now);
    const nowMs = Date.now();
    const yearMs = 400 * 86400000;
    for (const it of p.upcoming.concat(p.today)) {
      expect(it.startMs).toBeGreaterThan(nowMs - yearMs);
      expect(it.startMs).toBeLessThan(nowMs + yearMs);
    }
  });

  it('周次计算与引擎一致（防止小组件和主界面显示不同的周）', function () {
    const d = buildDemoData();
    const t = aClassTime();
    expect(weekOfDate(d.term, toISODate(t.now))).toBe(t.week);
  });
});
