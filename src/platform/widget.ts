import { expandDay, nextEvent, todayISO, toISODate } from '../core/engine';
import type { ConcreteEvent, TimetableData } from '../core/types';
import { isNativePlatform, nativeCall } from './nativeBridge';

/**
 * 桌面小组件的数据推送。
 *
 * 计划书 6.5 节的方案：**由 Web 层把要显示的内容算好写成 JSON 存进原生侧，
 * 小组件只读**。这样小组件里不跑时间引擎 —— 引擎一旦有两份实现，
 * 单双周、调课、作息切换这些边界情况迟早会对不上，
 * 而"小组件显示的是错的"是最难说清的一类 bug。
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
  startMs: number;
  endMs: number;
}

export interface WidgetPayload {
  term: string;
  /** 今天还没结束的课 */
  today: WidgetItem[];
  /** 下一节课（可能不在今天） */
  next: WidgetItem | null;
}

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

/** 把一次具体上课转成小组件要的字段；时间字段直接给 epoch ms，原生侧不做换算 */
function toItem(e: ConcreteEvent, base: Date, startMs: number): WidgetItem {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  return {
    courseId: e.courseId,
    title: e.title,
    start: e.start,
    end: e.end,
    location: e.location || e.building || '',
    period: '第 ' + e.periodStart + (e.periodEnd !== e.periodStart ? '-' + e.periodEnd : '') + ' 节',
    dayLabel: '周' + WEEKDAY_CN[e.dayOfWeek - 1],
    startMs: d.getTime() + e.startMinutes * 60000,
    endMs: d.getTime() + e.endMinutes * 60000,
  };
}

/**
 * 纯函数：把课表算成小组件要显示的内容（单独抽出来是为了能测）。
 *
 * 注意这里用的是**传入的 now**，不是 `todayISO()`（真实的"今天"）。
 * 原来写的是后者，于是：
 *
 *   - 传入的时刻不是"此刻"时，"今天"那一栏会算成真实今天的课（调用方以为按传入时刻算）；
 *   - 这个函数变得**不可确定地测试** —— 测试里传周二，"今天"却是真实的今天，
 *     结果测试只在"真实今天恰好有课"的工作日通过，**一到周末就红**
 *     （它一直在断言的其实不是它以为的那件事）。
 */
export function buildWidgetPayload(data: TimetableData, now: Date): WidgetPayload {
  const today = toISODate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const todayItems = expandDay(data, today)
    .filter(function (e) { return e.date === today && e.endMinutes > nowMin; })
    .map(function (e) { return toItem(e, now, 0); });

  const nx = nextEvent(data, now);
  let next: WidgetItem | null = null;
  if (nx) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    next = toItem(nx.event, now, 0);
    /* nextEvent 可能落在别的日期上，要按那一天重新算 ms */
    if (nx.event.date !== toISODate(now)) {
      const p = nx.event.date.split('-').map(Number);
      d.setFullYear(p[0], p[1] - 1, p[2]);
      next.startMs = d.getTime() + nx.event.startMinutes * 60000;
      next.endMs = d.getTime() + nx.event.endMinutes * 60000;
    }
  }

  return { term: data.term.name || '', today: todayItems, next: next };
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

export async function pushWidgetData(data: TimetableData): Promise<boolean> {
  try {
    const payload = buildWidgetPayload(data, new Date());
    await nativeCall('TimetableWidget', 'update', { payload: JSON.stringify(payload) });
    return true;
  } catch (e) {
    return false;
  }
}
