/**
 * 提醒可靠性检查清单。
 *
 * 计划书 10.2 节定了 8 项必须在真机上跑一遍的测试 —— 这是整个项目里
 * 唯一不能靠单测覆盖、也不能靠模拟器糊弄的部分（国产 ROM 的省电策略
 * 千差万别）。以前它只存在于文档里，没人会对着文档逐条试。
 *
 * 现在把它搬进应用：每条写清"怎么做"，做完勾一下，进度存在本机。
 * 配合可延迟的测试通知，前几条几分钟就能跑完。
 */

export interface DeviceTest {
  id: string;
  title: string;
  /** 具体怎么做 —— 写成能照着做的动作，不是抽象描述 */
  how: string;
  /** 这一条能不能用「延迟测试通知」辅助完成 */
  needsDelay?: boolean;
}

export const DEVICE_TESTS: DeviceTest[] = [
  {
    id: 'screen-off',
    title: '息屏后仍然准点',
    how: '点下面的「10 秒后提醒我」，然后立刻按电源键锁屏。10 秒后通知栏应该准时出现。',
    needsDelay: true,
  },
  {
    id: 'force-stop',
    title: '强制停止后仍能触发',
    how: '同上先排一条延迟通知，然后去「系统设置 → 应用 → 课表助手」点「强行停止」。通知仍应准时到达。',
    needsDelay: true,
  },
  {
    id: 'reboot',
    title: '重启手机后提醒重建',
    how: '排一条 2 分钟后的通知，立刻重启手机。开机后无需打开应用，通知也应该响。',
    needsDelay: true,
  },
  {
    id: 'time-change',
    title: '改系统时间后重排',
    how: '把系统时间往前拨 1 小时，再打开应用。设置页的「接下来的提醒」时间应该跟着变化，而不是错的。',
  },
  {
    id: 'timezone',
    title: '切换时区后正确',
    how: '把系统时区改成另一个（比如东京），回到应用看提醒时间。课表应按本地时间显示，不应整体偏移。',
  },
  {
    id: 'battery',
    title: '省电模式 / 后台限制下仍准点',
    how: '打开系统省电模式，并确认已在「后台提醒可靠性」里放行电池优化与自启动。再排一条延迟通知验证。',
    needsDelay: true,
  },
  {
    id: 'burst',
    title: '同一分钟多条提醒都到达',
    how: '找一天有两门课同时开始（或用调课制造一次），确认那种情况下两条提醒都会出现，不会互相顶掉。',
  },
  {
    id: 'denied',
    title: '拒绝通知权限时的降级表现',
    how: '去系统设置关掉本应用的通知权限，回到设置页：应显示「还没有通知权限」并提供「申请」按钮，而不是卡住或崩溃。',
  },
];

/**
 * 网页版的三项检查。
 *
 * 网页版没有"息屏、强停、重启、省电模式"这些概念 —— 浏览器里根本不存在
 * 可以让网页在关闭之后自己醒来的机制。与其把 Android 那八项抄过来假装
 * 通用，不如把网页版真实的三条边界写清楚，其中一条本身就是"这个做不到"。
 */
export const WEB_TESTS: DeviceTest[] = [
  {
    id: 'web-permission',
    title: '通知权限已允许',
    how: '点下面的「10 秒后提醒我」，浏览器会弹出询问，选「允许」。回到设置页，「通知权限」一栏应该变成已允许。',
    needsDelay: true,
  },
  {
    id: 'web-page-open',
    title: '页面开着时准时送达',
    how: '排一条延迟通知，把标签页切到后台（不要关掉它）。10 秒后通知栏应该准时出现 —— 切到后台会被浏览器限速，所以宁可让它留在前台。',
    needsDelay: true,
  },
  {
    id: 'web-no-background',
    title: '关掉页面后不会再提醒（预期行为）',
    how: '关掉标签页或长时间锁屏，提醒不会响。这是浏览器的限制，不是故障 —— 需要关机也响，请装 Android 版。',
  },
];

/** 按运行环境挑检查项：Android 八项、网页版三项 */
export function testsFor(native: boolean): DeviceTest[] {
  return native ? DEVICE_TESTS : WEB_TESTS;
}

const KEY = 'timetable.devicecheck.v1';

export function loadDeviceChecks(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string'; }) : [];
  } catch (e) {
    return [];
  }
}

export function saveDeviceChecks(ids: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch (e) { /* 忽略 */ }
}
