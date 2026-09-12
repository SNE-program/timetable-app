/**
 * 逐帧图：第几帧要显示哪一格，以及那一格要位移多少像素。
 *
 * ## 为什么单独抽出来
 *
 * 这里踩过一个**持续了好几版、用户报了两轮**的坑，必须留档：
 *
 * 原来是用 CSS 背景图做的精灵动画 —— `background-size: cols*100% rows*100%` 加上
 * `background-position: -col*100% -row*100%`。后者是**像素位移的写法**，
 * 但 `background-position` 的百分比语义是「相对（容器尺寸 − 背景图尺寸）」：
 *
 *     位移 = 百分比 × (容器宽 − 背景图宽) = (-1) × (W − N·W) = +(N-1)·W
 *
 * 也就是说 `-100%` 把整张图**推到容器右边外面**去了 —— 只有第 0 帧（0%）是对的，
 * 其余帧全是空白。实测（Chromium，4 格雪碧图 40px 容器）：负倍数那一排
 * 只有第一格是红的，后三格什么都没有；换成 `k/(N-1)` 的正百分比那一排，
 * 红绿蓝黄四格全对。
 *
 * 结果就是角色**每转一圈只出现 1 帧**：8×2 的网格里出现 1/16 的时间，
 * 9 帧的网格里出现 1/9 的时间 —— 用户的原话是「一闪一闪的，大部分时间不显示」。
 * 这个 bug 靠"看渲染代码"看不出来，靠"量元素几何"也量不出来（元素尺寸一直是对的），
 * 只有**读像素**才能发现，所以这一版起：逐帧图不再用百分比背景位移，
 * 改成"容器裁剪 + 子图平移"（纯像素，没有百分比语义可踩），并且位移计算抽成
 * 这个纯函数，直接单测钉死。
 */

export interface CellOffset {
  col: number;
  row: number;
}

/** 第 frame 帧落在网格的哪一格。越界与负数都会被收回网格内 */
export function cellOffset(frame: number, cols: number, rows: number): CellOffset {
  const c = Math.max(1, Math.round(cols || 1));
  const r = Math.max(1, Math.round(rows || 1));
  const f = Number(frame);
  const n = isFinite(f) ? Math.round(f) : 0;
  /* 先加一整圈再取模：这样负数（倒着播）也能正确落到最后一格 */
  const i = ((n % (c * r)) + c * r) % (c * r);
  return { col: i % c, row: Math.floor(i / c) };
}

/** 第 frame 帧时，整张雪碧图相对容器要平移多少像素（负值 = 往左上推） */
export function sheetTranslate(
  frame: number, cols: number, rows: number, cellW: number, cellH: number
): { x: number; y: number } {
  const o = cellOffset(frame, cols, rows);
  /* `|| 0` 是把 -0 归一成 0：-0 拼进 CSS 会变成 "-0px"，没必要给浏览器添乱 */
  return { x: -o.col * Math.max(0, cellW) || 0, y: -o.row * Math.max(0, cellH) || 0 };
}
