import { describe, expect, it } from 'vitest';
import { cellOffset, sheetTranslate } from './sheet';

/**
 * 这一组是给「角色一闪一闪」那个 bug 钉的回归。
 *
 * 当时错在 CSS 的百分比位移语义上（负倍数把雪碧图推出了容器），
 * 表现是**每圈只有第 0 帧能看见**。现在位移是纯像素计算，这里把它钉死：
 * 每一帧都必须落在网格内、互不重复、并且按行列顺序推进。
 */
describe('逐帧图的格子定位', function () {
  it('按行优先推进，一圈走满每一格', function () {
    const seen = new Set<string>();
    for (let f = 0; f < 16; f++) {
      const o = cellOffset(f, 8, 2);
      seen.add(o.col + ',' + o.row);
    }
    expect(seen.size).toBe(16);
    expect(cellOffset(0, 8, 2)).toEqual({ col: 0, row: 0 });
    expect(cellOffset(7, 8, 2)).toEqual({ col: 7, row: 0 });
    expect(cellOffset(8, 8, 2)).toEqual({ col: 0, row: 1 });
    expect(cellOffset(15, 8, 2)).toEqual({ col: 7, row: 1 });
  });

  it('单排（只有一行）时行号恒为 0', function () {
    for (let f = 0; f < 6; f++) expect(cellOffset(f, 6, 1).row).toBe(0);
  });

  it('单列时列号恒为 0', function () {
    for (let f = 0; f < 6; f++) expect(cellOffset(f, 1, 6).col).toBe(0);
  });

  it('帧号超出网格会绕回来，不会跑到图外面', function () {
    expect(cellOffset(16, 8, 2)).toEqual({ col: 0, row: 0 });
    expect(cellOffset(17, 8, 2)).toEqual({ col: 1, row: 0 });
    expect(cellOffset(-1, 8, 2)).toEqual({ col: 7, row: 1 });
  });

  it('格数是脏数据时不崩（至少 1×1）', function () {
    expect(cellOffset(3, 0, 0)).toEqual({ col: 0, row: 0 });
    expect(cellOffset(3, NaN, NaN)).toEqual({ col: 0, row: 0 });
  });

  it('位移是纯像素：第 k 格正好往左推 k 格', function () {
    expect(sheetTranslate(0, 8, 2, 100, 140)).toEqual({ x: 0, y: 0 });
    expect(sheetTranslate(1, 8, 2, 100, 140)).toEqual({ x: -100, y: 0 });
    expect(sheetTranslate(7, 8, 2, 100, 140)).toEqual({ x: -700, y: 0 });
    expect(sheetTranslate(8, 8, 2, 100, 140)).toEqual({ x: 0, y: -140 });
  });

  it('★ 位移永远在"整张图"的范围内，也就是永远有内容落在容器里', function () {
    /*
     * 旧写法（百分比）会算出正位移把图推到容器右边，容器里什么都没有。
     * 现在的约束很简单：x ∈ [-(cols-1)·cellW, 0]，y ∈ [-(rows-1)·cellH, 0]。
     */
    const cols = 8, rows = 2, cellW = 105, cellH = 140;
    for (let f = 0; f < cols * rows; f++) {
      const t = sheetTranslate(f, cols, rows, cellW, cellH);
      expect(t.x).toBeLessThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(0);
      expect(t.x).toBeGreaterThanOrEqual(-(cols - 1) * cellW);
      expect(t.y).toBeGreaterThanOrEqual(-(rows - 1) * cellH);
    }
  });

  it('同一帧永远给同一个位移（可复现）', function () {
    expect(sheetTranslate(5, 6, 3, 80, 120)).toEqual(sheetTranslate(5, 6, 3, 80, 120));
  });
});
