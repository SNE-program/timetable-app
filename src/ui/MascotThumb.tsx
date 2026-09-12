import React from 'react';
import type { MascotAsset } from '../mascot/types';
import { aspectBoxStyle, useAssetAspect } from './useAssetAspect';

/**
 * 素材缩略图。
 *
 * 三个细节，都是"看起来像不像正经工具"的分界线：
 *
 *   1. **棋盘格底**：角色素材多半带透明通道，放在纯色底上根本看不出哪里是镂空、
 *      哪里是白边。棋盘格是这一行的通用语言，用户一眼就懂。
 *   2. **逐帧图只显示第一格**：整张雪碧图缩到 48px 就是一团糊。
 *   3. **按单格宽高比定容器**：不这么做的话，逐帧图的单格会被拉伸成容器的形状
 *      —— 方形容器里角色就被压扁。比例从图片原始像素算，见 useAssetAspect。
 */
export default function MascotThumb(props: {
  asset?: MascotAsset;
  /** 缩略区高度，默认 48 */
  size?: number;
  /** 逐帧图上标一下格数，让人知道它是动图 */
  badge?: string;
}) {
  const { asset, size, badge } = props;
  const h = size || 48;
  const aspect = useAssetAspect(asset);

  if (!asset || !asset.src) {
    return <div className="mascot-thumb is-empty" style={{ height: h + 'px' }} aria-hidden="true" />;
  }

  const isSheet = asset.kind === 'sheet';
  /* 容器先长成单格的形状，再把背景整张铺上去 —— 这样一格正好填满且不变形 */
  const style: React.CSSProperties = Object.assign(
    aspectBoxStyle(aspect),
    isSheet
      ? {
        backgroundImage: 'url("' + asset.src + '")',
        backgroundSize: ((asset.cols || 1) * 100) + '% ' + ((asset.rows || 1) * 100) + '%',
        backgroundPosition: '0% 0%',
      }
      : {
        backgroundImage: 'url("' + asset.src + '")',
        backgroundSize: 'contain',
        backgroundPosition: 'center bottom',
      }
  );

  return (
    <div className="mascot-thumb" style={{ height: h + 'px' }} aria-hidden="true">
      {/*
        修饰类必须带命名空间前缀。
        这里原来写的是 `sheet`（sprite sheet 的意思），而这个应用里 `.sheet` 是
        **底部弹层的全局类**（position:fixed; left:0; right:0; bottom:0; max-height:88dvh）。
        撞名之后缩略图变成一个全屏固定盒子，逐帧图把整张雪碧图铺上去 ——
        用户看到的就是"角色被拉伸"。类名撞车不会有任何报错，只能靠量尺寸发现。
      */}
      <div className={'mascot-thumb-img' + (isSheet ? ' is-sheet' : '')} style={style} />
      {isSheet ? <span className="mascot-thumb-badge">{badge || ((asset.cols || 1) + '×' + (asset.rows || 1))}</span> : null}
      {asset.kind === 'animated' ? <span className="mascot-thumb-badge">动</span> : null}
    </div>
  );
}
