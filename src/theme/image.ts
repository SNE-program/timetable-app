/** 图片处理：任何用户上传的图片都会被压到可长期存储的体积 */

export interface ProcessedImage { src: string; width: number; height: number; bytes: number; mime: string; }

let webpSupport: boolean | null = null;

function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    webpSupport = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch (e) { webpSupport = false; }
  return webpSupport;
}

export function dataUriBytes(src: string): number {
  const i = src.indexOf(',');
  if (i < 0) return 0;
  return Math.round((src.length - i - 1) * 0.75);
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function loadBitmap(file: File): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }> {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      resolve({
        w: img.naturalWidth, h: img.naturalHeight,
        draw: function (ctx, w, h) { ctx.drawImage(img, 0, 0, w, h); },
      });
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
    img.src = url;
  });
}

export async function processImageFile(file: File, maxDim: number, quality: number): Promise<ProcessedImage> {
  if (!file.type || file.type.indexOf('image/') !== 0) throw new Error('请选择图片文件');
  const max = maxDim || 1920;
  const q = quality || 0.82;
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.w, bmp.h));
  const w = Math.max(1, Math.round(bmp.w * scale));
  const h = Math.max(1, Math.round(bmp.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持图片处理');
  bmp.draw(ctx, w, h);
  const useWebp = supportsWebp();
  const isPng = file.type === 'image/png';
  const mime = useWebp ? 'image/webp' : (isPng ? 'image/png' : 'image/jpeg');
  const src = canvas.toDataURL(mime, useWebp || !isPng ? q : undefined);
  return { src: src, width: w, height: h, bytes: dataUriBytes(src), mime: mime };
}

/** 一张图（data URI 或 asset 引用还原出来的 data URI）的原始像素尺寸 */
export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = function () { reject(new Error('图片读不出来')); };
    img.src = src;
  });
}

/** 原样读成 data URI（不缩放），交给剪裁面板用 */
export function readFileAsDataUri(file: File): Promise<string> {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(String(r.result)); };
    r.onerror = function () { reject(new Error('文件读取失败')); };
    r.readAsDataURL(file);
  });
}

/* ------------------------------ 角色图：能不压就不压 ------------------------------ */

/**
 * "原样保留"还是"重新压"——**纯函数，能单测**。
 *
 * 为什么要留一条原样保留的路：重新压一遍是**有损的二次编码**，
 * 而且会把动图拍成静态图（canvas 只画得出第一帧）。
 * 角色素材常常是别人做好的动图，压一次就从"会动"变成"不动"，这个损失不可接受。
 * 所以只要体积和像素量都在安全线以内，就原样搬进资产库。
 */
export interface KeepOriginalOpts {
  /** 原样保留的体积上限（字节），默认 3MB */
  keepBytes?: number;
  /** 静态图原样保留的像素上限，默认 400 万（解码后约 16MB） */
  keepPixels?: number;
  /** 动图更保守：解码器会缓存多帧，默认 150 万像素 */
  animatedPixels?: number;
}

export function shouldKeepOriginal(
  info: { bytes: number; w: number; h: number; animated: boolean },
  opts?: KeepOriginalOpts
): boolean {
  const keepBytes = (opts && opts.keepBytes) || 3 * 1024 * 1024;
  const keepPixels = (opts && opts.keepPixels) || 4000000;
  const animatedPixels = (opts && opts.animatedPixels) || 1500000;
  if (!(info.bytes > 0) || info.bytes > keepBytes) return false;
  const px = info.w * info.h;
  if (!(px > 0)) return false;
  return px <= (info.animated ? animatedPixels : keepPixels);
}

export interface MascotImage {
  src: string;
  width: number;
  height: number;
  bytes: number;
  /** 建议的素材形态：确认是动图就给 animated */
  kind: 'still' | 'animated';
  /** 原样搬过来的（没有二次压缩） */
  original: boolean;
  /** 太大被压过 */
  downscaled: boolean;
  /** 本来是动图，但太大只能压成静态图 —— 界面要如实告诉用户 */
  lostAnimation: boolean;
}

/** 用 ImageDecoder 问一句"这张图有几帧"。问不到就当静态图 */
async function detectAnimated(file: File): Promise<boolean> {
  const Decoder = (window as unknown as { ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => {
    tracks: { selectedTrack?: { frameCount?: number } | null };
    completed: Promise<void>;
    close?: () => void;
  } }).ImageDecoder;
  if (typeof Decoder !== 'function') return false;
  try {
    const data = await file.arrayBuffer();
    const dec = new Decoder({ data: data, type: file.type });
    await dec.completed;
    const track = dec.tracks.selectedTrack;
    const n = track && track.frameCount ? track.frameCount : 1;
    if (typeof dec.close === 'function') dec.close();
    return n > 1;
  } catch (e) {
    return false;
  }
}

/**
 * 角色图片入库前的处理。
 *
 * 三条路，按优先级：
 *   1. 体积与像素都在安全线内 → **原样保留**（不动图、不丢动图、不二次有损压缩）；
 *   2. 太大 → 压到 maxDim 长边（默认 1536：显示高度上限 320px 在 3.5 倍屏上是
 *      1120 物理像素，1024 其实差一点点，所以这里留出余量）；
 *   3. 压的时候如果本来是动图 → 记一笔 lostAnimation，界面如实说"已经变成静态图"。
 */
export async function prepareMascotImage(
  file: File, maxDim: number, quality: number, opts?: KeepOriginalOpts
): Promise<MascotImage> {
  if (!file.type || file.type.indexOf('image/') !== 0) throw new Error('请选择图片文件');
  const animated = await detectAnimated(file);
  const bmp = await loadBitmap(file);
  const info = { bytes: file.size, w: bmp.w, h: bmp.h, animated: animated };

  if (shouldKeepOriginal(info, opts)) {
    const src = await readFileAsDataUri(file);
    return {
      src: src, width: bmp.w, height: bmp.h, bytes: dataUriBytes(src),
      kind: animated ? 'animated' : 'still',
      original: true, downscaled: false, lostAnimation: false,
    };
  }

  const img = await processImageFile(file, maxDim, quality);
  return {
    src: img.src, width: img.width, height: img.height, bytes: img.bytes,
    kind: animated ? 'animated' : 'still',
    original: false, downscaled: true, lostAnimation: animated,
  };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(String(r.result)); };
    r.onerror = function () { reject(new Error('文件读取失败')); };
    r.readAsText(file);
  });
}
