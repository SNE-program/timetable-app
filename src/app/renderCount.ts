/**
 * 渲染计数（只在 `?perf=` 检查里用得上）。
 *
 * 为什么要有它：**"卡"是主观的，渲染次数是客观的**。
 * 一次无关的状态变化导致整棵树重渲染，肉眼看不出，但这个计数器会立刻显示出来。
 * 正常运行时它就是一个对象自增，代价可以忽略；只有自检脚本会去读它。
 */
const counts: Record<string, number> = {};

export function countRender(name: string): void {
  counts[name] = (counts[name] || 0) + 1;
}

export function renderCounts(): Record<string, number> {
  return counts;
}

export function resetRenderCounts(): void {
  for (const k of Object.keys(counts)) delete counts[k];
}
