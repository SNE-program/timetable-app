import { describe, expect, it } from 'vitest';
import {
  RULE_PER_HOUR_MAX, applyRateLimit, describeRule, fillTemplate, planRuleNotifications,
  planRuleNotificationsLimited, type ActiveRule,
} from './rules';
import { buildDemoData } from '../core/demo';
import type { PlannedNotification } from '../core/reminders';
import type { RuleCapability } from './types';

const DATA = buildDemoData();

function rule(over: Partial<RuleCapability> & { when: RuleCapability['when'] }): ActiveRule {
  return {
    pluginId: 'p1',
    pluginName: '测试插件',
    capability: Object.assign({
      type: 'rule' as const, id: 'r1', name: '规则',
      then: { notify: { title: '标题', body: '正文' } },
    }, over) as RuleCapability,
  };
}

const WINDOW_FROM = new Date(2026, 8, 14, 0, 0, 0, 0).getTime();
const WINDOW_TO = WINDOW_FROM + 3 * 86400000;

describe('占位符', function () {
  it('白名单里的会被替换', function () {
    expect(fillTemplate('还有 {minutes} 分钟', { '{minutes}': '120' })).toBe('还有 120 分钟');
  });

  it('★ 没在白名单里的会被抹掉，而不是漏到通知栏里', function () {
    /* 安装时会拒，但规则可以从 localStorage 里被改，所以运行时再兜一次 */
    expect(fillTemplate('{task.title} {evil.thing}', { '{task.title}': '作业' })).toBe('作业 ');
  });

  it('同一个占位符出现多次都会被替换', function () {
    expect(fillTemplate('{a}{a}', { '{a}': 'x' })).toBe('xx');
  });
});

describe('规则的排程', function () {
  it('任务规则：只在到期前 N 分钟那一点响', function () {
    const tasks = DATA.tasks || [];
    if (tasks.length === 0 || !tasks[0].due) return;   /* 演示数据必定有任务，这里只是防御 */
    const out = planRuleNotifications([rule({ when: { event: 'task.dueSoon', minutes: 120 } })], DATA, WINDOW_FROM, WINDOW_FROM + 30 * 86400000);
    expect(out.length).toBeGreaterThan(0);
    /* 指纹稳定：同一份数据算两次必须一样，否则去重就失效了 */
    const again = planRuleNotifications([rule({ when: { event: 'task.dueSoon', minutes: 120 } })], DATA, WINDOW_FROM, WINDOW_FROM + 30 * 86400000);
    expect(again.map(function (n) { return n.fingerprint; })).toEqual(out.map(function (n) { return n.fingerprint; }));
    expect(out[0].fingerprint.indexOf('rule:p1:r1@task:')).toBe(0);
  });

  it('上课规则：每节课前 N 分钟各一条，且带上课程信息', function () {
    const out = planRuleNotifications([rule({
      when: { event: 'class.before', minutes: 30 },
      then: { notify: { title: '{course.name}', body: '{class.start}-{class.end} · {course.room}' } },
    })], DATA, WINDOW_FROM, WINDOW_TO);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].title.length).toBeGreaterThan(0);
    expect(out[0].body.indexOf(':')).toBeGreaterThan(0);
    /* 走的是插件渠道 */
    expect(out[0].kind).toBe('rule');
    expect(out[0].offsetMinutes).toBe(30);
  });

  it('每天固定时刻：一节课都没有的那天不发', function () {
    const r = rule({
      when: { event: 'daily.at', at: '07:30' },
      then: { notify: { title: '今天 {today.count} 节', body: '第一节 {today.first}' } },
    });
    const out = planRuleNotifications([r], DATA, WINDOW_FROM, WINDOW_TO);
    for (const n of out) {
      expect(n.title).not.toBe('今天 0 节');
    }
    /* 时间点必须落在窗口内的 07:30 */
    for (const n of out) {
      const d = new Date(n.at);
      expect(d.getHours()).toBe(7);
      expect(d.getMinutes()).toBe(30);
    }
  });

  it('时间窗之外的一条都不排', function () {
    const out = planRuleNotifications([rule({ when: { event: 'task.dueSoon', minutes: 120 } })], DATA, WINDOW_TO + 86400000, WINDOW_TO + 2 * 86400000);
    expect(out.length).toBe(0);
  });

  it('没有规则时是空数组（不是 undefined）', function () {
    expect(planRuleNotifications([], DATA, WINDOW_FROM, WINDOW_TO)).toEqual([]);
  });

  it('文案超长会被截断到上限（通知栏放不下更多）', function () {
    const out = planRuleNotifications([rule({
      when: { event: 'class.before', minutes: 15 },
      then: { notify: { title: '标题'.repeat(60), body: '正文'.repeat(200) } },
    })], DATA, WINDOW_FROM, WINDOW_TO);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].title.length).toBeLessThanOrEqual(40);
    expect(out[0].body.length).toBeLessThanOrEqual(120);
  });
});

describe('频率上限', function () {
  function mk(at: number, id: string): PlannedNotification {
    return {
      fingerprint: id, kind: 'rule', eventKey: id, title: 't', body: 'b',
      at: at, date: '2026-09-14', offsetMinutes: 0,
    };
  }

  it('同一个滑动小时里最多留下 N 条', function () {
    const items = [mk(1000, 'a'), mk(2000, 'b'), mk(3000, 'c'), mk(4000, 'd')];
    expect(applyRateLimit(items, 2).map(function (n) { return n.fingerprint; })).toEqual(['a', 'b']);
  });

  it('★ 按滑动小时算，不是按整点分桶（否则 59 分与 01 分能各发一批）', function () {
    const hour = 3600000;
    const items = [mk(hour - 60000, 'a'), mk(hour - 30000, 'b'), mk(hour + 60000, 'c')];
    /* 前两条落在同一小时里，第三条距离它们不足一小时 → 被挡 */
    expect(applyRateLimit(items, 2).map(function (n) { return n.fingerprint; })).toEqual(['a', 'b']);
    /* 再往后一小时就又放行了 */
    expect(applyRateLimit([mk(hour - 60000, 'a'), mk(hour - 30000, 'b'), mk(hour * 2 + 60000, 'c')], 2).length).toBe(3);
  });

  it('被丢掉的项不会进结果（下一个窗口自然会重排）', function () {
    const many: PlannedNotification[] = [];
    for (let i = 0; i < 20; i++) many.push(mk(1000 + i * 10, 'x' + i));
    expect(applyRateLimit(many, RULE_PER_HOUR_MAX).length).toBe(RULE_PER_HOUR_MAX);
  });
});

describe('合并入口', function () {
  it('排程 + 去重 + 限流一次做完，并且按时间排序', function () {
    const out = planRuleNotificationsLimited([
      rule({ when: { event: 'class.before', minutes: 10 } }),
      rule({ id: 'r2', when: { event: 'class.before', minutes: 10 } }),
    ], DATA, WINDOW_FROM, WINDOW_TO);
    for (let i = 1; i < out.length; i++) expect(out[i].at).toBeGreaterThanOrEqual(out[i - 1].at);
    /* 两条不同规则（指纹前缀不同）不该互相去重掉 */
    const ids: Record<string, boolean> = {};
    for (const n of out) ids[n.fingerprint.split('@')[0]] = true;
    if (out.length > 1) expect(Object.keys(ids).length).toBe(2);
  });

  it('同一条规则算出来的重复项只留一条', function () {
    const r = rule({ when: { event: 'class.before', minutes: 10 } });
    const out = planRuleNotificationsLimited([r, r], DATA, WINDOW_FROM, WINDOW_TO);
    const seen: Record<string, boolean> = {};
    for (const n of out) {
      expect(seen[n.fingerprint]).toBeUndefined();
      seen[n.fingerprint] = true;
    }
  });
});

describe('给界面用的一句话', function () {
  it('三种事件都能说成人话', function () {
    expect(describeRule({ type: 'rule', id: 'a', name: 'a', when: { event: 'task.dueSoon', minutes: 120 }, then: { notify: { title: 't', body: 'b' } } })).toContain('任务');
    expect(describeRule({ type: 'rule', id: 'a', name: 'a', when: { event: 'class.before', minutes: 30 }, then: { notify: { title: 't', body: 'b' } } })).toContain('课');
    expect(describeRule({ type: 'rule', id: 'a', name: 'a', when: { event: 'daily.at', at: '07:30' }, then: { notify: { title: 't', body: 'b' } } })).toContain('07:30');
  });
});
