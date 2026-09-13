import { describe, expect, it } from 'vitest';
import {
  ANIMATED_FALLBACK_MS, MAX_CATCHUP, assetPlayMs, clampFrame, frameStepMs, reactHoldMs,
  sheetFps, sheetPlayMs, stepFrame,
} from './playback';
import type { MascotAsset } from './types';

/** 一 GIF 的 base64（下面那张 3 帧、每帧 20cs 的最小动图，见 animLoop.test.ts） */
function b64(bytes: number[]): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += table[a >> 2] + table[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? table[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? table[c & 63] : '=';
  }
  return out;
}

/** 造一张最小 GIF：`n` 帧，每帧延时 `cs` 厘秒 */
function gifBytes(n: number, cs: number): number[] {
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x00, 0, 0];
  for (let i = 0; i < n; i++) {
    out.push(0x21, 0xf9, 0x04, 0x00, cs & 0xff, (cs >> 8) & 0xff, 0x02, 0x00);
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00);
    out.push(0x02, 0x01, 0x00, 0x00);
  }
  out.push(0x3b);
  return out;
}

const SHEET: MascotAsset = { kind: 'sheet', src: 'data:image/png;base64,AA', cols: 3, rows: 3, fps: 8, frames: 9 };
const STILL: MascotAsset = { kind: 'still', src: 'data:image/png;base64,AA' };
const ANIMATED: MascotAsset = { kind: 'animated', src: 'data:image/gif;base64,' + b64(gifBytes(3, 20)) };
const ANIMATED_UNKNOWN: MascotAsset = { kind: 'animated', src: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E' };

describe('逐帧素材的时间', function () {
  it('帧率：素材自己的 → 用户的 → 兜底 8，3fps 这种误操作不算数', function () {
    expect(sheetFps(undefined)).toBe(8);
    expect(sheetFps(SHEET)).toBe(8);
    expect(sheetFps({ kind: 'sheet', src: 'x', fps: 12 })).toBe(12);
    expect(sheetFps(SHEET, 18)).toBe(18);
    expect(sheetFps(SHEET, 1)).toBe(8);
    expect(sheetFps(SHEET, 0)).toBe(8);
    expect(frameStepMs(SHEET, 18)).toBeCloseTo(55.55, 1);
  });

  it('一遍的长度 = 真实帧数 ÷ 帧率（不是网格格数）', function () {
    /* 3×3 网格里只画了 9 帧，fps 8 → 9/8 秒 */
    expect(sheetPlayMs(SHEET)).toBe(1125);
    /* 网格 16 格但只画了 9 帧：多出来的 7 格是全透明的，不能算进播放长度 */
    expect(sheetPlayMs({ kind: 'sheet', src: 'x', cols: 8, rows: 2, fps: 8, frames: 9 })).toBe(1125);
    /* 没有 frames 字段的老包：退回网格格数 */
    expect(sheetPlayMs({ kind: 'sheet', src: 'x', cols: 4, rows: 2, fps: 8 })).toBe(1000);
    /* 用户把帧率调到 18：一遍就短了 */
    expect(sheetPlayMs(SHEET, 18)).toBe(500);
  });

  it('静态图与单帧图没有"播一遍"这回事', function () {
    expect(sheetPlayMs(STILL)).toBe(0);
    expect(sheetPlayMs({ kind: 'sheet', src: 'x', cols: 1, rows: 1, fps: 8 })).toBe(0);
    expect(sheetPlayMs(undefined)).toBe(0);
  });
});

describe('反应要保持多久', function () {
  it('逐帧图：按它自己的长度（这正是"时间可能不一样"），末尾再停一帧', function () {
    /* 9 帧 ÷ 8fps = 1125ms，再停一帧（125ms），最后一帧才不会一闪而过 */
    expect(reactHoldMs(SHEET, undefined, 460)).toBe(1250);
    /* 用户把帧率调到 18：一遍 500ms，停一帧 56ms */
    expect(reactHoldMs(SHEET, 18, 460)).toBe(556);
    /* 但永远不会短过程序化动作那个下限 */
    expect(reactHoldMs({ kind: 'sheet', src: 'x', cols: 2, rows: 1, fps: 24 }, undefined, 900)).toBe(900);
  });

  it('静态图：交给程序化动作，取那个下限', function () {
    expect(reactHoldMs(STILL, undefined, 520)).toBe(520);
    expect(reactHoldMs(undefined, undefined, 520)).toBe(520);
  });

  it('动图：从字节里量出来的循环长度', function () {
    expect(assetPlayMs(ANIMATED)).toBe(600);
    expect(reactHoldMs(ANIMATED, undefined, 520)).toBe(600);
    /* 更长的那段也要完整播完，不能被 0.9 秒切掉 */
    expect(reactHoldMs({ kind: 'animated', src: 'data:image/gif;base64,' + b64(gifBytes(4, 60)) }, undefined, 520)).toBe(2400);
  });

  it('量不出时长的动图：退到保守值，而不是装作知道', function () {
    expect(assetPlayMs(ANIMATED_UNKNOWN)).toBe(0);
    expect(reactHoldMs(ANIMATED_UNKNOWN, undefined, 520)).toBe(ANIMATED_FALLBACK_MS);
  });
});

describe('一帧一帧怎么走', function () {
  const base = { cur: 0, acc: 0, step: 100, frames: 4, once: false };

  it('循环：走到底就回到第 0 帧', function () {
    let s = { cur: 0, acc: 0 };
    for (let i = 0; i < 4; i++) {
      const r = stepFrame(Object.assign({}, base, s, { dt: 100 }));
      expect(r.done).toBe(false);
      s = { cur: r.frame, acc: r.acc };
    }
    expect(s.cur).toBe(0);
  });

  it('时间不够就停在原帧', function () {
    const r = stepFrame(Object.assign({}, base, { dt: 40 }));
    expect(r.frame).toBe(0);
    expect(r.acc).toBe(40);
  });

  it('慢了一拍不会猛跳：最多补 ' + MAX_CATCHUP + ' 帧', function () {
    const r = stepFrame(Object.assign({}, base, { dt: 900 }));
    expect(r.frame).toBe(1);
  });

  it('★ 只播一遍：停在最后一帧，并且报 done', function () {
    let cur = 0;
    let acc = 0;
    let done = false;
    let ticks = 0;
    while (!done && ticks < 20) {
      const r = stepFrame({ cur: cur, acc: acc, dt: 100, step: 100, frames: 4, once: true });
      cur = r.frame;
      acc = r.acc;
      done = r.done;
      ticks++;
    }
    expect(cur).toBe(3);
    expect(done).toBe(true);
    expect(ticks).toBe(3);
    /* 已经播完之后再推也不会绕回开头 */
    const after = stepFrame({ cur: cur, acc: acc, dt: 500, step: 100, frames: 4, once: true });
    expect(after.frame).toBe(3);
  });

  it('夹帧数：越界与 NaN 都收回来', function () {
    expect(clampFrame(9, 4)).toBe(3);
    expect(clampFrame(-3, 4)).toBe(0);
    expect(clampFrame(NaN, 4)).toBe(0);
  });
});
