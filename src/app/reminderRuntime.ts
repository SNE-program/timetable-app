import { DEFAULT_PREFS, planNotifications, missedNotifications, type PlannedNotification, type ReminderPrefs } from '../core/reminders';
import type { TimetableData } from '../core/types';
import { getNotifier } from '../platform';
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
  try {
    return await withTimeout(syncRemindersInner(data, prefs), 30000, '提醒同步');
  } catch (e) {
    const msg = (e as Error) && (e as Error).message ? (e as Error).message : String(e);
    console.warn('提醒同步失败：', e);
    try {
      /* 兜底里的这次查询同样要有超时，否则兜底自己也会挂住 */
      const st = await withTimeout(getNotifier(handleFired).status(), 12000, '读取通知状态');
      return { status: Object.assign({}, st, { lastError: msg }), upcoming: [], firedNow: [] };
    } catch (e2) {
      return { status: errorStatus(msg), upcoming: [], firedNow: [] };
    }
  }
}

async function syncRemindersInner(
  data: TimetableData, prefs: ReminderPrefs
): Promise<ReminderSyncResult> {
  const notifier = getNotifier(handleFired);
  const now = Date.now();
  const all = planNotifications(
    data, prefs,
    now - MISS_WINDOW_MINUTES * 60000,
    now + HORIZON_DAYS * 86400000
  );
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

  /*
   * 顺手把桌面小组件的数据推过去。放在这里而不是单独开一个副作用，是因为
   * 小组件要显示的内容（下一节课、今天剩下的课）和排程用的是同一份展开结果 ——
   * 分两处算迟早会出现"提醒已经改了、小组件还显示旧的"。
   * 推送失败不影响排程，pushWidgetData 内部已经把异常吞掉了。
   */
  await pushWidgetData(data).catch(function () { /* 忽略 */ });

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
