import { loopMsOfSrc } from './animLoop';
import { frameCount, type MascotAsset } from './types';

/**
 * 逐帧素材的**播放时间**，以及"一帧一帧怎么走"。
 *
 * ## 为什么单独一个模块
 *
 * 两处代码必须对同一个数达成一致：
 *
 *   1. `MascotArt` 真正在播（rAF + 时间累加）；
 *   2. 状态机决定**这次反应持续多久**（`motion.poke` 的 `holdMs`）。
 *
 * 这两处一旦各算各的，就会出现"动画还没播完就被切回待机"——
 * 也就是"点一下，动作演到一半没了"。所以帧率、一遍要多久、怎么推进，
 * 全部收敛到这里，两边都调它。
 */

/**
 * 一次最多补几帧。
 *
 * 应用被切到后台再回来时 `dt` 可能是几秒，一口气补几十帧会看到"猛跳一闪"。
 * 宁可少补，慢一点也比闪一下好。
 */
export const MAX_CATCHUP = 1;

/** 逐帧素材没有写 fps 时的兜底帧率 */
export const DEFAULT_SHEET_FPS = 8;

/**
 * 实际生效的帧率。
 *
 * 用户在外观页调的帧率优先（`fpsOverride`），但 2fps 以下不算 —— 那是误操作，
 * 该走素材自己的值；素材自己也没写就用 8。
 */
export function sheetFps(asset: MascotAsset | undefined, fpsOverride?: number): number {
  const own = asset && asset.fps ? asset.fps : DEFAULT_SHEET_FPS;
  if (fpsOverride && fpsOverride >= 2) return fpsOverride;
  return own;
}

/**
 * 这张逐帧图**从头播到尾要多久**（毫秒）。
 *
 * 用**真实帧数**（frameCount，不是网格格数）除以帧率 ——
 * 网格最后一排常常排不满，那些空格子不该被算进播放长度里。
 * 不是逐帧图、或只有一帧时返回 0（没有"播一遍"这回事）。
 */
export function sheetPlayMs(asset: MascotAsset | undefined, fpsOverride?: number): number {
  if (!asset || asset.kind !== 'sheet') return 0;
  const frames = frameCount(asset);
  if (frames < 2) return 0;
  const fps = Math.max(1, sheetFps(asset, fpsOverride));
  return Math.round((frames / fps) * 1000);
}

/** 一帧停留多久（毫秒） */
export function frameStepMs(asset: MascotAsset | undefined, fpsOverride?: number): number {
  return 1000 / Math.max(1, sheetFps(asset, fpsOverride));
}

export interface FrameStepInput {
  /** 现在显示第几帧 */
  cur: number;
  /** 上一次取整后剩下的时间余量 */
  acc: number;
  /** 距上一次推进过了多久 */
  dt: number;
  /** 一帧多少毫秒 */
  step: number;
  /** 一共几帧 */
  frames: number;
  /**
   * `true` = **只播一遍**，走到最后一帧就停住（反应素材用这个）；
   * `false` = 循环（待机 / 走动那种一直在播的素材）。
   */
  once: boolean;
}

export interface FrameStepResult {
  frame: number;
  acc: number;
  /** 只播一遍时：已经播完了（调用方应当停掉 rAF） */
  done: boolean;
}

/**
 * 推进一帧（纯函数，单测钉死）。
 *
 * 时间累加而不是"数次数"：`setInterval` 按排队次数走，主线程一忙就积压，
 * 恢复时连着触发几次 —— 表现是卡一下然后猛跳几帧。
 *
 * `once` 模式下 **停在最后一帧**而不是回到第 0 帧 ——
 * 这是"反应的动画要能完整播完"的落点：播完那一刻画面停在收势上，
 * 等状态机那边到点再切回待机，用户看到的就是一整段动作。
 */
export function stepFrame(i: FrameStepInput): FrameStepResult {
  const frames = Math.max(1, Math.round(i.frames));
  const step = i.step > 0 ? i.step : 1000 / DEFAULT_SHEET_FPS;
  const acc = i.acc + Math.max(0, i.dt);
  if (acc < step) return { frame: i.cur, acc: acc, done: false };
  const advance = Math.min(MAX_CATCHUP, Math.floor(acc / step));
  const rest = acc - Math.floor(acc / step) * step;
  const next = i.cur + advance;
  if (i.once) {
    const last = frames - 1;
    if (next >= last) return { frame: last, acc: rest, done: true };
    return { frame: next, acc: rest, done: false };
  }
  return { frame: next % frames, acc: rest, done: false };
}

/**
 * 动图量不出时长时的兜底：**保守地给长一点**。
 *
 * 宁愿多留在反应状态里一会儿，也不要"演到一半被切掉" ——
 * 前者的代价是回到待机晚半秒，后者是用户看到一次被拦腰砍断的动画。
 */
export const ANIMATED_FALLBACK_MS = 1200;

/**
 * 这份素材**播一遍**要多久（毫秒）。0 = 没有可播的时间。
 *
 *   - 逐帧图：帧数 ÷ 帧率（精确）
 *   - 动图：从字节里量出来的循环长度，量不出来返回 0
 *   - 静态图：0（它自己不会动，动的是我们叠上去的程序化反应）
 */
export function assetPlayMs(asset: MascotAsset | undefined, fpsOverride?: number): number {
  if (!asset) return 0;
  if (asset.kind === 'sheet') return sheetPlayMs(asset, fpsOverride);
  if (asset.kind === 'animated') return loopMsOfSrc(asset.src);
  return 0;
}

/**
 * **点一下之后，反应至少要保持多久**（毫秒）。
 *
 * 这是"被点之后的动画要能完整播完"的核心算式：
 * 素材自己能演多久就留多久，量不出来就退到保守值；
 * 静态图（或没有 react 素材）则由程序化动作定长度，取 `minMs`。
 */
export function reactHoldMs(asset: MascotAsset | undefined, fpsOverride: number | undefined, minMs: number): number {
  const own = assetPlayMs(asset, fpsOverride);
  if (own > 0) {
    /*
     * 逐帧图再补**一帧的停留**：动画播到最后一帧那一刻如果立刻切走，
     * 那一帧只在屏幕上闪 1/fps 秒（8fps 就是 125ms）—— 看起来仍然像"演到一半没了"。
     * 停在收势上停一下，一整段动作才算真的被看到。
     */
    const tail = asset && asset.kind === 'sheet' ? frameStepMs(asset, fpsOverride) : 0;
    return Math.max(minMs, Math.round(own + tail));
  }
  if (asset && asset.kind === 'animated') return Math.max(minMs, ANIMATED_FALLBACK_MS);
  return minMs;
}

/** 夹到 [0, frames-1]，并容忍非整数输入（自检里读出来的是字符串） */
export function clampFrame(n: number, frames: number): number {
  const f = Math.max(1, Math.round(frames));
  if (!isFinite(n)) return 0;
  return Math.min(f - 1, Math.max(0, Math.round(n)));
}
