/**
 * 把分钟数说成人话。
 *
 * 「4881 分钟后开始」这种输出对人没有任何意义 —— 没人能在脑子里把它换算成
 * 「三天后的周一早上」。凡是给用户看的时长都走这里。
 *
 * 分级规则：
 *   不到 1 分钟  → 不到 1 分钟
 *   不到 1 小时  → N 分钟
 *   不到 1 天    → N 小时 [M 分]
 *   1 天以上     → N 天 [M 小时]
 */
export function humanDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return '不到 1 分钟';
  if (m < 60) return m + ' 分钟';

  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm > 0 ? h + ' 小时 ' + mm + ' 分' : h + ' 小时';

  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh > 0 ? d + ' 天 ' + hh + ' 小时' : d + ' 天';
}
