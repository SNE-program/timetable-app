import type { TimetableData } from './types';
import type { Theme } from '../theme/tokens';
import { validateTheme } from '../theme/themeFile';
import { parseTimetable, type ParseResult } from './transfer';

/**
 * 分享码：把一整份课表压成一段可粘贴的文本。
 *
 * 计划书 6.6 节写的是「课表压缩 → base64url 短码，用于同学之间互相导入」。
 * 这里刻意**不引入任何服务端** —— 本地优先是产品底线，为了一个分享功能
 * 把课表传到别人的服务器上，和整个立场是冲突的。所以码里带着全部数据。
 *
 * 实测一份 20 门课 / 40 个时段 / 含调课与任务的课表：
 *   JSON 11366 字符 → gzip 1397 字节 → base64url **1863 字符**
 * 也就是原始体积的 16%。这个长度粘进微信 / QQ 完全没问题。
 *
 * 用 gzip 而不是自己设计紧凑二进制格式：浏览器的 CompressionStream 是原生的，
 * 几毫秒就完事，而且不用为每一种字段写一套编解码 —— 少写一套映射就少一类 bug。
 * 万一本机没有 CompressionStream（很老的 WebView），退化成不压缩但标记出来，
 * 照样能用，只是码长一些。
 */

/** KBR = 课表助手（KeBiao zhuShou）；R1 = 版本 1 */
const PREFIX_GZIP = 'KBR1.';
const PREFIX_RAW = 'KBR1U.';

const hasCompression = function (): boolean {
  return typeof (globalThis as any).CompressionStream === 'function'
    && typeof (globalThis as any).DecompressionStream === 'function';
};

async function gzip(text: string): Promise<Uint8Array> {
  const cs = new (globalThis as any).CompressionStream('gzip');
  const stream = new Blob([text]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Uint8Array 的底层可能是 SharedArrayBuffer，BlobPart 只认 ArrayBuffer，这里切一份出来 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new (globalThis as any).DecompressionStream('gzip');
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

/**
 * 标准 base64 里有 + / = 三个会在聊天软件和 URL 里惹麻烦的字符，
 * 统一换成 URL 安全字母表并去掉补位。
 */
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;   /* 一次转太多会被 apply 的参数上限卡住 */
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ShareCodeInfo {
  code: string;
  chars: number;
  compressed: boolean;
}

/** 把课表编码成分享码 */
export async function encodeShareCode(data: TimetableData): Promise<ShareCodeInfo> {
  const json = JSON.stringify(data);
  if (hasCompression()) {
    const packed = toBase64Url(await gzip(json));
    return { code: PREFIX_GZIP + packed, chars: packed.length, compressed: true };
  }
  const raw = toBase64Url(new TextEncoder().encode(json));
  return { code: PREFIX_RAW + raw, chars: raw.length, compressed: false };
}

/** 这段文本看着像不像分享码（用来在粘贴框里给即时反馈） */
export function looksLikeShareCode(text: string): boolean {
  const t = text.trim();
  return t.startsWith(PREFIX_GZIP) || t.startsWith(PREFIX_RAW);
}

/**
 * 解码分享码。
 *
 * 解出来的 JSON 直接交给 `parseTimetable` —— 那是导入 JSON 备份用的同一套
 * 校验与降级逻辑。分享码不该有自己的一套解析规则，否则两条路径迟早会分叉：
 * 一条修了 bug，另一条没修。
 */
export async function decodeShareCode(text: string): Promise<ParseResult> {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return { ok: false, error: '分享码是空的' };

  let json: string;
  try {
    if (t.startsWith(PREFIX_GZIP)) {
      if (!hasCompression()) return { ok: false, error: '当前环境不支持解压分享码' };
      json = await gunzip(fromBase64Url(t.slice(PREFIX_GZIP.length)));
    } else if (t.startsWith(PREFIX_RAW)) {
      json = new TextDecoder().decode(fromBase64Url(t.slice(PREFIX_RAW.length)));
    } else {
      return { ok: false, error: '这不像是一个课表分享码（应以 KBR1. 开头）' };
    }
  } catch (e) {
    return { ok: false, error: '分享码解不开，可能复制时缺了一段：' + (e as Error).message };
  }

  return parseTimetable(json);
}

/* --------------------------- 外观分享码 --------------------------- */

/**
 * 外观分享码。
 *
 * 和课表分享码同一套压缩管线（gzip + base64url），但用不同前缀，
 * 导入时一眼就能分清拿到的是课表还是外观。
 *
 * **刻意不带壁纸图片**：一张壁纸动辄两三 MB，压完还是几百万字符，粘贴框都装不下。
 * 所以分享码只带"能描述出来的那部分"（配色、字体、排版、卡片质感），
 * 壁纸用主题包文件分享 —— 这一点在界面上如实写出来，不含糊。
 */
export const THEME_PREFIX_GZIP = 'KBT1.';
export const THEME_PREFIX_RAW = 'KBT1U.';

export async function encodeThemeCode(theme: Theme): Promise<ShareCodeInfo> {
  const slim = Object.assign({}, theme, {
    wallpaper: Object.assign({}, theme.wallpaper, { kind: 'none' as const, custom: '', original: undefined }),
  });
  const json = JSON.stringify(slim);
  if (hasCompression()) {
    const packed = toBase64Url(await gzip(json));
    return { code: THEME_PREFIX_GZIP + packed, chars: packed.length, compressed: true };
  }
  const raw = toBase64Url(new TextEncoder().encode(json));
  return { code: THEME_PREFIX_RAW + raw, chars: raw.length, compressed: false };
}

export function looksLikeThemeCode(text: string): boolean {
  const t = text.trim();
  return t.startsWith(THEME_PREFIX_GZIP) || t.startsWith(THEME_PREFIX_RAW);
}

export type ThemeCodeResult =
  | { ok: true; theme: Theme; warnings: string[] }
  | { ok: false; error: string };

export async function decodeThemeCode(text: string): Promise<ThemeCodeResult> {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return { ok: false, error: '分享码是空的' };

  let json: string;
  try {
    if (t.startsWith(THEME_PREFIX_GZIP)) {
      if (!hasCompression()) return { ok: false, error: '当前环境不支持解压分享码' };
      json = await gunzip(fromBase64Url(t.slice(THEME_PREFIX_GZIP.length)));
    } else if (t.startsWith(THEME_PREFIX_RAW)) {
      json = new TextDecoder().decode(fromBase64Url(t.slice(THEME_PREFIX_RAW.length)));
    } else {
      return { ok: false, error: '这不像是一个外观分享码（应以 KBT1. 开头）' };
    }
  } catch (e) {
    return { ok: false, error: '分享码解不开，可能复制时缺了一段：' + (e as Error).message };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: '分享码里的内容不是合法数据' };
  }

  /* 走主题包那套校验 —— 分享码不该有另一套规则，否则两条路迟早分叉 */
  const r = validateTheme(parsed);
  if (!r.ok || !r.theme) return { ok: false, error: r.errors.join('；') || '外观数据不完整' };
  return { ok: true, theme: r.theme, warnings: r.warnings };
}

