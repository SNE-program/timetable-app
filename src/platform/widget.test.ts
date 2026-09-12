import { describe, expect, it } from 'vitest';
import { buildWidgetPayload } from './widget';
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

describe('小组件数据', function () {
  it('学期名字带过去', function () {
    const d = buildDemoData();
    const p = buildWidgetPayload(d, new Date());
    expect(p.term).toBe(d.term.name);
  });

  it('next 的 startMs 落在它自己那一天，而不是今天', function () {
    const d = buildDemoData();
    const { now } = aClassTime();
    const p = buildWidgetPayload(d, now);
    expect(p.next).not.toBeNull();
    if (!p.next) return;
    const n = new Date(p.next.startMs);
    const at = new Date(p.next.endMs);
    /* 时和分应当与 start / end 对得上 */
    const hm = ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2);
    expect(hm).toBe(p.next.start);
    expect(at.getTime()).toBeGreaterThan(n.getTime());
  });

  it('今天列表里不含已经上完的课', function () {
    const d = buildDemoData();
    const { now } = aClassTime();
    now.setHours(23, 0, 0, 0);   /* 晚上 11 点：今天的课全上完了 */
    const p = buildWidgetPayload(d, now);
    expect(p.today.length).toBe(0);
  });

  it('早上的时候今天列表里有一整天的课', function () {
    const d = buildDemoData();
    const { now } = aClassTime();
    now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, now);
    expect(p.today.length).toBeGreaterThan(0);
    for (const it of p.today) {
      expect(it.title).toBeTruthy();
      expect(it.dayLabel).toMatch(/^周[一二三四五六日]$/);
      expect(it.endMs).toBeGreaterThan(it.startMs);
    }
  });

  it('★ "今天"那一栏按传入的时刻算，而不是真实的今天', function () {
    /*
     * 这条是回归测试：原来这里用的是 todayISO()（真实的今天），
     * 于是传进去的时刻只影响 nowMin，日期却被忽略 ——
     * 测试里传周二、结果按真实的那一天算，工作日碰巧通过、一到周末就红。
     */
    const d = buildDemoData();
    const { now, iso } = aClassTime();
    now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, now);
    expect(p.today.length).toBeGreaterThan(0);
    for (const it of p.today) {
      /* 周二 */
      expect(it.dayLabel).toBe('周二');
    }
    /* 同一时刻往前推一天（周一）：内容应当完全不同，证明日期真的参与了计算 */
    const monday = new Date(now.getTime() - 24 * 3600 * 1000);
    const p2 = buildWidgetPayload(d, monday);
    for (const it of p2.today) expect(it.dayLabel).toBe('周一');
    expect(iso).toBe(toISODate(now));
  });

  it('空课表也不会炸，next 是 null', function () {
    const d = buildDemoData();
    d.sessions = [];
    d.courses = [];
    const p = buildWidgetPayload(d, new Date());
    expect(p.today.length).toBe(0);
    expect(p.next).toBeNull();
  });

  it('产出的 JSON 在小组件侧能原样解析（字段名对得上）', function () {
    const d = buildDemoData();
    const { now } = aClassTime();
    now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, now);
    const json = JSON.stringify(p);
    const back = JSON.parse(json);
    expect(typeof back.term).toBe('string');
    expect(Array.isArray(back.today)).toBe(true);
    expect(Object.keys(back.today[0]).sort()).toEqual(
      ['courseId', 'dayLabel', 'end', 'endMs', 'location', 'period', 'start', 'startMs', 'title']
    );
  });

  it('startMs 是合理的 epoch 毫秒，不是被放大过的值', function () {
    /*
     * 契约测试：原生侧拿 startMs 去算倒计时。之前踩过的坑是原生把 epoch 毫秒
     * 直接塞给 Chronometer（它要的是 elapsedRealtime 时基），倒计时于是显示成
     * 「496963:41:52」—— 1.789e12 毫秒正好等于当时的 epoch。
     * 这条保证 JS 侧给出的确实是一个正常的墙钟时刻，出问题时能一眼分清是哪边的错。
     */
    const d = buildDemoData();
    const { now } = aClassTime();
    now.setHours(0, 1, 0, 0);
    const p = buildWidgetPayload(d, now);
    expect(p.next).not.toBeNull();
    if (!p.next) return;
    const nowMs = Date.now();
    const yearMs = 400 * 86400000;
    expect(p.next.startMs).toBeGreaterThan(nowMs - yearMs);
    expect(p.next.startMs).toBeLessThan(nowMs + yearMs);
    for (const it of p.today) {
      expect(it.startMs).toBeGreaterThan(nowMs - yearMs);
      expect(it.startMs).toBeLessThan(nowMs + yearMs);
    }
  });

  it('周次计算与引擎一致（防止小组件和主界面显示不同的周）', function () {
    const d = buildDemoData();
    const { now, week } = aClassTime();
    expect(weekOfDate(d.term, toISODate(now))).toBe(week);
  });
});
