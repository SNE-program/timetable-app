import React from 'react';
import {
  blinkDelayFor, motionVars, type MascotBehavior, type MascotPhase, type MascotReaction,
} from '../mascot/motion';
import { frameCount, type MascotAsset, type MascotMotion } from '../mascot/types';
import { cellOffset, sheetTranslate } from '../mascot/sheet';
import { useAssetAspect } from './useAssetAspect';

/**
 * 画一个角色。
 *
 * 抽出来是为了让**编辑器里的预览和课表上的真身用同一段代码** ——
 * 预览要是另写一套，两边的差异迟早会冒出来。
 *
 * 它只管"画"，不管位置、拖拽、状态机 —— 那些留在 Mascot.tsx 里。
 *
 * ## 逐帧图为什么是"裁剪容器 + 平移子图"，而不是背景图位移
 *
 * 这个坑值得单独写清楚（`mascot/sheet.ts` 里有完整推导）：
 * 用 `background-position: -col*100%` 配 `background-size: cols*100%` 是**错的** ——
 * 百分比的语义是"相对（容器宽 − 背景图宽）"，`-100%` 会把整张雪碧图推到容器右边外面，
 * 于是**只有第 0 帧能看见，其余帧全是空白**。角色因此每转一圈只闪一下。
 *
 * 现在改成：外层容器裁剪、内层整图按**像素**平移（`translate`）。
 * 纯像素没有百分比语义可踩，而且是合成层变换，不触发重绘 —— 手机上更稳。
 */

/** 一帧要补几帧：应用被切到后台再回来时不要一口气猛跳几十帧 */
const MAX_CATCHUP = 1;

/**
 * 开发检查用：`?frame=N` 固定显示第 N 帧，不要动画。
 *
 * 为什么需要它：`?framecheck=1` 量的是"露出来的是不是该露的那一格"，
 * 但**"那一格本身有没有画出东西"是另一回事** —— 上一版就是位移算错，
 * 每一帧露出来的位置都没错，露出来的却都是空白。
 * 有了这个参数就能逐帧截图、逐帧数像素，把"每一帧都真的画了角色"钉死。
 */
export function devFixedFrame(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get('frame');
    if (v === null || v === '') return null;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? Math.round(n) : null;
  } catch (e) {
    return null;
  }
}

export default function MascotArt(props: {
  asset: MascotAsset;
  motion: MascotMotion;
  phase: MascotPhase;
  /** 显示高度（px）。宽度按图片自身比例或逐帧图格数算 */
  size: number;
  shadow: boolean;
  /** 系统"减弱动态效果"或页面不可见时为 true：不眨眼、不做自走动画 */
  paused?: boolean;
  /**
   * 用户在外观页设的**播放帧率**（0/缺省 = 跟随素材自己的 fps）。
   *
   * 说明白一点：调高它只会播得更快，**不会更顺** —— 画面里的帧就那么多，
   * 素材是按 18fps 抽的就只有 18fps 的信息量。想真正更顺，得重新导入那段视频
   * （现在的默认抽帧率已经从 12fps 提到 18fps）。面板上写着这句话。
   */
  fpsOverride?: number;
  /** 当前微动作（呼吸 / 抖一下 / 伸展 / 抬头 / 打哈欠），由状态机掷出来 */
  behavior?: MascotBehavior;
  /** 这次微动作的抖动系数：同样动作每次快慢幅度略有不同 */
  jitter?: { speed: number; amp: number };
  /** 正在播的一次性反应；没有就是 null */
  reaction?: MascotReaction | null;
  /**
   * 这个反应是不是**已经由角色包自带的 react 素材**在演了。
   *
   * 是的话就不再叠 rx-* 那套 transform —— 作者自己画的动作比我们转一下好看得多，
   * 两套叠在一起还会互相打架（这一条就是"少一些自己的简易动画"的落点）。
   */
  reactionIsAsset?: boolean;
  /** 反应序号：每被点一次 +1，用来可靠地重启动画（同类反应连着两次也要重新播） */
  reactionSeq?: number;
  /** 正在走动（横移到别处） */
  walking?: boolean;
  /**
   * 要不要用程序化的"迈步"动作。
   *
   * 角色包里有 walk 素材时**不要**开（它自己会走，再叠一层会打架）；
   * 只有一张图的角色就靠这个把"走动"和"站着发呆"区分开。
   */
  gait?: boolean;
}) {
  const { asset, motion, phase, size, shadow, paused, fpsOverride } = props;
  const walking = !!props.walking;
  const gait = !!props.gait;
  const behavior: MascotBehavior = props.behavior || 'breathe';
  const jitter = props.jitter || { speed: 1, amp: 1 };
  const [blink, setBlink] = React.useState(false);
  /*
   * 单格的宽高比。
   *
   * 逐帧图是"一张大图里排着 N 格"，只靠 CSS 算不出单格多大。
   * 读一次原始像素、按格数折出比例，让容器先长成单格的形状。
   * 比例逻辑与缩略图共用（useAssetAspect）。
   */
  const sheetAspect = useAssetAspect(asset);

  /*
   * ★ 播放的帧数必须用**真实帧数**，不能用网格格数。
   *
   * 网格最后一排常常排不满（9 帧放进 8×2 就有 7 格是空的），那些格子是全透明的。
   * frameCount() 里写着这条规则。
   */
  const frames = asset.kind === 'sheet' ? frameCount(asset) : 0;
  const cols = Math.max(1, Math.round(asset.cols || 1));
  const rows = Math.max(1, Math.round(asset.rows || 1));
  const [frame, setFrame] = React.useState(0);
  /* ?frame=N 时冻结在第 N 帧（检查用；正常运行时是 null） */
  const fixed = React.useMemo(function () { return devFixedFrame(); }, []);
  const shown = fixed === null ? frame : fixed;

  /*
   * 帧推进用 rAF + 时间累加，而不是 setInterval。
   *
   * setInterval 是按"排队的次数"走的：主线程一忙（这一页上有课表、有提醒、
   * 有资产解码），回调就会积压，恢复时连着触发好几次 —— 表现是"卡一下然后猛跳几帧"，
   * 用户看到的就是抽帧、闪烁、"帧率不对"。rAF 每帧按**真实经过的时间**算该显示第几帧，
   * 忙的时候自动少跳、闲的时候自动跟上，永远不会积压。
   */
  React.useEffect(function () {
    if (fixed !== null || paused || phase === 'drag' || frames < 2) { setFrame(0); return; }
    const own = asset.fps ? asset.fps : 8;
    const fps = fpsOverride && fpsOverride >= 2 ? fpsOverride : own;
    const step = 1000 / Math.max(1, fps);
    let raf = 0;
    let last = 0;
    let acc = 0;
    let cur = 0;
    const loop = function (t: number): void {
      if (last === 0) last = t;
      acc += t - last;
      last = t;
      if (acc >= step) {
        const advance = Math.min(MAX_CATCHUP, Math.floor(acc / step));
        acc -= Math.floor(acc / step) * step;
        cur = (cur + advance) % frames;
        setFrame(cur);
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return function () { window.cancelAnimationFrame(raf); };
  }, [fixed, paused, phase, frames, asset.fps, fpsOverride]);

  /*
   * 眨眼。
   *
   * 间隔由**真随机数**决定（blinkDelayFor(Math.random())）——
   * 上一版是 blinkDelay(seed) 配一个每次 +1.37 的计数器，算式写得像随机，
   * 实际上是确定性的：每个用户、每次启动的眨眼节奏完全一样。
   * 每次眨完重新掷一次，所以节奏永远不会重复。
   */
  React.useEffect(function () {
    if (paused || phase === 'drag') return;
    let inner: number | null = null;
    const id = window.setTimeout(function () {
      setBlink(true);
      inner = window.setTimeout(function () { setBlink(false); }, 130);
    }, blinkDelayFor(Math.random()));
    return function () {
      window.clearTimeout(id);
      if (inner !== null) window.clearTimeout(inner);
      setBlink(false);
    };
  }, [paused, phase, blink]);

  /*
   * 一次性反应（被点一下）：hop / sway / startle / peek。
   *
   * 用命令式地"摘掉再加回"类名来重启动画 —— 这是唯一可靠的做法：
   * 连着两次点到同一种反应时，React 认为 className 没变，CSS 动画不会重播。
   * 任何素材形态（静态图 / 动图 / 逐帧图）都能看到这个反应，因为它只动 transform。
   */
  const innerRef = React.useRef<HTMLDivElement>(null);
  const reaction = props.reaction || null;
  const reactionSeq = props.reactionSeq || 0;
  /** 素材自己在演反应时，程序化那一层完全让位 */
  const reactionIsAsset = !!props.reactionIsAsset;
  React.useEffect(function () {
    const el = innerRef.current;
    if (!el || !reaction || reactionIsAsset || paused) return;
    const cls = 'rx-' + reaction;
    el.classList.remove('rx-hop', 'rx-sway', 'rx-startle', 'rx-peek');
    /* 强制一次重排，让动画从头开始 */
    void el.offsetWidth;
    el.classList.add(cls);
    return function () { el.classList.remove(cls); };
  }, [reaction, reactionSeq, reactionIsAsset, paused]);

  const vars = motionVars(motion, phase, behavior, jitter, !!paused) as React.CSSProperties;
  /* 单格渲染宽度：比例还不知道时先用 3/4 顶着，量到之后立刻换成真值 */
  const cellW = size * (sheetAspect > 0 ? sheetAspect : 0.75);
  const isSheet = asset.kind === 'sheet';

  return (
    <div className="mascot-art" style={Object.assign({ height: size + 'px' }, vars)}>
      <div
        ref={innerRef}
        className={'mascot-inner' + (phase === 'sleep' ? ' sleeping' : '') + (gait ? ' gait' : '')}
        style={vars}
        /* 自检要拿它对账：现在在做什么微动作、播的什么反应、走没走 */
        data-behavior={behavior}
        data-reaction={reaction || ''}
        data-walking={walking ? '1' : '0'}
        data-gait={gait ? '1' : '0'}
      >
        {isSheet ? (
          /*
           * 容器 = 正好一格（`cellW × size`），内层整图 = cols×rows 格。
           * 平移多少由 sheetTranslate 这个纯函数算（单测钉死了"每帧都落在网格内"）。
           * 比例还没量出来时先藏起来，避免用猜的比例画出一帧压扁的角色。
           */
          <div
            className="mascot-sheet"
            /* 检查要拿它对账：现在显示第几帧、容器一格多大 */
            data-frame={shown}
            data-cellw={Math.round(cellW)}
            style={{
              width: cellW + 'px',
              height: size + 'px',
              visibility: sheetAspect > 0 ? 'visible' : 'hidden',
            }}
          >
            <img
              className="mascot-sheet-img"
              src={asset.src}
              alt=""
              draggable={false}
              style={Object.assign(
                { width: cellW * cols + 'px', height: size * rows + 'px' },
                (function () {
                  const t = sheetTranslate(shown, cols, rows, cellW, size);
                  return { transform: 'translate3d(' + t.x + 'px,' + t.y + 'px,0)' };
                })()
              )}
            />
          </div>
        ) : (
          <img className="mascot-img" src={asset.src} alt="" draggable={false} />
        )}
        {/* 眨眼只对"一张静态图"做：逐帧图自己会动，再叠一层会打架 */}
        {blink && !isSheet ? <div className="mascot-blink" /> : null}
      </div>
      {shadow ? <div className="mascot-shadow" /> : null}
    </div>
  );
}

/** 当前帧落在网格的哪一格 —— 检查用（导出的纯函数，方便外部核对） */
export { cellOffset };
