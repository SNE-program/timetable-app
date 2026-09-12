import { describe, expect, it } from 'vitest';
import { chooseGrid, describeVideoSheet, fitCell, framesFromOccupancy, isVideoFile, planSheet } from './videoSheet';

const BASE = { videoW: 400, videoH: 600, durationSec: 3 };

describe('雪碧图排版', function () {
  it('3 秒 18fps → 54 帧，排成 6×9（整除，一格不空）', function () {
    const p = planSheet(BASE);
    expect(p.frames).toBe(54);
    expect(p.fps).toBe(18);
    expect(p.cols).toBe(6);
    expect(p.rows).toBe(9);
    expect(p.blank).toBe(0);
    expect(p.timestamps.length).toBe(54);
  });

  it('★ 默认抽帧率是 18（用户反馈 12 太顿）', function () {
    expect(planSheet(BASE).fps).toBe(18);
    /* 同样的时长，18fps 比 12fps 多出一半的帧 */
    expect(planSheet(Object.assign({}, BASE, { fps: 12 })).frames).toBe(36);
  });

  it('格数足够装下所有帧，且空档数如实报出来', function () {
    for (const duration of [0.5, 1, 2.5, 4, 9]) {
      const p = planSheet(Object.assign({}, BASE, { durationSec: duration }));
      expect(p.cols * p.rows).toBeGreaterThanOrEqual(p.frames);
      expect(p.blank).toBe(p.cols * p.rows - p.frames);
      expect(p.cols).toBeLessThanOrEqual(8);
    }
  });

  it('抽帧取每段中点，避开首尾的黑帧', function () {
    const p = planSheet(BASE);
    expect(p.timestamps[0]).toBeGreaterThan(0);
    expect(p.timestamps[p.timestamps.length - 1]).toBeLessThan(BASE.durationSec);
    /* 单调递增，没有重复 */
    for (let i = 1; i < p.timestamps.length; i++) {
      expect(p.timestamps[i]).toBeGreaterThan(p.timestamps[i - 1]);
    }
  });

  it('帧数有上限：长视频不会抽出一张巨图', function () {
    const p = planSheet(Object.assign({}, BASE, { durationSec: 600 }));
    expect(p.frames).toBe(60);
    expect(p.timestamps[p.timestamps.length - 1]).toBeLessThan(600);
  });

  it('极短视频至少抽两帧', function () {
    const p = planSheet(Object.assign({}, BASE, { durationSec: 0.05 }));
    expect(p.frames).toBe(2);
  });

  it('时长拿不到时用兜底值，而不是算出 0 帧', function () {
    expect(planSheet(Object.assign({}, BASE, { durationSec: 0 })).frames).toBeGreaterThanOrEqual(2);
    expect(planSheet(Object.assign({}, BASE, { durationSec: NaN })).frames).toBeGreaterThanOrEqual(2);
    expect(planSheet(Object.assign({}, BASE, { durationSec: Infinity })).frames).toBeGreaterThanOrEqual(2);
  });

  it('大分辨率视频会被缩小到最长边以内', function () {
    const p = planSheet({ videoW: 1920, videoH: 1080, durationSec: 3, maxEdge: 2048 });
    expect(p.cols * p.cellW).toBeLessThanOrEqual(2048);
    expect(p.rows * p.cellH).toBeLessThanOrEqual(2048);
    expect(Math.abs(p.cellW / p.cellH - 1920 / 1080)).toBeLessThan(0.05);
  });

  it('竖屏长视频：优先保证整图装得下', function () {
    const p = planSheet({ videoW: 1080, videoH: 1920, durationSec: 8 });
    expect(p.cols * p.cellW).toBeLessThanOrEqual(4096);
    expect(p.rows * p.cellH).toBeLessThanOrEqual(4096);
    expect(p.cellH).toBeGreaterThanOrEqual(96);
    expect(p.cellW).toBeGreaterThanOrEqual(1);
  });

  it('★ 分辨率：常见竖屏短视频的单格要够清楚', function () {
    /*
     * 这条是给"分辨率太低"那个反馈钉的回归：
     * 旧上限（整图 2048 / 单格 480）把 48 帧的竖屏视频压到每格 183×326，
     * 而显示高度 140px 在 3.5 倍屏上要 490 物理像素 —— 放大 1.5 倍，肉眼就是糊。
     * 现在单格必须至少顶到显示所需的那 490 像素。
     */
    const need = 140 * 3.5;
    const cases = [
      { videoW: 500, videoH: 700, durationSec: 0.75 },
      { videoW: 500, videoH: 700, durationSec: 2 },
      { videoW: 1080, videoH: 1920, durationSec: 2 },
      { videoW: 1080, videoH: 1920, durationSec: 1 },
    ];
    for (const c of cases) {
      const p = planSheet(c);
      expect(p.cellH).toBeGreaterThanOrEqual(need);
      expect(Math.abs(p.cellW / p.cellH - c.videoW / c.videoH)).toBeLessThan(0.05);
    }
    /* 短片段（帧少、摊得开）应当接近原始分辨率，而不是被随手砍一半 */
    const short = planSheet({ videoW: 500, videoH: 700, durationSec: 1 });
    expect(short.cellH).toBe(700);
    expect(short.cellW).toBe(500);
  });

  it('★ 像素总量有上限：解码后不能把内存吃光', function () {
    const p = planSheet({ videoW: 1080, videoH: 1920, durationSec: 8 });
    expect(p.cols * p.cellW * p.rows * p.cellH).toBeLessThanOrEqual(8000000);
  });

  it('帧率会被夹到 4–24', function () {
    expect(planSheet(Object.assign({}, BASE, { fps: 1 })).fps).toBe(4);
    expect(planSheet(Object.assign({}, BASE, { fps: 99 })).fps).toBe(24);
  });

  it('尺寸读不到时不崩（给 1×1 兜底）', function () {
    const p = planSheet({ videoW: 0, videoH: 0, durationSec: 2 });
    expect(p.cellW).toBeGreaterThanOrEqual(1);
    expect(p.cellH).toBeGreaterThanOrEqual(1);
    expect(p.frames).toBeGreaterThanOrEqual(2);
  });

  it('同一个输入永远给同一个排版（可复现）', function () {
    expect(planSheet(BASE)).toEqual(planSheet(BASE));
  });
});

describe('网格列数', function () {
  it('能整除就排满：帧数=6/12/18/24/30/48 都不会留空档', function () {
    for (const frames of [6, 12, 18, 24, 30, 36, 48, 40, 42, 45]) {
      const g = chooseGrid(frames);
      expect(g.cols * g.rows).toBe(frames);
      expect(g.cols).toBeLessThanOrEqual(8);
      expect(g.rows).toBeLessThanOrEqual(12);
    }
  });

  it('整除不了的帧数（9 / 27 / 46）退回接近 8 列，行数不失控', function () {
    for (const frames of [9, 27, 46]) {
      const g = chooseGrid(frames);
      expect(g.cols).toBe(8);
      expect(g.rows).toBe(Math.ceil(frames / 8));
      expect(g.rows).toBeLessThanOrEqual(12);
    }
  });

  it('极少帧数也排得出来', function () {
    for (const frames of [2, 3, 4, 5, 7]) {
      const g = chooseGrid(frames);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(frames);
      expect(g.cols).toBeLessThanOrEqual(8);
    }
  });
});

describe('单格尺寸', function () {
  const LIMITS = { maxEdge: 4096, maxCellHeight: 720, maxPixels: 8000000 };

  it('保持视频宽高比', function () {
    const c = fitCell(4, 2, 1000, 500, LIMITS);
    expect(Math.abs(c.cellW / c.cellH - 2)).toBeLessThan(0.05);
  });

  it('三个上限都会被遵守', function () {
    const c = fitCell(8, 6, 1080, 1920, LIMITS);
    expect(8 * c.cellW).toBeLessThanOrEqual(4096);
    expect(6 * c.cellH).toBeLessThanOrEqual(4096);
    expect(8 * c.cellW * 6 * c.cellH).toBeLessThanOrEqual(8000000);
  });

  it('小视频不会被放大', function () {
    const c = fitCell(4, 1, 120, 160, LIMITS);
    expect(c.cellW).toBe(120);
    expect(c.cellH).toBe(160);
  });
});

describe('空帧判定', function () {
  it('末尾连续的空格不算帧（这正是"一闪一闪"的来源）', function () {
    /* 9 帧放进 8×2：前 9 格有内容，后面 7 格是空的 */
    const occupied = [true, true, true, true, true, true, true, true, true, false, false, false, false, false, false, false];
    expect(framesFromOccupancy(occupied, 8, 2)).toBe(9);
  });

  it('中间的空格保留（素材本来就有全透明的一帧）', function () {
    const occupied = [true, false, true, true, true, true];
    expect(framesFromOccupancy(occupied, 6, 1)).toBe(6);
  });

  it('排满时就是格数', function () {
    expect(framesFromOccupancy([true, true, true, true], 2, 2)).toBe(4);
  });

  it('整张全空时不乱改（交给上层报错）', function () {
    expect(framesFromOccupancy([false, false, false, false], 2, 2)).toBe(4);
  });

  it('占用表比格子少时不越界', function () {
    expect(framesFromOccupancy([true, true], 4, 4)).toBe(2);
  });
});

describe('抽帧结果的说法', function () {
  const plan = {
    cols: 8, rows: 2, frames: 9, blank: 7, cellW: 233, cellH: 326, fps: 12,
    timestamps: [] as number[],
  };
  const scan = { frames: 9, emptyCells: 0, cells: 16, emptyRatio: 0 };

  it('摘要里写清帧数、网格、单格尺寸和体积', function () {
    const r = describeVideoSheet({ plan: plan, scan: scan, bytes: 1024 * 300, videoW: 500, videoH: 700 }, 140, 3.5);
    expect(r.summary).toContain('9 帧');
    expect(r.summary).toContain('最后一排空 7 格');
    expect(r.summary).toContain('233×326');
    expect(r.summary).toContain('300 KB');
  });

  it('单格不够显示所需像素时明确提示，并给出还能撑到多高', function () {
    const r = describeVideoSheet({ plan: plan, scan: scan, bytes: 1000, videoW: 500, videoH: 700 }, 320, 3.5);
    expect(r.notes.length).toBe(1);
    expect(r.notes[0]).toContain('326');
    /* 326 / 3.5 = 93，所以超过 93px 就会发虚 */
    expect(r.notes[0]).toContain('93');
  });

  it('单格够清楚时不多嘴', function () {
    const big = Object.assign({}, plan, { cellW: 405, cellH: 720, frames: 16, blank: 0 });
    const r = describeVideoSheet({ plan: big, scan: scan, bytes: 1000, videoW: 500, videoH: 700 }, 140, 3.5);
    expect(r.notes.length).toBe(0);
  });

  it('大量空格子时如实说"解码器没出画"', function () {
    const bad = { frames: 16, emptyCells: 12, cells: 16, emptyRatio: 0.75 };
    const r = describeVideoSheet({ plan: plan, scan: bad, bytes: 1000, videoW: 500, videoH: 700 }, 140, 3.5);
    expect(r.notes.join(' ')).toContain('12 格');
    expect(r.notes.join(' ')).toContain('透明通道');
  });
});

describe('视频文件识别', function () {
  it('按 MIME', function () {
    expect(isVideoFile({ type: 'video/webm', name: 'a' })).toBe(true);
    expect(isVideoFile({ type: 'video/mp4', name: 'a' })).toBe(true);
  });

  it('MIME 拿不到时按扩展名', function () {
    /* 有些相册给出来的 File 没有 type，只能靠名字 */
    expect(isVideoFile({ type: '', name: '角色.webm' })).toBe(true);
    expect(isVideoFile({ name: '角色.MP4' })).toBe(true);
    expect(isVideoFile({ type: '', name: '角色.png' })).toBe(false);
    expect(isVideoFile({ type: '', name: '角色.json' })).toBe(false);
  });

  it('图片不会被误判成视频', function () {
    expect(isVideoFile({ type: 'image/webp', name: 'a.webp' })).toBe(false);
    expect(isVideoFile({ type: 'image/gif', name: 'a.gif' })).toBe(false);
  });
});