/**
 * 「角色」——桌面上那个可以点、会自己动的小东西。
 *
 * ## 为什么没有内置角色
 *
 * 这一版**一个内置角色都没有**：不导入就什么都不显示。
 * 理由有三条，每条都是硬的：
 *
 *   1. 有人就是不喜欢屏幕上多个活物。默认没有，这些人永远感知不到这个功能；
 *   2. 角色素材多半来自别处（自己画的、二游立绘、网上的动图），
 *      内置角色反而会让人觉得"这应用想让我用它给的东西"；
 *   3. 内置角色要么难看（程序化生成的抽象图形大多数人不会想留着），
 *      要么涉及素材版权 —— 不做最干净。
 *
 * ## 为什么是纯数据
 *
 * 角色包和主题包一样，**只描述"显示什么"，不带任何代码**。
 * 这既是为了不破"产物里没有第三方代码"这条底线，
 * 也意味着一个角色包能闯的最大的祸就是"显示得不好看"。
 *
 * ## 素材形态只有三种，都是 WebView 原生就能播的
 *
 *   - `still`    一张静态图（PNG / WebP / JPEG），靠程序化动画让它"活着"
 *   - `animated` 动图（动图 WebP / APNG / GIF），浏览器自己会播
 *   - `sheet`    逐帧雪碧图（一张图里横竖排着 N 帧），用 CSS steps() 播
 *
 * 刻意不支持 Live2D / Rive / Spine / Lottie —— 它们每一个都要求引入运行时，
 * 而我们整个产物里目前没有一行第三方代码，这个代价换一个吉祥物不值。
 */

/** 素材形态 */
export type MascotAssetKind = 'still' | 'animated' | 'sheet';

export interface MascotAsset {
  kind: MascotAssetKind;
  /** data URI，或存盘后的 `asset:<key>` 引用。内存里永远是前者 */
  src: string;
  /** sheet 专用：一张图横着几格、竖着几格 */
  cols?: number;
  rows?: number;
  /** sheet 专用：播放帧率，1..24 */
  fps?: number;
  /**
   * sheet 专用：**里面真正画了几帧**。
   *
   * 为什么必须单独存：排版时最后一排经常排不满（9 帧放进 8×2 的网格就有 7 格是空的），
   * 那些空格子是全透明的。**播放时如果按 cols×rows 循环，就会把这些透明格也播一遍**
   * —— 表现是角色每隔几帧消失一次，也就是"一闪一闪、大部分时间不显示"。
   * 缺省（老角色包没有这个字段）时退回 cols×rows，与旧版本行为一致。
   */
  frames?: number;
}

/**
 * 角色的五种状态。
 *
 * 只有 idle 是必填的 —— 其余缺了就退化成 idle，
 * 而不是报错："只放一张图"必须是一条能走通的路径。
 *
 * `walk` 是后加的：走动与待机本来共用一张素材，于是"来回走走"看起来只是**横着平移**，
 * 和站着发呆没有区别。给一份走路素材（图 / 动图 / 视频都行）就有走的样子；
 * 不给也不会出错 —— 没有 walk 素材时退回 idle，并由一套程序化的"迈步"动作补上区别
 * （见 components.css 里的 mascotGaitStep 与 MascotArt 的 gait）。
 */
export type MascotState = 'idle' | 'walk' | 'react' | 'sleep' | 'drag';

export const MASCOT_STATES: MascotState[] = ['idle', 'walk', 'react', 'sleep', 'drag'];

export const STATE_LABEL: Record<MascotState, string> = {
  idle: '待机',
  walk: '走动',
  react: '被点一下',
  sleep: '长时间没动',
  drag: '被拖动时',
};

/** 程序化叠加动画：静态图也能有呼吸感 */
export interface MascotMotion {
  /** 呼吸幅度（纵向缩放），0 关闭，最大 0.08 */
  breathe: number;
  /** 上下浮动幅度（相对高度的比例），0 关闭，最大 0.06 */
  bob: number;
  /** 左右摇摆幅度（度），0 关闭，最大 8 */
  sway: number;
}

export interface MascotInteractive {
  /** 点一下有没有反应 */
  click: boolean;
  /** 能不能拖着换位置 */
  drag: boolean;
}

export interface MascotPack {
  format: string;
  version: number;
  id: string;
  name: string;
  author?: string;
  description?: string;
  createdAt?: string;
  /** 建议显示高度（px）。只是建议，用户在外观页可以再调 */
  height: number;
  states: Partial<Record<MascotState, MascotAsset>>;
  motion: MascotMotion;
  interactive: MascotInteractive;
  /** 给角色加一层柔和投影。深色立绘在浅色背景上容易"浮"起来 */
  shadow: boolean;
  /** 贴边锚点，0..1，默认底部居中 (0.5, 1) */
  anchor: { x: number; y: number };
}

export const HEIGHT_MIN = 56;
export const HEIGHT_MAX = 320;
export const FPS_MIN = 1;
export const FPS_MAX = 24;
export const SHEET_MAX = 32;

export function defaultMotion(): MascotMotion {
  return { breathe: 0.02, bob: 0.01, sway: 0 };
}

export function defaultInteractive(): MascotInteractive {
  return { click: true, drag: true };
}

/** 角色包在界面上的显示高度是建议值，真正的取值范围在这里收敛 */
export function clampHeight(n: number): number {
  if (!isFinite(n)) return 120;
  return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(n)));
}

/** 一张逐帧图最多能有多少格（校验时和 SHEET_MAX 一起用） */
export const FRAME_MAX = SHEET_MAX * SHEET_MAX;

/**
 * 逐帧图**实际要播几帧**。
 *
 * 这是"角色一闪一闪"那个 bug 的唯一出口，改这里之前先读 `frames` 字段上的注释：
 * 网格格数 ≠ 真实帧数，多出来的格子是全透明的，播到它们角色就消失了。
 */
export function frameCount(asset: MascotAsset | undefined): number {
  if (!asset || asset.kind !== 'sheet') return 0;
  const cols = Math.max(1, Math.round(asset.cols || 1));
  const rows = Math.max(1, Math.round(asset.rows || 1));
  const cells = cols * rows;
  if (asset.frames === undefined || asset.frames === null) return cells;
  const n = Math.round(Number(asset.frames));
  if (!isFinite(n) || n < 2) return cells;
  return Math.max(2, Math.min(cells, n));
}

/** 网格里有多少格是**永远不会播到的空档**（最后一排没排满的那几格） */
export function blankCells(asset: MascotAsset | undefined): number {
  if (!asset || asset.kind !== 'sheet') return 0;
  const cols = Math.max(1, Math.round(asset.cols || 1));
  const rows = Math.max(1, Math.round(asset.rows || 1));
  return Math.max(0, cols * rows - frameCount(asset));
}
