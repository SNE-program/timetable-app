import { DEFAULT_PREFS, planNotifications, missedNotifications, type PlannedNotification, type ReminderPrefs } from '../core/reminders';
import type { TimetableData } from '../core/types';
import { getNotifier } from '../platform';
import { activeRules } from '../plugins/host';
import { planRuleNotificationsLimited } from '../plugins/rules';
import { pushWidgetData } from '../platform/widget';
import { withTimeout } from '../platform/timeout';
import type { NotifierStatus, NotifyItem } from '../platform/types';
import type { TimetableData as _T } from '../core/types';

const KEY_LOG = 'timetable.notiflog.v1';
export const MISS_WINDOW_MINUTES = 15;
export const HORIZON_DAYS = 7;
const LOG_MAX_AGE_MS = 30 * 86400000;

/* ------------------------- 已发送日志（去重） ------------------------- */

export function loadFiredLog(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY_LOG);
    if (!raw) return {};
    const log = JSON.parse(raw) as Record<string, number>;
    const cutoff = Date.now() - LOG_MAX_AGE_MS;
    const out: Record<string, number> = {};
    for (const k in log) if (log[k] >= cutoff) out[k] = log[k];
    return out;
  } catch (e) {
    return {};
  }
}

function saveLog(log: Record<string, number>): void {
  try { localStorage.setItem(KEY_LOG, JSON.stringify(log)); } catch (e) { /* 忽略 */ }
}

export function markFired(fingerprint: string, at: number): void {
  const log = loadFiredLog();
  log[fingerprint] = at;
  saveLog(log);
}

export function clearFiredLog(): void {
  try { localStorage.removeItem(KEY_LOG); } catch (e) { /* 忽略 */ }
}

/* ------------------------- 触发回调 ------------------------- */

type FiredListener = (item: NotifyItem) => void;
const firedListeners: FiredListener[] = [];

export function onNotified(fn: FiredListener): () => void {
  firedListeners.push(fn);
  return function () {
    const i = firedListeners.indexOf(fn);
    if (i >= 0) firedListeners.splice(i, 1);
  };
}

function handleFired(item: NotifyItem): void {
  markFired(item.fingerprint, Date.now());
  for (const fn of firedListeners) {
    try { fn(item); } catch (e) { /* 单个监听器出错不影响其它 */ }
  }
}

/* ------------------------- 同步 ------------------------- */

export interface ReminderSyncResult {
  status: NotifierStatus;
  upcoming: NotifyItem[];
  firedNow: NotifyItem[];
}

/** 不同类型的提醒走不同渠道，用户可以在系统里分别静音 */
const CHANNEL_OF: Record<string, string> = {
  class: 'class-reminder',
  brief: 'daily-brief',
  task: 'ddl',
  /*
   * 插件规则单开一个渠道（v1.9.15）。
   *
   * 这一条是有意的：不想被插件打扰的人可以**只关这一个渠道**，
   * 上课提醒与作业提醒不受影响。让"关掉插件通知"和"关掉全部通知"分开，
   * 是插件功能能被长期接受的前提。
   */
  rule: 'plugin-rule',
};

function toItem(n: PlannedNotification): NotifyItem {
  return {
    fingerprint: n.fingerprint,
    title: n.title,
    body: n.body,
    at: n.at,
    channel: CHANNEL_OF[n.kind] || 'class-reminder',
  };
}

/**
 * 把当前课表同步给通知系统：
 *   1. 回扫刚过去的窗口，补发漏掉的提醒
 *   2. 用未来 7 天的完整计划替换系统里的排程
 *   3. 返回真实状态供界面展示
 */
/** 出错时也要返回一个可展示的状态，绝不能让界面卡在「正在检测」 */
function errorStatus(message: string): NotifierStatus {
  return {
    platform: 'unknown',
    displayName: '不可用',
    permission: 'unsupported',
    scheduled: 0,
    survivesAppClose: false,
    exactAlarm: 'unsupported',
    channels: [],
    lastError: message,
    note: '检测提醒通道时出错：' + message,
  };
}

export async function syncReminders(
  data: TimetableData, prefs: ReminderPrefs
): Promise<ReminderSyncResult> {
  let result: ReminderSyncResult;
  try {
    result = await withTimeout(syncRemindersInner(data, prefs), 30000, '提醒同步');
  } catch (e) {
    const msg = (e as Error) && (e as Error).message ? (e as Error).message : String(e);
    console.warn('提醒同步失败：', e);
    try {
      /* 兜底里的这次查询同样要有超时，否则兜底自己也会挂住 */
      const st = await withTimeout(getNotifier(handleFired).status(), 12000, '读取通知状态');
      result = { status: Object.assign({}, st, { lastError: msg }), upcoming: [], firedNow: [] };
    } catch (e2) {
      result = { status: errorStatus(msg), upcoming: [], firedNow: [] };
    }
  }
  /*
   * 桌面小组件的数据推送放在**最后且一定会走**的位置。
   *
   * 以前它在 syncRemindersInner 的末尾，而前面任何一步抛异常（例如读通知状态失败）
   * 都会跳到 catch —— 小组件于是永远停在"打开应用同步一次"。
   * 提醒通道出问题不该连累桌面显示。
   */
  await pushWidgetData(data).catch(function () { /* 忽略 */ });
  return result;
}

async function syncRemindersInner(
  data: TimetableData, prefs: ReminderPrefs
): Promise<ReminderSyncResult> {
  const notifier = getNotifier(handleFired);
  const now = Date.now();
  const from = now - MISS_WINDOW_MINUTES * 60000;
  const to = now + HORIZON_DAYS * 86400000;
  const all = planNotifications(data, prefs, from, to);
  /*
   * 插件规则**并进同一份排程**，而不是另走一条发送路径。
   *
   * 于是三件难做对的事全部复用：去重（fingerprint + 已发送日志）、
   * 错过补偿（启动时回扫 15 分钟）、滚动排程（只排未来 7 天，Android 对闹钟有数量限制）。
   * 另一条路径意味着另一套去重与补发逻辑，而那正是"偶尔收到两条一样的提醒"的来源。
   */
  for (const n of planRuleNotificationsLimited(activeRules(), data, from, to)) all.push(n);
  all.sort(function (a, b) { return a.at - b.at; });
  const log = loadFiredLog();
  const missed = missedNotifications(all, log, new Date(now), MISS_WINDOW_MINUTES);
  const upcoming = all.filter(function (n) { return n.at > now; });

  const firedNow: NotifyItem[] = [];
  for (const m of missed) {
    const item = toItem(m);
    let ok = false;
    try {
      ok = await notifier.fireNow({
      fingerprint: item.fingerprint,
      title: '（补）' + item.title,
      body: '这条提醒刚刚错过了 · ' + item.body,
        at: now,
        channel: item.channel,
      });
    } catch (e) {
      console.warn('补发提醒失败：', e);
    }
    markFired(m.fingerprint, now);
    if (ok) firedNow.push(item);
  }

  try {
    await notifier.replaceAll(upcoming.map(toItem));
  } catch (e) {
    console.warn('排程失败：', e);
  }
  const status = await notifier.status();

  return { status: status, upcoming: upcoming.map(toItem), firedNow: firedNow };
}

/** 渠道映射：事件类型 → Android 渠道 id */
const CHANGE_CHANNEL = 'schedule-change';

/**
 * 课表变动时补一条即时通知。
 *
 * 计划书 6.3 节把它列为独立渠道：调课、停课、换教室这些操作往往是
 * 在匆忙中做的，过一会儿就记不清改成了什么。留一条在通知栏里，
 * 滑下来就能确认，也能在系统设置里单独静音。
 *
 * 失败一律静默 —— 它只是锦上添花，绝不能因为通知发不出去而让操作失败。
 */
export function announceChange(title: string, body: string): void {
  try {
    const nt = getNotifier(handleFired);
    nt.announce(title, body, CHANGE_CHANNEL).catch(function () { /* 忽略 */ });
  } catch (e) { /* 忽略 */ }
}

export function defaultPrefs(): ReminderPrefs { return Object.assign({}, DEFAULT_PREFS); }
