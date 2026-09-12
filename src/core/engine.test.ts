import { describe, expect, it } from 'vitest';
import {
  MAX_ENUM_WEEKS, conflictsOf, dateOf, dayOfWeekOf, describeWeeks, expandDay, expandWeek,
  freeSlots, mondayOf, nextEvent, occurrencesOf, shortDateLabel, toISODate, weekConflicts,
  weekLimitOf, weekMatches, weekOfDate, weeksOf,
} from './engine';
import { MAX_WEEK } from './types';
import type { Override, PeriodScheme, Session, Term, TimetableData } from './types';

/* ----------------------------- 测试夹具 ----------------------------- */

const PERIODS = [
  { index: 1, start: '08:00', end: '08:45' },
  { index: 2, start: '08:55', end: '09:40' },
  { index: 3, start: '10:00', end: '10:45' },
  { index: 4, start: '10:55', end: '11:40' },
  { index: 5, start: '14:00', end: '14:45' },
  { index: 6, start: '14:55', end: '15:40' },
  { index: 7, start: '16:00', end: '16:45' },
  { index: 8, start: '16:55', end: '17:40' },
];

const SCHEME: PeriodScheme = { id: 'sc', name: 'test', periods: PERIODS };

function term(startDate: string, totalWeeks: number): Term {
  return { id: 't1', name: 'test term', startDate: startDate, totalWeeks: totalWeeks, periodSchemeId: 'sc' };
}

function session(partial: Partial<Session> & { id: string }): Session {
  return Object.assign({
    courseId: 'c1', dayOfWeek: 1 as const, periodStart: 1, periodEnd: 2,
    weeks: { type: 'all' } as Session['weeks'],
    location: 'A101', building: '一教',
  }, partial);
}

/** Object.assign 的结果类型推不出来（可选字段会变 undefined），断言一下 */
function data(over: Partial<TimetableData>): TimetableData {
  return Object.assign({
    term: term('2025-09-01', 20),
    schemes: [SCHEME],
    courses: [{ id: 'c1', name: '高等数学', teacher: '王老师', colorIndex: 0 }, { id: 'c2', name: '英语', colorIndex: 1 }],
    sessions: [] as Session[],
    overrides: [] as Override[],
    tasks: [], attendance: [], reminderRules: [],
  }, over) as TimetableData;
}

/* 2025-09-01 是周一 */
const T = '2025-09-01';
const d = function (week: number, dow: number) { return toISODate(dateOf(term(T, 20), week, dow as 1)); };

/* =========================== 周次解析 =========================== */

describe('weekLimitOf', function () {
  it('设了总周数就按总周数封顶', function () {
    expect(weekLimitOf({ id: 't', name: 't', startDate: '2025-09-01', totalWeeks: 20, periodSchemeId: 'sc' })).toBe(20);
  });

  it('不设结束视为无限，而不是 0 / NaN / undefined', function () {
    const limit = weekLimitOf({ id: 't', name: 't', startDate: '2025-09-01', periodSchemeId: 'sc' });
    expect(limit).toBe(Number.POSITIVE_INFINITY);
    /* 关键：任何周次都该落在范围内。以前 WeekView 直接拿 totalWeeks 比较，
       `n <= undefined` 恒为 false，导致不设结束时右滑翻周失效。 */
    expect(5200 <= limit).toBe(true);
    expect(Number.isNaN(limit)).toBe(false);
  });

  it('和 MAX_WEEK 取小之后仍是一个可用的上限', function () {
    const limit = Math.min(MAX_WEEK, weekLimitOf({ id: 't', name: 't', startDate: '2025-09-01', periodSchemeId: 'sc' }));
    expect(limit).toBe(MAX_WEEK);
    expect(1 <= limit).toBe(true);
    expect(MAX_WEEK + 1 <= limit).toBe(false);
  });
});

describe('weeksOf', function () {
  it('all 覆盖整个学期', function () {
    expect(weeksOf({ type: 'all' }, 20)).toEqual(Array.from({ length: 20 }, function (_, i) { return i + 1; }));
  });
  it('range 正确截取', function () {
    expect(weeksOf({ type: 'range', from: 3, to: 6 }, 20)).toEqual([3, 4, 5, 6]);
  });
  it('单周', function () {
    expect(weeksOf({ type: 'stepped', from: 1, to: 9, step: 2 }, 20)).toEqual([1, 3, 5, 7, 9]);
  });
  it('双周', function () {
    expect(weeksOf({ type: 'stepped', from: 2, to: 10, step: 2 }, 20)).toEqual([2, 4, 6, 8, 10]);
  });
  it('不规则周次（实训周）', function () {
    expect(weeksOf({ type: 'list', weeks: [1, 2, 3, 7, 8, 19] }, 20)).toEqual([1, 2, 3, 7, 8, 19]);
  });
  it('超出学期范围的值被裁掉', function () {
    expect(weeksOf({ type: 'range', from: -5, to: 99 }, 20).length).toBe(20);
    expect(weeksOf({ type: 'list', weeks: [0, 1, 21, 20] }, 20)).toEqual([1, 20]);
  });
});

/* =========================== 日期映射 =========================== */

describe('日期映射', function () {
  it('第 1 周周一就是开学日', function () {
    expect(d(1, 1)).toBe('2025-09-01');
  });
  it('第 1 周周日', function () {
    expect(d(1, 7)).toBe('2025-09-07');
  });
  it('第 2 周周一', function () {
    expect(d(2, 1)).toBe('2025-09-08');
  });
  it('跨月', function () {
    expect(d(5, 2)).toBe('2025-09-30');
    expect(d(5, 3)).toBe('2025-10-01');
  });
  it('跨年', function () {
    const t2 = term('2025-12-29', 20);
    expect(toISODate(dateOf(t2, 1, 1))).toBe('2025-12-29');
    expect(toISODate(dateOf(t2, 2, 1))).toBe('2026-01-05');
  });
  it('weekOfDate 与 dateOf 互为逆运算', function () {
    const t2 = term(T, 20);
    for (let w = 1; w <= 20; w++) {
      for (let dow = 1; dow <= 7; dow++) {
        expect(weekOfDate(t2, toISODate(dateOf(t2, w, dow as 1)))).toBe(w);
      }
    }
  });
  it('周日归到当周（周一为一周之始）', function () {
    const sunday = new Date(2025, 8, 7);
    expect(dayOfWeekOf(sunday)).toBe(7);
    expect(toISODate(mondayOf(sunday))).toBe('2025-09-01');
  });
});

/* =========================== 展开某一天 =========================== */

describe('expandDay', function () {
  it('基本的周一课', function () {
    const dt = data({ sessions: [session({ id: 's1' })] });
    const evs = expandDay(dt, '2025-09-01');
    expect(evs.length).toBe(1);
    expect(evs[0].title).toBe('高等数学');
    expect(evs[0].start).toBe('08:00');
    expect(evs[0].end).toBe('09:40');
    expect(evs[0].location).toBe('A101');
    expect(evs[0].periodStart).toBe(1);
    expect(evs[0].periodEnd).toBe(2);
    expect(evs[0].dayOfWeek).toBe(1);
  });
  it('不是这一天的课不出现', function () {
    const dt = data({ sessions: [session({ id: 's1', dayOfWeek: 1 })] });
    expect(expandDay(dt, '2025-09-02').length).toBe(0);
  });
  it('不在本周周次里的课不出现', function () {
    const dt = data({ sessions: [session({ id: 's1', weeks: { type: 'range', from: 5, to: 8 } })] });
    expect(expandDay(dt, '2025-09-01').length).toBe(0);
    expect(expandDay(dt, '2025-09-29').length).toBe(1);
  });
  it('单周课只在单周出现', function () {
    const dt = data({ sessions: [session({ id: 's1', weeks: { type: 'stepped', from: 1, to: 20, step: 2 } })] });
    expect(expandDay(dt, d(1, 1)).length).toBe(1);
    expect(expandDay(dt, d(2, 1)).length).toBe(0);
    expect(expandDay(dt, d(3, 1)).length).toBe(1);
  });
  it('双周课只在双周出现', function () {
    const dt = data({ sessions: [session({ id: 's1', weeks: { type: 'stepped', from: 2, to: 20, step: 2 } })] });
    expect(expandDay(dt, d(1, 1)).length).toBe(0);
    expect(expandDay(dt, d(2, 1)).length).toBe(1);
  });
  it('超出学期范围返回空', function () {
    const dt = data({ sessions: [session({ id: 's1' })] });
    expect(expandDay(dt, '2025-08-25').length).toBe(0);
    expect(expandDay(dt, '2026-01-26').length).toBe(0);
  });
  it('连堂课跨越多个节次', function () {
    const dt = data({ sessions: [session({ id: 's1', periodStart: 3, periodEnd: 4 })] });
    const evs = expandDay(dt, '2025-09-01');
    expect(evs[0].start).toBe('10:00');
    expect(evs[0].end).toBe('11:40');
  });
  it('同一天的课按开始时间排序', function () {
    const dt = data({
      sessions: [
        session({ id: 's1', periodStart: 5, periodEnd: 6 }),
        session({ id: 's2', periodStart: 1, periodEnd: 2 }),
        session({ id: 's3', periodStart: 3, periodEnd: 4 }),
      ],
    });
    expect(expandDay(dt, '2025-09-01').map(function (e) { return e.periodStart; })).toEqual([1, 3, 5]);
  });
});

/* =========================== 调课 / 停课 / 补课 =========================== */

describe('Override 处理', function () {
  it('停课：当天这节课消失', function () {
    const dt = data({
      sessions: [session({ id: 's1' })],
      overrides: [{ id: 'o1', sessionId: 's1', date: d(3, 1), action: 'cancel', reason: '放假' }],
    });
    expect(expandDay(dt, d(3, 1)).length).toBe(0);
    expect(expandDay(dt, d(4, 1)).length).toBe(1);
  });
  it('换教室：时间不变，地点变', function () {
    const dt = data({
      sessions: [session({ id: 's1' })],
      overrides: [{ id: 'o1', sessionId: 's1', date: d(3, 1), action: 'roomChange', patch: { location: 'B202' } }],
    });
    const evs = expandDay(dt, d(3, 1));
    expect(evs.length).toBe(1);
    expect(evs[0].location).toBe('B202');
    expect(evs[0].start).toBe('08:00');
    expect(evs[0].modifiedBy).toBe('o1');
  });
  it('原地改节次', function () {
    const dt = data({
      sessions: [session({ id: 's1' })],
      overrides: [{ id: 'o1', sessionId: 's1', date: d(3, 1), action: 'reschedule', patch: { periodStart: 5, periodEnd: 6 } }],
    });
    const evs = expandDay(dt, d(3, 1));
    expect(evs.length).toBe(1);
    expect(evs[0].periodStart).toBe(5);
    expect(evs[0].start).toBe('14:00');
  });
  it('补课到另一天：原日期不再出现，新日期出现', function () {
    const dt = data({
      sessions: [session({ id: 's1', dayOfWeek: 5 })],
      overrides: [{ id: 'o1', sessionId: 's1', date: d(3, 5), action: 'reschedule', patch: { newDate: d(3, 6), periodStart: 3, periodEnd: 4 } }],
    });
    expect(expandDay(dt, d(3, 5)).length).toBe(0);
    const moved = expandDay(dt, d(3, 6));
    expect(moved.length).toBe(1);
    expect(moved[0].periodStart).toBe(3);
    expect(moved[0].dayOfWeek).toBe(6);
  });
  it('改到本周另一天', function () {
    const dt = data({
      sessions: [session({ id: 's1', dayOfWeek: 1 })],
      overrides: [{ id: 'o1', sessionId: 's1', date: d(2, 1), action: 'reschedule', patch: { dayOfWeek: 4 } }],
    });
    expect(expandDay(dt, d(2, 1)).length).toBe(0);
    expect(expandDay(dt, d(2, 4)).length).toBe(1);
    expect(expandDay(dt, d(3, 1)).length).toBe(1);
  });
  it('原本就不存在的那一周，不产生补课', function () {
    const dt = data({
      sessions: [session({ id: 's1', dayOfWeek: 5, weeks: { type: 'range', from: 1, to: 2 } })],
      overrides: [{ id: 'o1', sessionId: 's1', date: d(9, 5), action: 'reschedule', patch: { newDate: d(9, 6) } }],
    });
    expect(expandDay(dt, d(9, 6)).length).toBe(0);
  });
  it('停课优先于换教室', function () {
    const dt = data({
      sessions: [session({ id: 's1' })],
      overrides: [
        { id: 'o1', sessionId: 's1', date: d(3, 1), action: 'roomChange', patch: { location: 'B202' } },
        { id: 'o2', sessionId: 's1', date: d(3, 1), action: 'cancel' },
      ],
    });
    expect(expandDay(dt, d(3, 1)).length).toBe(0);
  });
  it('不同日期的 Override 互不影响', function () {
    const dt = data({
      sessions: [session({ id: 's1' })],
      overrides: [{ id: 'o1', sessionId: 's1', date: d(3, 1), action: 'cancel' }],
    });
    expect(expandDay(dt, d(3, 1)).length).toBe(0);
    expect(expandDay(dt, d(5, 1)).length).toBe(1);
  });
});

/* =========================== 展开整周 =========================== */

describe('expandWeek', function () {
  it('合并一周七天', function () {
    const dt = data({
      sessions: [
        session({ id: 's1', dayOfWeek: 1 }),
        session({ id: 's2', dayOfWeek: 3 }),
        session({ id: 's3', dayOfWeek: 7 }),
      ],
    });
    const evs = expandWeek(dt, 1);
    expect(evs.length).toBe(3);
    expect(evs.map(function (e) { return e.dayOfWeek; })).toEqual([1, 3, 7]);
  });
  it('空课表返回空数组', function () {
    expect(expandWeek(data({}), 1)).toEqual([]);
  });
});

/* =========================== 下一节课 =========================== */

describe('nextEvent', function () {
  const dt = data({
    sessions: [
      session({ id: 's1', dayOfWeek: 1, periodStart: 1, periodEnd: 2 }),
      session({ id: 's2', dayOfWeek: 1, periodStart: 5, periodEnd: 6 }),
      session({ id: 's3', dayOfWeek: 2, periodStart: 1, periodEnd: 2 }),
    ],
  });
  it('早上 7 点指向当天第一节课', function () {
    const r = nextEvent(dt, new Date(2025, 8, 1, 7, 0));
    expect(r).not.toBeNull();
    expect(r!.event.periodStart).toBe(1);
    expect(r!.startsInMinutes).toBe(60);
    expect(r!.ongoing).toBe(false);
  });
  it('两节课之间指向下一节', function () {
    const r = nextEvent(dt, new Date(2025, 8, 1, 12, 0));
    expect(r!.event.periodStart).toBe(5);
    expect(r!.startsInMinutes).toBe(120);
  });
  it('正在上课时 ongoing 为真', function () {
    const r = nextEvent(dt, new Date(2025, 8, 1, 8, 30));
    expect(r!.ongoing).toBe(true);
    expect(r!.event.periodStart).toBe(1);
  });
  it('当天课都上完后指向第二天', function () {
    const r = nextEvent(dt, new Date(2025, 8, 1, 22, 0));
    expect(r!.event.dayOfWeek).toBe(2);
    expect(r!.startsInMinutes).toBeGreaterThan(0);
  });
  it('空课表返回 null', function () {
    expect(nextEvent(data({}), new Date(2025, 8, 1, 7, 0))).toBeNull();
  });
});

/* =========================== 冲突与空闲 =========================== */

describe('conflictsOf', function () {
  it('时间重叠被识别', function () {
    const dt = data({
      sessions: [
        session({ id: 's1', periodStart: 1, periodEnd: 3, location: 'A101', building: '一教' }),
        session({ id: 's2', periodStart: 2, periodEnd: 4, location: 'B201', building: '一教' }),
      ],
    });
    const cs = conflictsOf(dt, '2025-09-01');
    expect(cs.some(function (c) { return c.kind === 'timeOverlap'; })).toBe(true);
  });
  it('换楼时间过紧被识别', function () {
    /* 第 1 节 08:45 下课，第 2 节 08:55 上课，只有 10 分钟换楼 */
    const dt = data({
      sessions: [
        session({ id: 's1', periodStart: 1, periodEnd: 1, building: '一教' }),
        session({ id: 's2', periodStart: 2, periodEnd: 2, building: '实验楼' }),
      ],
    });
    expect(conflictsOf(dt, '2025-09-01').some(function (c) { return c.kind === 'locationJump'; })).toBe(true);
  });
  it('同楼不报换楼冲突', function () {
    const dt = data({
      sessions: [
        session({ id: 's1', periodStart: 1, periodEnd: 2, building: '一教' }),
        session({ id: 's2', periodStart: 3, periodEnd: 4, building: '一教' }),
      ],
    });
    expect(conflictsOf(dt, '2025-09-01').length).toBe(0);
  });
  it('不冲突的课表不误报', function () {
    const dt = data({ sessions: [session({ id: 's1' })] });
    expect(conflictsOf(dt, '2025-09-01')).toEqual([]);
  });
});

describe('freeSlots', function () {
  it('找出超过一小时的空档', function () {
    const dt = data({
      sessions: [
        session({ id: 's1', periodStart: 1, periodEnd: 2 }),
        session({ id: 's2', periodStart: 5, periodEnd: 6 }),
      ],
    });
    const slots = freeSlots(dt, '2025-09-01');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].start).toBe('09:40');
    expect(slots[0].end).toBe('14:00');
  });
  it('排满的课表没有空档', function () {
    const dt = data({ sessions: [session({ id: 's1', periodStart: 1, periodEnd: 8 })] });
    expect(freeSlots(dt, '2025-09-01')).toEqual([]);
  });
});
/* =========================== 无限时间轴 =========================== */

function openTerm(startDate: string): Term {
  return { id: 't-open', name: 'open', startDate: startDate, periodSchemeId: 'sc' };
}

function openData(over: Partial<TimetableData>): TimetableData {
  return data(Object.assign({ term: openTerm(T) }, over));
}

describe('无限时间轴', function () {
  it('weekMatches 是 O(1) 判断，不生成数组', function () {
    const limit = Number.POSITIVE_INFINITY;
    expect(weekMatches({ type: 'all' }, 1, limit)).toBe(true);
    expect(weekMatches({ type: 'all' }, 99999, limit)).toBe(true);
    expect(weekMatches({ type: 'range', from: 3, to: 6 }, 4, limit)).toBe(true);
    expect(weekMatches({ type: 'range', from: 3, to: 6 }, 7, limit)).toBe(false);
    expect(weekMatches({ type: 'stepped', from: 1, to: 20, step: 2 }, 7, limit)).toBe(true);
    expect(weekMatches({ type: 'stepped', from: 1, to: 20, step: 2 }, 8, limit)).toBe(false);
    expect(weekMatches({ type: 'list', weeks: [1, 5, 9] }, 5, limit)).toBe(true);
    expect(weekMatches({ type: 'list', weeks: [1, 5, 9] }, 6, limit)).toBe(false);
    expect(weekMatches({ type: 'all' }, 0, limit)).toBe(false);
  });

  it('学期不设结束时，第 500 周照样有课', function () {
    const dt = openData({ sessions: [session({ id: 's1' })] });
    expect(expandDay(dt, toISODate(dateOf(dt.term, 500, 1))).length).toBe(1);
    expect(expandDay(dt, toISODate(dateOf(dt.term, 5000, 1))).length).toBe(1);
  });

  it('学期有结束时，超出范围就没有课了（但轴本身还能翻）', function () {
    const dt = data({ sessions: [session({ id: 's1' })] });
    expect(expandDay(dt, d(20, 1)).length).toBe(1);
    expect(expandDay(dt, d(21, 1)).length).toBe(0);
    expect(expandDay(dt, d(500, 1)).length).toBe(0);
  });

  it('range 不写 to 就一直重复下去', function () {
    const dt = openData({ sessions: [session({ id: 's1', weeks: { type: 'range', from: 3 } })] });
    expect(expandDay(dt, toISODate(dateOf(dt.term, 2, 1))).length).toBe(0);
    expect(expandDay(dt, toISODate(dateOf(dt.term, 3, 1))).length).toBe(1);
    expect(expandDay(dt, toISODate(dateOf(dt.term, 800, 1))).length).toBe(1);
  });

  it('stepped 不写 to 就是永久的单周课', function () {
    const dt = openData({ sessions: [session({ id: 's1', weeks: { type: 'stepped', from: 1, step: 2 } })] });
    expect(expandDay(dt, toISODate(dateOf(dt.term, 401, 1))).length).toBe(1);
    expect(expandDay(dt, toISODate(dateOf(dt.term, 402, 1))).length).toBe(0);
  });

  it('有 to 的 range 在学期无上限时依然按 to 收敛', function () {
    const dt = openData({ sessions: [session({ id: 's1', weeks: { type: 'range', from: 1, to: 16 } })] });
    expect(expandDay(dt, toISODate(dateOf(dt.term, 16, 1))).length).toBe(1);
    expect(expandDay(dt, toISODate(dateOf(dt.term, 17, 1))).length).toBe(0);
  });

  it('list 永远是有限的', function () {
    const dt = openData({ sessions: [session({ id: 's1', weeks: { type: 'list', weeks: [1, 2, 700] } })] });
    expect(expandDay(dt, toISODate(dateOf(dt.term, 700, 1))).length).toBe(1);
    expect(expandDay(dt, toISODate(dateOf(dt.term, 701, 1))).length).toBe(0);
  });

  it('日期映射到第 1000 周仍然精确', function () {
    const t2 = openTerm('2025-09-01');
    const far = toISODate(dateOf(t2, 1000, 1));
    const expected = new Date(2025, 8, 1);
    expected.setDate(expected.getDate() + 999 * 7);
    expect(far).toBe(toISODate(expected));
    expect(weekOfDate(t2, far)).toBe(1000);
  });

  it('weeksOf 对无上限学期不会失控', function () {
    const list = weeksOf({ type: 'all' });
    expect(list.length).toBe(MAX_ENUM_WEEKS);
    expect(list[0]).toBe(1);
  });

  it('describeWeeks 能描述开放式', function () {
    expect(describeWeeks({ type: 'all' })).toContain('每周');
    expect(describeWeeks({ type: 'range', from: 3 })).toContain('不设结束');
    expect(describeWeeks({ type: 'range', from: 3, to: 8 })).toBe('3-8 周');
  });
});
describe('派生查询', function () {
  it('occurrencesOf 列出接下来的具体日期', function () {
    const dt = data({ sessions: [session({ id: 's1' })] });
    expect(occurrencesOf(dt, 's1', '2025-09-01', 3)).toEqual(['2025-09-01', '2025-09-08', '2025-09-15']);
  });

  it('occurrencesOf 尊重单双周', function () {
    const dt = data({ sessions: [session({ id: 's1', weeks: { type: 'stepped', from: 1, step: 2 } })] });
    expect(occurrencesOf(dt, 's1', '2025-09-01', 3)).toEqual(['2025-09-01', '2025-09-15', '2025-09-29']);
  });

  it('occurrencesOf 会跳过停课的那一次', function () {
    const dt = data({
      sessions: [session({ id: 's1' })],
      overrides: [{ id: 'o1', sessionId: 's1', date: '2025-09-08', action: 'cancel' }],
    });
    expect(occurrencesOf(dt, 's1', '2025-09-01', 3)).toEqual(['2025-09-01', '2025-09-15', '2025-09-22']);
  });

  it('occurrencesOf 对不存在的时段返回空', function () {
    expect(occurrencesOf(data({}), 'nope', '2025-09-01', 3)).toEqual([]);
  });

  it('weekConflicts 汇总整周', function () {
    const dt = data({
      sessions: [
        session({ id: 's1', periodStart: 1, periodEnd: 3, building: '一教' }),
        session({ id: 's2', periodStart: 2, periodEnd: 4, building: '一教' }),
      ],
    });
    expect(weekConflicts(dt, 1).length).toBeGreaterThan(0);
    expect(weekConflicts(dt, 1)[0].kind).toBe('timeOverlap');
  });

  it('weekConflicts 在没冲突时为空', function () {
    expect(weekConflicts(data({ sessions: [session({ id: 's1' })] }), 1)).toEqual([]);
  });

  it('shortDateLabel 好读', function () {
    expect(shortDateLabel('2025-09-01')).toBe('周一 9/1');
    expect(shortDateLabel('2025-09-07')).toBe('周日 9/7');
  });
});
