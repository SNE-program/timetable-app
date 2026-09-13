import { expandDay, toISODate } from '../core/engine';
import type { ConcreteEvent, TimetableData } from '../core/types';
import { isNativePlatform, nativeCall } from './nativeBridge';

/**
 * 桌面小组件的数据推送。
 *
 * 计划书 6.5 节的方案：**由 Web 层把要显示的内容算好写成 JSON 存进原生侧，
 * 小组件只读**。这样小组件里不跑时间引擎 —— 引擎一旦有两份实现，
 * 单双周、调课、作息切换这些边界情况迟早会对不上，
 * 而"小组件显示的是错的"是最难说清的一类 bug。
 *
 * ## v1.9.2 起：多带一份"接下来的几节课"
 *
 * 原来只推「今天剩下的课 + 下一节课」。于是**上完一节课之后，桌面上还显示着那一节**
 * —— 因为小组件只在应用推送时才刷新，而应用不会正好在下课那一刻被打开。
 * 现在附带 `upcoming`（从现在起最多 6 节，含之后的日子），每项都有绝对的
 * `startMs` / `endMs` 与 `date`：原生侧只做**一次线性比较**（第一项 endMs > now），
 * 不推算任何时间。配合那边"到点自刷新"的闹钟，桌面就能自己翻页。
 */
export interface WidgetItem {
  /** 点这一条时打开哪门课 —— 小组件只负责发一个 Intent，跳转由启动后的 Web 层完成 */
  courseId: string;
  title: string;
  start: string;
  end: string;
  location: string;
  period: string;
  dayLabel: string;
  /** 这一天（YYYY-MM-DD）—— 原生侧靠它判断"是不是今天"，不做任何日期推算 */
  date: string;
  startMs: number;
  endMs: number;
}

export interface WidgetPayload {
  term: string;
  /** 生成这份数据的那一天（YYYY-MM-DD） */
  todayIso: string;
  /** 今天还没结束的课（按开始时间排序） */
  today: WidgetItem[];
  /** 从现在起最多 UPCOMING_MAX 节（含之后的日子）—— 小组件按 endMs > now 取第一节 */
  upcoming: WidgetItem[];
}

/** 一次推过去的"接下来的课"上限：够覆盖没打开应用的一两天，又不至于把 JSON 撑大 */
export const UPCOMING_MAX = 6;
/** 往后翻多少天去找课（放假时也不会翻太远） */
const LOOKAHEAD_DAYS = 14;

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

/** 把一次具体上课转成小组件要的字段；时间字段直接给 epoch ms，原生侧不做换算 */
function toItem(e: ConcreteEvent, day: Date): WidgetItem {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  return {
    courseId: e.courseId,
    title: e.title,
    start: e.start,
    end: e.end,
    location: e.location || e.building || '',
    period: '第 ' + e.periodStart + (e.periodEnd !== e.periodStart ? '-' + e.periodEnd : '') + ' 节',
    dayLabel: '周' + WEEKDAY_CN[e.dayOfWeek - 1],
    date: e.date,
    startMs: d.getTime() + e.startMinutes * 60000,
    endMs: d.getTime() + e.endMinutes * 60000,
  };
}

/**
 * 纯函数：把课表算成小组件要显示的内容（单独抽出来是为了能测）。
 *
 * 注意这里用的是**传入的 now**，不是 `todayISO()`（真实的"今天"）。
 * 原来写的是后者，于是传入的时刻不是"此刻"时，"今天"那一栏会算成真实今天的课，
 * 而且这个函数变得不可确定地测试（测试只在"真实今天恰好有课"的工作日通过，一到周末就红）。
 */
export function buildWidgetPayload(data: TimetableData, now: Date): WidgetPayload {
  const nowMs = now.getTime();
  const todayIso = toISODate(now);

  /* 从今天起往后找：今天剩下的 + 之后几天的，凑够 UPCOMING_MAX 节 */
  const upcoming: WidgetItem[] = [];
  for (let i = 0; i < LOOKAHEAD_DAYS && upcoming.length < UPCOMING_MAX; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = toISODate(day);
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime();
    /* 今天之前的时段不必看；跨天的情况靠 endMs 判断 */
    const events = expandDay(data, iso)
      .filter(function (e) { return e.date === iso; })
      .map(function (e) { return toItem(e, day); })
      .filter(function (it) { return it.endMs > nowMs && it.startMs <= dayEnd; })
      .sort(function (a, b) { return a.startMs - b.startMs; });
    for (const it of events) {
      upcoming.push(it);
      if (upcoming.length >= UPCOMING_MAX) break;
    }
  }

  const today = upcoming.filter(function (it) { return it.date === todayIso; });

  return { term: data.term.name || '', todayIso: todayIso, today: today, upcoming: upcoming };
}

/**
 * 小组件点了某一门课 → 这里拿到课程 id（拿走后标记就清了）。
 *
 * 冷启动和从后台切回来都会调 —— 第二次点小组件走的是 onNewIntent/hot start，
 * 不重放一次就只会把应用拉到前台而不会跳详情。
 */
export async function consumePendingOpen(): Promise<string> {
  if (!isNativePlatform()) return '';
  try {
    const r = await nativeCall<{ courseId?: string }>('TimetableWidget', 'consumePendingOpen', {});
    return (r && r.courseId) ? r.courseId : '';
  } catch (e) {
    return '';
  }
}

/**
 * 下一次"该重画"的时刻（毫秒）—— 与原生侧 `WidgetRefresh.nextBoundary` 同一套规则。
 *
 * 放在 JS 这边是为了**能测、能自检**：`?widgetcheck=1` 会把它打出来，
 * 手机上桌面什么时候翻页，对着这一行就能核对。
 *
 * 规则：取最近的边界 —— 下一节的开始、正在上的那节的结束、今天零点；
 * 都没有就给 30 分钟后，并且整体不超过 6 小时（不能排到几周以后）。
 */
export function widgetBoundaryMs(p: WidgetPayload, now: number): number {
  let next = Number.MAX_SAFE_INTEGER;
  const nextClass = p.upcoming.filter(function (it) { return it.endMs > now; })[0];
  const rows = p.today.filter(function (it) { return it.endMs > now; });
  const pool = rows.concat(nextClass ? [nextClass] : []);
  for (const it of pool) {
    if (it.startMs > now) next = Math.min(next, it.startMs);
    if (it.endMs > now) next = Math.min(next, it.endMs);
  }
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
  next = Math.min(next, midnight);
  const cap = now + 6 * 3600 * 1000;
  if (!isFinite(next) || next === Number.MAX_SAFE_INTEGER || next <= now + 1000) next = now + 30 * 60 * 1000;
  return Math.min(next, cap);
}

/**
 * 推送一次。失败一律静默 —— 小组件只是锦上添花，
 * 绝不能因为它出问题而让排程主流程报错。
 *
 * **刻意不做「桌面上有没有小组件」的判断。** 第一版做了，还把结果缓存起来，
 * 结果是：用户在应用已经跑起来之后才往桌面加小组件，那份缓存永远是 false，
 * 数据永远推不过去，小组件就一直空着 —— 只有手动点「立即同步」才活过来。
 * 一次桥接调用的代价，远小于这种「加了没反应」的困惑。
 */
/** 设备端的小组件状态（桌面实例数、最后推送时间、存了什么、下次自刷新时刻） */
export interface WidgetDeviceState {
  instancesNext: number;
  instancesTimetable: number;
  updatedAt: number;
  scheduledAt: number;
  payloadBytes: number;
  term: string;
  todayIso: string;
  todayCount: number;
  upcomingCount: number;
  nextTitle: string;
  nextStartMs: number;
  sdk: number;
  error?: string;
}

/**
 * 问原生侧要一份"小组件现在到底怎么样了"。
 *
 * 存在的理由：小组件活在桌面进程里，"用不了"这件事在应用里看不出任何痕迹。
 * 有了它，用户点一下就能看到：桌面上有几个实例、最后一次推送到什么时候、
 * 数据里到底有几节课、下一次自己翻页是什么时候 —— 而这些正是排查要用的全部事实。
 */
export async function widgetDeviceState(): Promise<WidgetDeviceState | null> {
  if (!isNativePlatform()) return null;
  try {
    return await nativeCall<WidgetDeviceState>('TimetableWidget', 'debugState', {});
  } catch (e) {
    return null;
  }
}

export async function pushWidgetData(data: TimetableData): Promise<boolean> {
  try {
    const payload = buildWidgetPayload(data, new Date());
    await nativeCall('TimetableWidget', 'update', { payload: JSON.stringify(payload) });
    return true;
  } catch (e) {
    return false;
  }
}
