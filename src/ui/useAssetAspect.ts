import React from 'react';
import { MASCOT_STATES, type MascotAsset, type MascotPack } from '../mascot/types';

/**
 * 一个素材**单格**的宽高比。
 *
 * ## 为什么必须知道这个
 *
 * 逐帧图是"一张大图里排着 N 格"，要显示其中一格就得知道单格多大。
 * 光靠 CSS 算不出来：`background-size: cols×100% rows×100%` 是把**整张图**
 * 缩放到容器大小，于是单格会跟着容器的长宽比一起变形 ——
 * 表现就是角色被**拉伸**（容器是方的，角色就被压成方的）。
 *
 * 所以这里读一次图片的原始像素，按格数折出单格比例，让容器先长成单格的形状，
 * 再把背景铺上去。这样任何容器尺寸下都不会变形。
 *
 * 只读一次、按 src 缓存：同一张图在缩略图、预览、桌宠上会问很多次。
 */
const cache: Record<string, number> = {};

/**
 * 最近一次量到的比例。
 *
 * 用来兜住"换了一张还没量过的图"那一瞬间：那时候严格来说比例是未知的，
 * 但如果把容器藏起来（或者按一个猜的比例画），画面上就是**闪一下**。
 * 同一套角色的几个状态素材尺寸几乎总是一样的，拿上一次的比例顶着，
 * 用户看到的是一次无缝的状态切换。
 */
let lastAspect = 0;

/**
 * 提前把图片解码进内存。
 *
 * 角色在四个状态之间切换时 `background-image` 会换源，浏览器要重新解码一张
 * 几百 KB 到几 MB 的 data URI —— 手机上半秒都有可能，那半秒里角色是空白的。
 * 所以角色一装上就先把四个状态的图都解一遍。
 */
export function prewarmImage(src: string): void {
  if (!src) return;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  } catch (e) { /* 解不了就算了，真用的时候还会再试一次 */ }
}

export function prewarmMascotAssets(pack: MascotPack | null | undefined): void {
  if (!pack) return;
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (a && a.src) prewarmImage(a.src);
  }
}

export function useAssetAspect(asset?: MascotAsset): number {
  const src = asset && asset.src ? asset.src : '';
  const cols = asset && asset.cols ? asset.cols : 1;
  const rows = asset && asset.rows ? asset.rows : 1;
  const isSheet = !!asset && asset.kind === 'sheet';

  const key = isSheet ? src + '#' + cols + 'x' + rows : src;

  const [aspect, setAspect] = React.useState(function () {
    if (src && cache[key]) return cache[key];
    /* 没量过就先拿上一次的比例顶着，而不是 0（0 会让容器藏起来，看起来就是闪） */
    return src ? lastAspect : 0;
  });

  React.useEffect(function () {
    if (!src) { setAspect(0); return; }
    if (cache[key]) { setAspect(cache[key]); return; }
    let alive = true;
    const img = new Image();
    img.onload = function () {
      if (!img.naturalWidth || !img.naturalHeight) return;
      /* 逐帧图要的是"单格"的比例，不是整张图的比例 */
      const a = isSheet
        ? (img.naturalWidth / cols) / (img.naturalHeight / rows)
        : img.naturalWidth / img.naturalHeight;
      cache[key] = a;
      lastAspect = a;
      if (alive) setAspect(a);
    };
    img.src = src;
    return function () { alive = false; };
  }, [src, key, cols, rows, isSheet]);

  return aspect;
}

/** 单格宽高比已知时，一行样式就能做出"永远不变形"的容器 */
export function aspectBoxStyle(aspect: number): React.CSSProperties {
  if (!aspect || !isFinite(aspect) || aspect <= 0) return {};
  return { aspectRatio: String(aspect), height: '100%', width: 'auto', maxWidth: '100%' };
}
