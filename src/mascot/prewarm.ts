import { MASCOT_STATES, type MascotPack } from './types';

/**
 * 图片预热（把素材先解码进内存）。
 *
 * ## 为什么需要
 *
 * 角色在几个状态之间切换时 `<img>` 会换源，浏览器要重新解码一张
 * 几百 KB 到几 MB 的 data URI —— 手机上半秒都有可能，那半秒里角色是空白的。
 * 装上角色之后先把它解一遍，切换时就不会闪。
 *
 * ## 为什么是"一张一张、让着主线程"地解
 *
 * 以前的写法是循环里当场 `new Image().src = ...` 四张一起丢出去，
 * 于是解码全挤在同一段时间里 —— 刚点完「使用」的那一下正好是用户盯着看的时候，
 * 界面反而更卡。现在每张之间让一次空闲（requestIdleCallback，退化成 setTimeout），
 * 解码摊开在几帧里，观感上就没有那一下顿挫了。
 *
 * 解不出来就算了：真用的时候浏览器还会再解一次，这里只是提前量。
 */

/** 让出主线程：优先空闲回调，退化成 setTimeout */
function schedule(fn: () => void): void {
  try {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') { ric(fn, { timeout: 800 }); return; }
  } catch (e) { /* 没有就退化 */ }
  setTimeout(fn, 60);
}

/** 提前把一张图解进内存 */
export function prewarmImage(src: string): void {
  if (!src) return;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  } catch (e) { /* 解不了就算了，真用的时候还会再试一次 */ }
}

/**
 * 把一个角色包的素材逐个预热。
 *
 * 顺序按 MASCOT_STATES 来（idle 在最前）—— 最可能马上用到的先解。
 */
export function prewarmMascotAssets(pack: MascotPack | null | undefined): void {
  if (!pack) return;
  const srcs: string[] = [];
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (a && a.src) srcs.push(a.src);
  }
  if (srcs.length === 0) return;

  let i = 0;
  const step = function (): void {
    if (i >= srcs.length) return;
    const src = srcs[i];
    i++;
    prewarmImage(src);
    if (i < srcs.length) schedule(step);
  };
  schedule(step);
}
