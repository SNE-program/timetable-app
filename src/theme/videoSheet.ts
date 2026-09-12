import { dataUriBytes } from './image';

/**
 * 视频 → 逐帧雪碧图。
 *
 * ## 为什么要有这条管线
 *
 * 二游角色的动图素材大量是 **webm**（带透明通道的 VP9 居多），而 webm 是视频不是图片：
 * `<img>` 解不了，我们原有的图片管线第一行就把它拒了。
 * 但它恰好能变成我们已经支持的第三种素材形态 —— **逐帧雪碧图**：
 * 抽若干帧、拼成一张网格图，剩下的交给现成的播放逻辑。
 *
 * 这么做比"直接播视频"好在三点：
 *   1. 不用新增素材类型，资产库、导出、编辑器全都不用改；
 *   2. 不依赖 video 的自动播放策略，也不会在桌面上同时跑一堆解码器；
 *   3. 抽完就是一坨**确定的像素**，帧率、循环、暂停全由我们自己说了算。
 *
 * ## 纯计算和 DOM 分开
 *
 * `planSheet` / `chooseGrid` / `framesFromOccupancy` 是纯函数，**能单测**；
 * 真正的解码要 `<video>` + canvas，那段只能在 WebView 里跑。
 * 排版算错的表现是"切出来的帧错位"或者"角色每隔几帧消失一次"，这种错误靠肉眼很难查，
 * 所以必须测 —— 下面这两个规则各对应一次真实事故：
 *
 *   - 网格格数 ≠ 真实帧数：9 帧放进 8×2 的网格，最后 7 格是全透明的，
 *     播放时按 16 格循环 → **角色每循环闪 7 帧**（v0.15.1 之前的行为，用户报的"一闪一闪"）；
 *   - 单格被压得太小：旧上限是"整图 2048 / 单格 480"，1080p 竖屏视频抽 48 帧之后
 *     每格只剩 183×326，在 3.5 倍屏上按 1.5 倍放大 → **糊**（用户报的"分辨率太低"）。
 */

export interface SheetPlanInput {
  videoW: number;
  videoH: number;
  durationSec: number;
  /**
   * 目标帧率，默认 **18**。
   *
   * 原来是 12：抽出来的动作明显一顿一顿的（用户反馈「帧率有点低」）。
   * 提到 18 之后 1 秒的素材从 12 帧变 18 帧，观感接近原生动画；
   * 代价是网格多几格，由像素总量那道闸门兜着，单格不会因此糊掉。
   */
  fps?: number;
  /** 雪碧图最长边上限，默认 4096 */
  maxEdge?: number;
  /** 抽帧数上限，默认 60 —— 再多雪碧图就大得没意义了 */
  maxFrames?: number;
  /** 单格高度上限，默认 720（显示高度上限 320px 在 3.5 倍屏上是 1120 物理像素） */
  maxCellHeight?: number;
  /** 整张雪碧图的像素总量上限，默认 800 万（解码后约 32MB 显存/内存，手机上的安全线） */
  maxPixels?: number;
}

export interface SheetPlan {
  cols: number;
  rows: number;
  /** **真实帧数**。最后一排排不满时它小于 cols×rows，播放必须以它为准 */
  frames: number;
  /** 网格里排不满、永远是透明的那几格。界面用它提示"要不要少抽几帧" */
  blank: number;
  cellW: number;
  cellH: number;
  fps: number;
  /** 每一帧取视频里的哪个时刻（秒） */
  timestamps: number[];
}

const FPS_MIN = 4;
const FPS_MAX = 24;
/** 一排放几格：8 格封顶，再多整图就会瘦长到超过纹理上限 */
const COLS_MAX = 8;
/** 行数上限：太高会让整图变成细长条，最后一排放不满的概率也更大 */
const ROWS_MAX = 12;
const CELL_H_MIN = 96;

const DEFAULT_MAX_EDGE = 4096;
const DEFAULT_MAX_CELL_H = 720;
const DEFAULT_MAX_PIXELS = 8000000;

function clamp(n: number, lo: number, hi: number): number {
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export interface GridLimits {
  maxEdge: number;
  maxCellHeight: number;
  maxPixels: number;
}

/**
 * 一排放几格。
 *
 * 优先选**能整除**帧数的列数（4..8 里从大到小找），因为整除意味着最后一排是满的：
 * 12 帧排 6×2、18 帧排 6×3、24 帧排 8×3、30 帧排 6×5，网格里一格不空。
 * 找不到整除的（比如 9、27、46 帧）就退回"尽量 8 列"，
 * 由 `frames` 字段保证播放时不会播到空档 —— **这是两条腿，缺一条就会闪**。
 */
export function chooseGrid(frames: number): { cols: number; rows: number } {
  const n = Math.max(2, Math.round(frames));
  for (let c = COLS_MAX; c >= 4; c--) {
    if (n % c === 0 && n / c <= ROWS_MAX) return { cols: c, rows: n / c };
  }
  let cols = Math.min(n, COLS_MAX);
  while (Math.ceil(n / cols) > ROWS_MAX && cols < n) cols++;
  return { cols: cols, rows: Math.ceil(n / cols) };
}

/**
 * 单格多大。
 *
 * 从"视频原始高度、但不超过 maxCellHeight"起步，再按三个上限往下收：
 * 整图长边、整图像素总量。收不动了就到 CELL_H_MIN 为止 ——
 * 那个下限保证了 12 行也不会超过 4096。
 */
export function fitCell(
  cols: number, rows: number, videoW: number, videoH: number, limits: GridLimits
): { cellW: number; cellH: number } {
  const w = videoW > 0 ? videoW : 1;
  const h = videoH > 0 ? videoH : 1;
  let cellH = Math.min(h, limits.maxCellHeight);
  let cellW = Math.max(1, Math.round(cellH * w / h));
  let guard = 0;
  while (guard < 60 && cellH > CELL_H_MIN) {
    const overEdge = cols * cellW > limits.maxEdge || rows * cellH > limits.maxEdge;
    const overPixels = cols * cellW * rows * cellH > limits.maxPixels;
    if (!overEdge && !overPixels) break;
    cellH = Math.floor(cellH * 0.88);
    cellW = Math.max(1, Math.round(cellH * w / h));
    guard++;
  }
  return { cellW: cellW, cellH: cellH };
}

/** 每一帧取哪一刻：取每段的中点，躲开首尾那两格黑边（很多视频第一帧是黑的） */
function sampleTimes(duration: number, frames: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < frames; i++) out.push(Number((duration * (i + 0.5) / frames).toFixed(3)));
  return out;
}

export function planSheet(input: SheetPlanInput): SheetPlan {
  const fps = clamp(Math.round(input.fps === undefined ? 18 : input.fps), FPS_MIN, FPS_MAX);
  const limits: GridLimits = {
    maxEdge: Math.max(256, Math.round(input.maxEdge === undefined ? DEFAULT_MAX_EDGE : input.maxEdge)),
    maxCellHeight: Math.max(CELL_H_MIN, Math.round(input.maxCellHeight === undefined ? DEFAULT_MAX_CELL_H : input.maxCellHeight)),
    maxPixels: Math.max(65536, Math.round(input.maxPixels === undefined ? DEFAULT_MAX_PIXELS : input.maxPixels)),
  };
  const maxFrames = Math.max(2, Math.round(input.maxFrames === undefined ? 60 : input.maxFrames));

  const duration = isFinite(input.durationSec) && input.durationSec > 0 ? input.durationSec : 2;
  const videoW = input.videoW > 0 ? input.videoW : 1;
  const videoH = input.videoH > 0 ? input.videoH : 1;

  const frames = clamp(Math.round(duration * fps), 2, maxFrames);
  const grid = chooseGrid(frames);
  const cell = fitCell(grid.cols, grid.rows, videoW, videoH, limits);

  return {
    cols: grid.cols,
    rows: grid.rows,
    frames: frames,
    blank: grid.cols * grid.rows - frames,
    cellW: cell.cellW,
    cellH: cell.cellH,
    fps: fps,
    timestamps: sampleTimes(duration, frames),
  };
}

/* ------------------------------ 空帧判定（纯函数部分） ------------------------------ */

/**
 * 由"每格有没有内容"推出真实帧数。
 *
 * 规则：**末尾连续的空格不算帧**。逐帧图排不满只会空在最后一排的右边，
 * 所以从后往前找到第一个有内容的格子，帧数就是它的下标 +1。
 * 中间的空格（有些动画确实有一帧全透明）不动 —— 那是素材本来的样子。
 */
export function framesFromOccupancy(occupied: boolean[], cols: number, rows: number): number {
  const cells = Math.max(1, cols) * Math.max(1, rows);
  let last = -1;
  for (let i = 0; i < Math.min(cells, occupied.length); i++) if (occupied[i]) last = i;
  if (last < 0) return cells;          /* 整张都是空的：别乱改，交给上层报错 */
  return last + 1;
}

export interface SheetScan {
  /** 真实帧数（末尾空档不算） */
  frames: number;
  /** 完全是空的格子数 */
  emptyCells: number;
  /** 抽样测过的格子数 */
  cells: number;
  /** 空格子占比，0..1 */
  emptyRatio: number;
}

/* ------------------------------ 解码与抽帧 ------------------------------ */

export interface VideoSheetResult {
  src: string;
  bytes: number;
  plan: SheetPlan;
  /** 视频本身读到的信息，界面上如实显示出来 */
  videoW: number;
  videoH: number;
  durationSec: number;
  /** 抽完之后逐格量一遍的结果：用来兜住"解码器根本没出画"这类失败 */
  scan: SheetScan;
  /** 编码成什么格式（webp 还是退回 png） */
  mime: string;
}

export class VideoSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoSheetError';
  }
}

export function waitFor(el: HTMLVideoElement, event: string, ms: number): Promise<void> {
  return new Promise(function (resolve, reject) {
    let done = false;
    const timer = window.setTimeout(function () {
      if (done) return;
      done = true;
      cleanup();
      reject(new VideoSheetError('等待视频「' + event + '」超时'));
    }, ms);
    function onOk(): void { if (done) return; done = true; cleanup(); resolve(); }
    function onErr(): void { if (done) return; done = true; cleanup(); reject(new VideoSheetError('这个视频解不开，可能是系统解码器不支持它的编码')); }
    function cleanup(): void {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
    }
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

/** 有些 webm 的 duration 一开始是 Infinity，得靠"跳到极大位置"逼它算出来 */
async function resolveDuration(v: HTMLVideoElement): Promise<number> {
  if (isFinite(v.duration) && v.duration > 0) return v.duration;
  try {
    v.currentTime = 1e101;
    await waitFor(v, 'durationchange', 2000);
    v.currentTime = 0;
  } catch (e) { /* 拿不到就算了，下面给兜底值 */ }
  return isFinite(v.duration) && v.duration > 0 ? v.duration : 2;
}

/**
 * 跳到某一刻并**等到真的能画**。
 *
 * 只等 `seeked` 是不够的：它只保证"位置跳过去了"。在手机上解码器慢半拍的时候，
 * 这时候 drawImage 拿到的是上一次的画面甚至一片空白 —— 抽出来就是一堆空格子，
 * 表现同样是"角色一闪一闪"。有 requestVideoFrameCallback 就再等一次真实出帧。
 */
async function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  v.currentTime = t;
  await waitFor(v, 'seeked', 5000);
  const rvfc = (v as unknown as { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
  if (typeof rvfc !== 'function') return;
  await new Promise<void>(function (resolve) {
    let done = false;
    const finish = function (): void { if (!done) { done = true; resolve(); } };
    const to = window.setTimeout(finish, 400);
    try {
      rvfc.call(v, function () { window.clearTimeout(to); finish(); });
    } catch (e) { window.clearTimeout(to); finish(); }
  });
}

function supportsWebp(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch (e) { return false; }
}

/** data URI → 已解码的图片 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new VideoSheetError('拼好的逐帧图读不回来')); };
    img.src = src;
  });
}

/**
 * 逐格量一遍：这一格到底有没有画上东西。
 *
 * 实现上**一次只铺一排**到小画布上再读像素：整张 800 万像素的图铺满画布要 32MB，
 * 手机上不值得；一排最多 8 格，几百 KB 就够了。
 */
export async function scanSheetCells(src: string, cols: number, rows: number): Promise<SheetScan> {
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  const img = await loadImage(src);
  const cellW = Math.floor(img.naturalWidth / c);
  const cellH = Math.floor(img.naturalHeight / r);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, cellW * c);
  canvas.height = Math.max(1, cellH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || cellW < 2 || cellH < 2) {
    return { frames: c * r, emptyCells: 0, cells: c * r, emptyRatio: 0 };
  }

  const occupied: boolean[] = [];
  let empty = 0;
  for (let row = 0; row < r; row++) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, row * cellH, canvas.width, cellH, 0, 0, canvas.width, cellH);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let col = 0; col < c; col++) {
      let has = false;
      for (let y = 0; y < cellH && !has; y += 3) {
        const base = (y * canvas.width + col * cellW) * 4;
        for (let x = 0; x < cellW; x += 3) {
          /* 阈值 8：编码噪声留下的极淡像素不算内容 */
          if (data[base + x * 4 + 3] > 8) { has = true; break; }
        }
      }
      occupied.push(has);
      if (!has) empty++;
    }
  }

  const cells = c * r;
  return {
    frames: framesFromOccupancy(occupied, c, r),
    emptyCells: empty,
    cells: cells,
    emptyRatio: cells > 0 ? empty / cells : 0,
  };
}

/**
 * 把一段视频抽帧拼成雪碧图。
 *
 * 返回的是 data URI，形态上和我们从图片得到的东西完全一样 ——
 * 上层（资产库、导出、编辑器）不需要知道它来自视频。
 */
export async function videoToSpriteSheet(
  file: Blob, opts?: Omit<SheetPlanInput, 'videoW' | 'videoH' | 'durationSec'>
): Promise<VideoSheetResult> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.setAttribute('playsinline', '');
  v.src = url;

  try {
    await waitFor(v, 'loadedmetadata', 12000);
    const durationSec = await resolveDuration(v);
    const videoW = v.videoWidth;
    const videoH = v.videoHeight;
    if (!videoW || !videoH) throw new VideoSheetError('读不到视频的画面尺寸，这个文件可能只有音轨');

    const plan = planSheet(Object.assign({}, opts || {}, {
      videoW: videoW, videoH: videoH, durationSec: durationSec,
    }));

    const sheet = document.createElement('canvas');
    sheet.width = plan.cols * plan.cellW;
    sheet.height = plan.rows * plan.cellH;
    const ctx = sheet.getContext('2d');
    if (!ctx) throw new VideoSheetError('当前设备不支持画布导出');

    /* 逐帧抽：每次都等真的出帧，否则会连画同一帧（甚至画空白） */
    for (let i = 0; i < plan.frames; i++) {
      await seekTo(v, plan.timestamps[i]);
      const col = i % plan.cols;
      const row = Math.floor(i / plan.cols);
      ctx.clearRect(col * plan.cellW, row * plan.cellH, plan.cellW, plan.cellH);
      ctx.drawImage(v, col * plan.cellW, row * plan.cellH, plan.cellW, plan.cellH);
    }

    const useWebp = supportsWebp();
    const mime = useWebp ? 'image/webp' : 'image/png';
    const src = sheet.toDataURL(mime, 0.92);
    /*
     * 超大画布在部分设备上会静默失败（toDataURL 返回 "data:,"），
     * 那时候角色会"设置成功了但屏幕上什么都没有" —— 宁可当场报错。
     */
    if (!src || src.length < 512) {
      throw new VideoSheetError('这台设备画不出这么大的逐帧图（' + sheet.width + '×' + sheet.height + '），换一段更短的视频试试');
    }

    const scan = await scanSheetCells(src, plan.cols, plan.rows);
    return {
      src: src,
      bytes: dataUriBytes(src),
      plan: plan,
      videoW: videoW,
      videoH: videoH,
      durationSec: durationSec,
      scan: scan,
      mime: mime,
    };
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* 释放解码器，失败无所谓 */ }
  }
}

/**
 * 抽帧结果说成人话 —— 面板和编辑器共用，免得两边对同一件事说法不一样。
 *
 * 为什么连"每帧多大"都要说：用户报的就是"分辨率太低"。
 * 这件事**能算**（显示高度 × 屏幕倍率 = 需要的物理像素），算得出来就该讲明白，
 * 而不是让他自己去猜"是不是应用做得糙"。糊也照样能用，所以这里只是提示。
 */
export function describeVideoSheet(
  r: { plan: SheetPlan; scan: SheetScan; bytes: number; videoW: number; videoH: number },
  displayHeight: number,
  dpr: number
): { summary: string; notes: string[] } {
  const plan = r.plan;
  const kb = Math.round(r.bytes / 1024);
  const gridNote = plan.blank > 0 ? '（网格 ' + plan.cols + '×' + plan.rows + '，最后一排空 ' + plan.blank + ' 格，播放时不会走到）' : '';
  const summary = '已抽 ' + plan.frames + ' 帧 · ' + plan.cols + '×' + plan.rows + gridNote
    + ' · ' + plan.fps + ' fps · 每帧 ' + plan.cellW + '×' + plan.cellH + ' 像素 · ' + kb + ' KB';

  const notes: string[] = [];
  const need = Math.round(Math.max(1, displayHeight) * (isFinite(dpr) && dpr > 0 ? dpr : 1));
  if (plan.cellH < need * 0.9) {
    const maxClean = Math.floor(plan.cellH / (isFinite(dpr) && dpr > 0 ? dpr : 1));
    notes.push('每帧只有 ' + plan.cellH + ' 像素高，在 ' + (Math.round((dpr || 1) * 10) / 10) + ' 倍屏上显示高度超过 '
      + maxClean + 'px 就会发虚（当前 ' + Math.round(displayHeight) + 'px 需要 ' + need + ' 物理像素）。'
      + '把显示高度调到 ' + maxClean + 'px 以内最清楚。');
  }
  if (r.scan.emptyCells > 0) {
    const pct = Math.round(r.scan.emptyRatio * 100);
    notes.push('有 ' + r.scan.emptyCells + ' 格（' + pct + '%）是空的：多半是这个视频的透明通道系统解码器不支持。'
      + '换一段 mp4 或者带透明通道的 png 序列再试。');
  }
  return { summary: summary, notes: notes };
}

export function isVideoFile(file: { type?: string; name?: string }): boolean {
  if (file.type && file.type.indexOf('video/') === 0) return true;
  const n = (file.name || '').toLowerCase();
  return /\.(webm|mp4|mov|m4v|ogv|avi|mkv)$/.test(n);
}
