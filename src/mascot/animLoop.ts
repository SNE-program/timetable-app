/**
 * 动图**一遍要播多久** —— 从字节里量出来。
 *
 * ## 为什么需要它
 *
 * 角色的"被点一下"可以是三种素材：静态图、逐帧图、动图。
 *
 *   - 逐帧图的时间我们能算（帧数 ÷ 帧率）；
 *   - 静态图由程序化动作演，时间是我们自己定的；
 *   - **动图的时间只有浏览器知道** —— 它自己循环播放，DOM 上没有任何接口能问出"一遍多久"。
 *
 * 问不出来就会出这种事：动图循环长度是 2.4 秒，而我们把反应按 0.9 秒切掉，
 * 于是每点一下都只看到前半段。用户的原话是"动画要确保完全播放（时间可能不一样）"。
 *
 * 所以这里直接把字节读一遍：GIF 的 Graphic Control Extension、APNG 的 fcTL、
 * 动图 WebP 的 ANMF 里都写着每一帧停多久，加起来就是一遍的长度。
 *
 * 三种格式都在"应用接受的动图格式"里（GIF / 动图 WebP / APNG），
 * 解析不了的一律返回 0 = **不知道**，由调用方退回一个保守的默认值 ——
 * 猜一个数总比装作知道要好。
 *
 * 纯字节运算，不依赖 DOM，也不引入任何第三方解析库。
 */

/** 不解析超过这个体积的 data URI（base64 字符数）。几十 MB 的字符串处理会卡住主线程 */
const MAX_B64 = 32 * 1024 * 1024;

/** 少于一帧的时间没有意义；超过 10 秒的多半是解析错了 */
const MIN_LOOP_MS = 40;
const MAX_LOOP_MS = 10000;

function u16le(b: Uint8Array, p: number): number {
  return b[p] | (b[p + 1] << 8);
}
function u32le(b: Uint8Array, p: number): number {
  return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
}
function u24le(b: Uint8Array, p: number): number {
  return b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
}
function u32be(b: Uint8Array, p: number): number {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
}
function tag(b: Uint8Array, p: number): string {
  return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
}
function sane(ms: number, frames: number): number {
  if (!isFinite(ms) || frames < 2) return 0;
  const r = Math.round(ms);
  if (r < MIN_LOOP_MS || r > MAX_LOOP_MS) return 0;
  return r;
}

/** GIF 里跳过一串子块（每块：长度字节 + 内容），返回终止符之后的位置 */
function gifSkipBlocks(b: Uint8Array, p: number): number {
  let i = p;
  while (i < b.length) {
    const size = b[i];
    if (size === 0) return i + 1;
    i += 1 + size;
  }
  return b.length;
}

/**
 * GIF：把所有 Graphic Control Extension 里的延时加起来。
 *
 * 有一个必须照抄浏览器的规则：**延时小于 2 厘秒（20ms）时按 100ms 处理** ——
 * 大量老 GIF 的延时写的是 0 或 1，浏览器不会真的按 0 播放，
 * 我们要是按字面加，算出来的总长会比实际短一个数量级。
 */
export function gifLoopMs(b: Uint8Array): number {
  if (b.length < 14 || String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') return 0;
  const packed = b[10];
  let p = 13;
  if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1));
  let total = 0;
  let frames = 0;
  while (p < b.length) {
    const marker = b[p];
    if (marker === 0x3b) break;                 /* trailer */
    if (marker === 0x21) {                      /* extension */
      const label = b[p + 1];
      p += 2;
      if (label === 0xf9 && b[p] === 4) {
        const delay = u16le(b, p + 2);
        /* 浏览器规则：<2cs 一律当 10cs */
        total += (delay < 2 ? 10 : delay) * 10;
        frames++;
      }
      p = gifSkipBlocks(b, p);
      continue;
    }
    if (marker === 0x2c) {                      /* image descriptor */
      const imgPacked = b[p + 9];
      p += 10;
      if (imgPacked & 0x80) p += 3 * (1 << ((imgPacked & 0x07) + 1));
      p += 1;                                   /* LZW 最小码长 */
      p = gifSkipBlocks(b, p);
      continue;
    }
    /* 认不出来了：不再往下猜 */
    return 0;
  }
  return sane(total, frames);
}

/**
 * APNG：把所有 fcTL 的 delay_num / delay_den 加起来。
 *
 * fcTL 的布局是固定的 26 字节：序号 / 宽 / 高 / x / y / 分子 / 分母 / 处理方式 / 混合方式。
 * 分母为 0 时按规范当 100。
 */
export function apngLoopMs(b: Uint8Array): number {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 16) return 0;
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return 0;
  let p = 8;
  let total = 0;
  let frames = 0;
  let declared = 0;
  while (p + 12 <= b.length) {
    const len = u32be(b, p);
    const type = tag(b, p + 4);
    const data = p + 8;
    if (data + len > b.length) break;
    if (type === 'acTL') declared = u32be(b, data);
    else if (type === 'fcTL' && len >= 26) {
      const num = (b[data + 20] << 8) | b[data + 21];
      const den = (b[data + 22] << 8) | b[data + 23];
      total += (den === 0 ? num / 100 : num / den) * 1000;
      frames++;
    } else if (type === 'IEND') break;
    p = data + len + 4;
  }
  /*
   * 帧数取 acTL 与 fcTL 里大的那个：第一帧常常直接放在 IDAT 里（没有 fcTL、不参与计时），
   * 于是"动画帧数 = fcTL 数 + 1"才是常态。只看 fcTL 数会把一段只有两帧的动图判成"不是动图"。
   */
  return sane(total, Math.max(frames, declared));
}

/**
 * 动图 WebP：把一个动画里所有 ANMF 帧的显示时长加起来。
 *
 * ANMF 的前 12 个字节是 x / y / 宽-1 / 高-1（各 3 字节），紧接着 3 字节才是时长（毫秒）。
 */
export function webpLoopMs(b: Uint8Array): number {
  if (b.length < 16 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WEBP') return 0;
  let p = 12;
  let total = 0;
  let frames = 0;
  while (p + 8 <= b.length) {
    const type = tag(b, p);
    const size = u32le(b, p + 4);
    const data = p + 8;
    if (size > b.length) break;
    if (type === 'ANMF' && size >= 16) {
      total += u24le(b, data + 12);
      frames++;
    }
    p = data + size + (size & 1);
  }
  return sane(total, frames);
}

/** 按魔数分派；认不出来或不是动图时返回 0（= 不知道） */
export function animatedLoopMs(b: Uint8Array): number {
  if (!b || b.length < 16) return 0;
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return gifLoopMs(b);   /* GIF */
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return webpLoopMs(b);
  if (b[0] === 0x89 && b[1] === 0x50) return apngLoopMs(b);
  return 0;
}

/**
 * 把 data URI 解成字节。解不出来（不是 base64、太大、编码坏了）返回 null。
 *
 * 存盘后的角色包在内存里也是 data URI（见 types.ts 顶部），所以这条路径够用；
 * 真遇到 `asset:<key>` 这种没读出来的引用，就当"不知道时长"处理。
 */
export function dataUriBytes(src: string): Uint8Array | null {
  const s = src || '';
  if (s.slice(0, 5) !== 'data:') return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const head = s.slice(5, comma);
  if (head.indexOf(';base64') < 0) return null;
  const body = s.slice(comma + 1);
  if (body.length === 0 || body.length > MAX_B64) return null;
  try {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    return null;
  }
}

/** 量过的结果缓存：同一张素材反复被点，不必每次都解一遍字节 */
const cache = new Map<string, number>();
const CACHE_MAX = 16;

/**
 * 一张动图素材**一遍**播多久（毫秒）；量不出来返回 0。
 *
 * 结果按 src 缓存 —— 一张 4MB 的动图解析一次大约几十毫秒，
 * 而"点一下"是随时会发生的，不能每次都重算。
 */
export function loopMsOfSrc(src: string): number {
  if (!src) return 0;
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const bytes = dataUriBytes(src);
  const ms = bytes ? animatedLoopMs(bytes) : 0;
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(src, ms);
  return ms;
}
