import { Reliability, isReliabilitySupported } from '../platform/reliability';

/**
 * 系统时间 / 时区变化后的提醒重排。
 *
 * ## 问题
 *
 * 提醒是折算成**绝对时刻**（epoch 毫秒）交给系统闹钟的。用户把系统时间拨动一小时，
 * 或者换了个时区，那些绝对时刻对应的墙上时间就全变了 —— 闹钟照样准点响，
 * 但响在了错误的时间。
 *
 * ## 做法
 *
 * 原生侧（SystemChangeReceiver）收到 TIME_SET / TIMEZONE_CHANGED / MY_PACKAGE_REPLACED
 * 只写一个"待重排"标记；应用回到前台时这里读一次标记，触发一次完整重排。
 *
 * 为什么不干脆在原生侧重排：那等于把时间引擎实现两遍（一遍 TS、一遍 Java），
 * 两份逻辑必须永远一致，迟早分叉。宁可晚一步，也不要两份真相。
 *
 * 触发时机有两个：应用冷启动，以及 WebView 从后台回到前台（visibilitychange）。
 * 后者很重要 —— 用户去系统设置改了时间再切回来，走的就是这条路。
 */
export function watchSystemTimeChanges(onChanged: (reason: string) => void): () => void {
  let stopped = false;

  const check = async function (): Promise<void> {
    if (stopped || !isReliabilitySupported()) return;
    try {
      const r = await Reliability.pendingReschedule();
      if (!r || !r.pending || stopped) return;
      /* 先清标记再回调：回调里会重排，期间再收到广播也不要重复触发 */
      await Reliability.clearReschedule();
      onChanged(r.reason || '系统设置变化');
    } catch (e) {
      /* 插件不在（浏览器、旧版本原生工程）就当没有这回事 */
    }
  };

  void check();

  const onVisible = function (): void {
    if (document.visibilityState === 'visible') void check();
  };
  document.addEventListener('visibilitychange', onVisible);

  return function () {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
  };
}
