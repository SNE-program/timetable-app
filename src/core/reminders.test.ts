import { describe, expect, it } from 'vitest';
import { toISODate, dateOf } from './engine';
import {
  DEFAULT_PREFS, formatClock, missedNotifications, offsetsFor, planNotifications, planRolling,
  type ReminderPrefs,
} from './reminders';
import type { PeriodScheme, ReminderRule, Session, Term, TimetableData } from './types';

const SCHEME: PeriodScheme = {
  id: 'sc', name: 'test',
  periods: [
    { index: 1, start: '08:00', end: '08:45' },
    { index: 2, start: '08:55', end: '09:40' },
    { index: 3, start: '10:00', end: '10:45' },
  ],
};

const TERM: Term = { id: 't1', name: 't', startDate: '2025-09-01', totalWeeks: 20, periodSchemeId: 'sc' };

function session(p: Partial<Session> & { id: string }): Session {
  return Object.assign({
    courseId: 'c1', dayOfWeek: 1 as const, periodStart: 1, periodEnd: 2,
    weeks: { type: 'all' } as Session['weeks'], location: 'A101', building: '一教',
  }, p);
}

function data(over: Partial<TimetableData>): TimetableData {
  return Object.assign({
    term: TERM, schemes: [SCHEME],
    courses: [{ id: 'c1', name: '高等数学', teacher: '王老师', colorIndex: 0 }],
    sessions: [session({ id: 's1' })],
    overrides: [], reminderRules: [] as ReminderRule[],
    tasks: [], attendance: [],
  }, over) as TimetableData;
}

const PREFS: ReminderPrefs = { reminderOffsets: [15, 5], dailyBrief: false, briefHour: 21 };
const DAY = new Date(2025, 8, 1, 0, 0).getTime();       /* 2025-09-01 00:00 */
const NEXT = new Date(2025, 8, 2, 0, 0).getTime();
const at = function (h: number, m: number, d?: number) { return new Date(2025, 8, d || 1, h, m, 0, 0).getTime(); };

/* --------------------------- 规则解析 --------------------------- */

describe('offsetsFor', function () {
  it('没有任何规则时用全局偏好', function () {
    expect(offsetsFor([], 's1', 'c1', PREFS)).toEqual([15, 5]);
  });
  it('课程规则覆盖全局偏好', function () {
    const rules: ReminderRule[] = [{ id: 'r1', scope: 'course', courseId: 'c1', offsetsMinutes: [30], enabled: true }];
    expect(offsetsFor(rules, 's1', 'c1', PREFS)).toEqual([30]);
    expect(offsetsFor(rules, 's2', 'c2', PREFS)).toEqual([15, 5]);
  });
  it('单次规则优先于课程规则', function () {
    const rules: ReminderRule[] = [
      { id: 'r1', scope: 'course', courseId: 'c1', offsetsMinutes: [30], enabled: true },
      { id: 'r2', scope: 'session', sessionId: 's1', offsetsMinutes: [60, 10], enabled: true },
    ];
    expect(offsetsFor(rules, 's1', 'c1', PREFS)).toEqual([60, 10]);
    expect(offsetsFor(rules, 's9', 'c1', PREFS)).toEqual([30]);
  });
  it('禁用规则表示不提醒，而不是回退到外层', function () {
    const rules: ReminderRule[] = [{ id: 'r1', scope: 'course', courseId: 'c1', offsetsMinutes: [15], enabled: false }];
    expect(offsetsFor(rules, 's1', 'c1', PREFS)).toEqual([]);
  });
  it('空提前量数组表示不提醒', function () {
    const rules: ReminderRule[] = [{ id: 'r1', scope: 'global', offsetsMinutes: [], enabled: true }];
    expect(offsetsFor(rules, 's1', 'c1', PREFS)).toEqual([]);
  });
});

/* --------------------------- 排程 --------------------------- */

describe('planNotifications', function () {
  it('每个提前量生成一条，时间正确', function () {
    const plan = planNotifications(data({}), PREFS, DAY, NEXT);
    expect(plan.length).toBe(2);
    expect(plan[0].at).toBe(at(7, 45));
    expect(plan[0].offsetMinutes).toBe(15);
    expect(plan[1].at).toBe(at(7, 55));
    expect(plan[1].offsetMinutes).toBe(5);
  });
  it('按时间升序', function () {
    const rules: ReminderRule[] = [{ id: 'r1', scope: 'global', offsetsMinutes: [5, 30, 10], enabled: true }];
    const plan = planNotifications(data({ reminderRules: rules }), PREFS, DAY, NEXT);
    expect(plan.map(function (n) { return n.offsetMinutes; })).toEqual([30, 10, 5]);
  });
  it('指纹唯一且可复现', function () {
    const a = planNotifications(data({}), PREFS, DAY, NEXT);
    const b = planNotifications(data({}), PREFS, DAY, NEXT);
    expect(a.map(function (n) { return n.fingerprint; })).toEqual(b.map(function (n) { return n.fingerprint; }));
    expect(new Set(a.map(function (n) { return n.fingerprint; })).size).toBe(a.length);
    expect(a[0].fingerprint).toBe('s1@2025-09-01#15');
  });
  it('文案包含时间、地点与教师', function () {
    const plan = planNotifications(data({}), PREFS, DAY, NEXT);
    expect(plan[0].title).toBe('高等数学');
    expect(plan[0].body).toContain('08:00-09:40');
    expect(plan[0].body).toContain('A101');
    expect(plan[0].body).toContain('王老师');
    expect(plan[0].body).toContain('15 分钟后上课');
  });
  it('窗口之外的通知不出现', function () {
    const plan = planNotifications(data({}), PREFS, at(8, 0), NEXT);
    expect(plan.length).toBe(0);
  });
  it('被停课的时段不产生提醒', function () {
    const dt = data({ overrides: [{ id: 'o1', sessionId: 's1', date: '2025-09-01', action: 'cancel' }] });
    expect(planNotifications(dt, PREFS, DAY, NEXT).length).toBe(0);
  });
  it('空课表不产生任何通知', function () {
    expect(planNotifications(data({ sessions: [] }), PREFS, DAY, NEXT)).toEqual([]);
  });
});

/* --------------------------- 每日摘要 --------------------------- */

describe('每日摘要', function () {
  const withBrief: ReminderPrefs = { reminderOffsets: [15], dailyBrief: true, briefHour: 21 };
  const EVE = new Date(2025, 7, 31, 20, 0).getTime();   /* 8-31 20:00 */
  const EVE_END = new Date(2025, 8, 1, 0, 0).getTime();

  it('前一天 21:00 发出，内容是明天的课', function () {
    const plan = planNotifications(data({}), withBrief, EVE, EVE_END);
    const briefs = plan.filter(function (n) { return n.kind === 'brief'; });
    expect(briefs.length).toBe(1);
    expect(briefs[0].at).toBe(new Date(2025, 7, 31, 21, 0).getTime());
    expect(briefs[0].title).toContain('明天 1 节课');
    expect(briefs[0].title).toContain('08:00');
    expect(briefs[0].body).toContain('高等数学');
    expect(briefs[0].body).toContain('A101');
  });
  it('第二天没课就不发摘要', function () {
    /* 只有周一有课，周二的摘要不该出现 */
    const plan = planNotifications(data({}), withBrief, new Date(2025, 8, 1, 20, 0).getTime(), NEXT);
    expect(plan.filter(function (n) { return n.kind === 'brief'; }).length).toBe(0);
  });
  it('关掉摘要后不再产生', function () {
    const plan = planNotifications(data({}), PREFS, EVE, EVE_END);
    expect(plan.filter(function (n) { return n.kind === 'brief'; }).length).toBe(0);
  });
  it('指纹按目标日期生成，不会重复', function () {
    const plan = planNotifications(data({}), withBrief, EVE, EVE_END);
    expect(plan.find(function (n) { return n.kind === 'brief'; })!.fingerprint).toBe('brief@2025-09-01');
  });
});

/* --------------------------- 错过补偿与窗口 --------------------------- */

describe('错过补偿', function () {
  it('回扫窗口内未发送的通知', function () {
    const plan = planNotifications(data({}), PREFS, DAY, NEXT);
    const now = new Date(2025, 8, 1, 7, 50);
    const missed = missedNotifications(plan, {}, now, 10);
    expect(missed.length).toBe(1);
    expect(missed[0].offsetMinutes).toBe(15);
  });
  it('已经发过的不再补', function () {
    const plan = planNotifications(data({}), PREFS, DAY, NEXT);
    const fired: Record<string, number> = {};
    fired[plan[0].fingerprint] = at(7, 45);
    const missed = missedNotifications(plan, fired, new Date(2025, 8, 1, 7, 50), 10);
    expect(missed.length).toBe(0);
  });
  it('超出回扫窗口的不补', function () {
    const plan = planNotifications(data({}), PREFS, DAY, NEXT);
    expect(missedNotifications(plan, {}, new Date(2025, 8, 1, 9, 0), 10).length).toBe(0);
  });
});

describe('滚动窗口', function () {
  it('只排未来一周内、且不排已经过去的', function () {
    const now = new Date(2025, 8, 1, 7, 50);   /* 第一节课前 10 分钟 */
    const plan = planRolling(data({}), PREFS, now);
    expect(plan.every(function (n) { return n.at >= now.getTime(); })).toBe(true);
    /* 今天那条 15 分钟提醒（07:45）已经过去了，只剩 5 分钟的 */
    const today = plan.filter(function (n) { return n.date === '2025-09-01'; });
    expect(today.length).toBe(1);
    expect(today[0].offsetMinutes).toBe(5);
    /* 窗口右端正好落在 09-08 07:50：07:45 那条在内，07:55 那条在外 */
    const nextWeek = plan.filter(function (n) { return n.date === '2025-09-08'; });
    expect(nextWeek.length).toBe(1);
    expect(nextWeek[0].offsetMinutes).toBe(15);
  });
});

describe('formatClock', function () {
  it('补零', function () {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(465)).toBe('07:45');
    expect(formatClock(1439)).toBe('23:59');
  });
});
