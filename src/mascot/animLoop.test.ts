import { describe, expect, it } from 'vitest';
import {
  animatedLoopMs, apngLoopMs, dataUriBytes, gifLoopMs, loopMsOfSrc, webpLoopMs,
} from './animLoop';

/**
 * 这一组测试的素材是**手写的字节**，不是真图 ——
 * 解析器要能被钉死，就不能依赖"某张图刚好在那儿"。
 * 每个格式都按规范的最小结构拼出来，再逐字段对照。
 */

/** 最小 GIF：`n` 帧，每帧延时 `cs` 厘秒（1 厘秒 = 10ms） */
function gif(n: number, cs: number, globalColorTable = false): number[] {
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, globalColorTable ? 0x80 : 0x00, 0, 0];
  if (globalColorTable) out.push(0, 0, 0, 255, 255, 255);   /* 2 色全局色表 = 6 字节 */
  for (let i = 0; i < n; i++) {
    /* GCE 的载荷是 4 字节：packed / delay_lo / delay_hi / 透明色索引，末尾才是终止符 */
    out.push(0x21, 0xf9, 0x04, 0x00, cs & 0xff, (cs >> 8) & 0xff, 0x02, 0x00);
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00);
    out.push(0x02, 0x01, 0x00, 0x00);   /* LZW 最小码长 2 + 一个 1 字节子块 + 终止符 */
  }
  out.push(0x3b);
  return out;
}

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  const out = [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
  for (let i = 0; i < 4; i++) out.push(type.charCodeAt(i));
  return out.concat(data, [0, 0, 0, 0]);   /* CRC 不参与解析 */
}

/** 最小 APNG：acTL 声明 `n` 帧，每帧 delay=num/den 秒 */
function apng(n: number, num: number, den: number): number[] {
  const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  out.push.apply(out, chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  out.push.apply(out, chunk('acTL', [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, 0, 0, 0, 0]));
  for (let i = 0; i < n; i++) {
    /* fcTL 固定 26 字节：序号 / 宽 / 高 / x / y（各 4）+ 分子 / 分母（各 2）+ 处理 / 混合 */
    const fctl = [(i >>> 24) & 255, 0, 0, i + 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    fctl.push((num >> 8) & 255, num & 255, (den >> 8) & 255, den & 255, 0, 0);
    out.push.apply(out, chunk('fcTL', fctl));
  }
  out.push.apply(out, chunk('IEND', []));
  return out;
}

function riffChunk(type: string, data: number[]): number[] {
  const size = data.length;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) out.push(type.charCodeAt(i));
  out.push(size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >> 24) & 255);
  out.push.apply(out, data);
  if (size & 1) out.push(0);
  return out;
}

/** 最小动图 WebP：`n` 帧，每帧显示 `ms` 毫秒 */
function webp(n: number, ms: number): number[] {
  const body: number[] = [];
  body.push.apply(body, riffChunk('VP8X', [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  body.push.apply(body, riffChunk('ANIM', [0, 0, 0, 0, 0, 0]));
  for (let i = 0; i < n; i++) {
    const frame = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    frame.push(ms & 255, (ms >> 8) & 255, (ms >> 16) & 255, 0);
    body.push.apply(body, riffChunk('ANMF', frame));
  }
  const out: number[] = [0x52, 0x49, 0x46, 0x46];
  const size = 4 + body.length;
  out.push(size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >> 24) & 255);
  out.push(0x57, 0x45, 0x42, 0x50);
  return out.concat(body);
}

function bytes(a: number[]): Uint8Array {
  return new Uint8Array(a);
}

/** 自己写 base64 编码：测试不该依赖 Buffer / btoa 这些环境里的东西 */
function toBase64(list: number[]): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < list.length; i += 3) {
    const a = list[i];
    const b = i + 1 < list.length ? list[i + 1] : 0;
    const c = i + 2 < list.length ? list[i + 2] : 0;
    out += table[a >> 2] + table[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < list.length ? table[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < list.length ? table[c & 63] : '=';
  }
  return out;
}

describe('动图一遍播多久', function () {
  it('GIF：把每帧的延时加起来', function () {
    /* 3 帧 × 20 厘秒 = 600ms */
    expect(gifLoopMs(bytes(gif(3, 20)))).toBe(600);
    /* 带全局色表（解析必须跳过那 6 个字节，否则整段错位） */
    expect(gifLoopMs(bytes(gif(3, 20, true)))).toBe(600);
    /* 5 帧 × 4 厘秒 = 200ms */
    expect(gifLoopMs(bytes(gif(5, 4)))).toBe(200);
  });

  it('GIF：延时 0 / 1 厘秒按浏览器的规则当 10 厘秒', function () {
    /* 老 GIF 大量写 0；浏览器不会真的按 0 播放，我们也不能 */
    expect(gifLoopMs(bytes(gif(3, 0)))).toBe(300);
    expect(gifLoopMs(bytes(gif(2, 1)))).toBe(200);
  });

  it('GIF：只有一帧、或者不是一个 GIF，都算"不知道"', function () {
    expect(gifLoopMs(bytes(gif(1, 20)))).toBe(0);
    expect(gifLoopMs(bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))).toBe(0);
    expect(gifLoopMs(new Uint8Array(0))).toBe(0);
  });

  it('APNG：把所有 fcTL 的 delay_num/delay_den 加起来', function () {
    /* 3 帧 × 1/10 秒 = 300ms */
    expect(apngLoopMs(bytes(apng(3, 1, 10)))).toBe(300);
    /* 2 帧 × 3/4 秒 = 1500ms */
    expect(apngLoopMs(bytes(apng(2, 3, 4)))).toBe(1500);
    /* 分母写 0 时按规范当 100：5 帧 × 5/100 秒 = 250ms */
    expect(apngLoopMs(bytes(apng(5, 5, 0)))).toBe(250);
  });

  it('动图 WebP：把所有 ANMF 帧的时长加起来', function () {
    expect(webpLoopMs(bytes(webp(3, 200)))).toBe(600);
    expect(webpLoopMs(bytes(webp(2, 1000)))).toBe(2000);
    /* 不是动图（没有 ANMF）就是不知道 */
    expect(webpLoopMs(bytes(webp(0, 0)))).toBe(0);
  });

  it('按魔数分派，认不出来的不硬猜', function () {
    expect(animatedLoopMs(bytes(gif(3, 20)))).toBe(600);
    expect(animatedLoopMs(bytes(webp(3, 200)))).toBe(600);
    expect(animatedLoopMs(bytes(apng(3, 1, 10)))).toBe(300);
    /* SVG、JPEG、随手的字节 */
    expect(animatedLoopMs(bytes([0x3c, 0x73, 0x76, 0x67, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0);
    expect(animatedLoopMs(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0);
  });

  it('明显不合理的长度当作解析失败（宁可退回默认值）', function () {
    /* 两帧各 6 秒 = 12 秒：超过 10 秒一律不信，多半是字节错位解出来的 */
    expect(gifLoopMs(bytes(gif(2, 600)))).toBe(0);
  });
});

describe('从 data URI 到时长', function () {
  it('base64 能解出来，就能量出长度', function () {
    const b = gif(3, 20);
    const uri = 'data:image/gif;base64,' + toBase64(b);
    expect(dataUriBytes(uri)?.length).toBe(b.length);
    expect(loopMsOfSrc(uri)).toBe(600);
    /* 量过的会缓存：同一个 src 再来一次是同一个答案 */
    expect(loopMsOfSrc(uri)).toBe(600);
  });

  it('不是 base64 的 data URI、空串、asset: 引用都算不知道', function () {
    expect(dataUriBytes('data:image/svg+xml;charset=utf-8,%3Csvg%3E')).toBe(null);
    expect(dataUriBytes('asset:abc')).toBe(null);
    expect(dataUriBytes('')).toBe(null);
    expect(loopMsOfSrc('asset:abc')).toBe(0);
    expect(loopMsOfSrc('')).toBe(0);
  });

  it('base64 坏掉时不抛异常，只是量不出来', function () {
    expect(dataUriBytes('data:image/gif;base64,!!!!!!!!')).toBe(null);
    expect(loopMsOfSrc('data:image/gif;base64,!!!!!!!!')).toBe(0);
  });
});
