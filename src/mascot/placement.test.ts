import { describe, expect, it } from 'vitest';
import { clampAnchor, isInside, planWalkStep, usableRange, walkRoom } from './placement';

/**
 * 摆放规则的测试。
 *
 * 判据在 v0.15.5 放宽过一次：从「整个角色都在区域内」改成「**锚点**在区域内」。
 * 那一版的用户反馈是「可以移动的范围太小了」，所以这里直接量"能拖多远"：
 * 一只 140px 高的角色，纵向活动范围必须接近整个可用高度，而不是被身高吃掉。
 */
const O = { vw: 360, vh: 760, insets: { top: 100, bottom: 60 }, edge: 6 };

describe('可用纵向范围', function () {
  it('默认是顶栏下沿到标签栏上沿', function () {
    expect(usableRange(760, { top: 100, bottom: 60 })).toEqual({ top: 100, bottom: 700 });
  });

  it('上下挤满时退回整个视口，而不是给一个负区间', function () {
    expect(usableRange(760, { top: 800, bottom: 800 })).toEqual({ top: 0, bottom: 760 });
  });
});

describe('锚点钳制（只要求落脚点在区域内）', function () {
  it('范围内的位置原样保留', function () {
    expect(clampAnchor(0.5, 0.5, O)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('★ 横向能一直拖到只剩落脚点在屏幕里（角色可以挂一半在外面）', function () {
    const left = clampAnchor(-5, 0.5, O);
    const right = clampAnchor(5, 0.5, O);
    expect(left.x * O.vw).toBeCloseTo(6, 1);
    expect(right.x * O.vw).toBeCloseTo(354, 1);
  });

  it('★ 纵向活动范围接近整个可用高度，不再被角色身高吃掉', function () {
    const top = clampAnchor(0.5, -5, O);
    const bottom = clampAnchor(0.5, 5, O);
    expect(top.y * O.vh).toBeCloseTo(106, 1);
    expect(bottom.y * O.vh).toBeCloseTo(694, 1);
    /* 活动余地 > 500px：旧规则下只有 760-100-60-140-12 = 448px */
    expect(bottom.y * O.vh - top.y * O.vh).toBeGreaterThan(500);
  });

  it('上边界是顶栏下沿（不再往下让出整个身高）', function () {
    /* 锚点 106 就在顶栏下沿多一点 —— 角色本体可以钻到顶栏上面去 */
    expect(clampAnchor(0.5, 0, O).y * O.vh).toBeCloseTo(106, 1);
  });

  it('下边界是标签栏上沿', function () {
    expect(clampAnchor(0.5, 1, O).y * O.vh).toBeCloseTo(694, 1);
  });

  it('留出贴边余量，免得手指按不住', function () {
    expect(clampAnchor(0, 0, O).x * O.vw).toBeCloseTo(6, 1);
  });

  it('可用区域退化时居中，而不是把坐标算成 NaN', function () {
    const tiny = { vw: 8, vh: 8, insets: { top: 100, bottom: 100 }, edge: 6 };
    const c = clampAnchor(0.5, 0.5, tiny);
    expect(isFinite(c.x)).toBe(true);
    expect(isFinite(c.y)).toBe(true);
  });

  it('归一化输入输出：同一比例在任何视口下都落到同一相对位置', function () {
    const small = clampAnchor(0.5, 0.5, { vw: 320, vh: 660, insets: { top: 92, bottom: 54 }, edge: 6 });
    const big = clampAnchor(0.5, 0.5, { vw: 430, vh: 900, insets: { top: 110, bottom: 70 }, edge: 6 });
    expect(small.x).toBeCloseTo(big.x, 3);
    expect(small.y).toBeCloseTo(big.y, 3);
  });

  it('越界值一律收回，绝不会变成 NaN 或负数', function () {
    for (const v of [-99, -1, 0, 1, 99, NaN, Infinity]) {
      const c = clampAnchor(v, v, O);
      expect(isFinite(c.x)).toBe(true);
      expect(isFinite(c.y)).toBe(true);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(1);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(1);
    }
  });

  it('钳制是幂等的（不会来回抖）', function () {
    const once = clampAnchor(0.97, 0.02, O);
    const twice = clampAnchor(once.x, once.y, O);
    expect(twice.x).toBeCloseTo(once.x, 6);
    expect(twice.y).toBeCloseTo(once.y, 6);
  });
});

describe('走动的落点区间（不越过边界 · 不离家太远）', function () {
  it('站在中间：区间由"离家的最大偏离"封顶', function () {
    const room = walkRoom(180, 0, 360, 6, 60);
    expect(room).toEqual({ lo: -60, hi: 60 });
  });

  it('★ 贴着右边站：只能往左走（右侧剩余空间比 maxDrift 更紧）', function () {
    const room = walkRoom(340, 0, 360, 6, 60);
    expect(room!.hi).toBe(14);      /* 360−6−340 */
    expect(room!.lo).toBe(-60);
  });

  it('★ 贴着左边站：只能往右走', function () {
    const room = walkRoom(20, 0, 360, 6, 60);
    expect(room!.lo).toBe(-14);     /* 6−20 与 −60 取大 */
    expect(room!.hi).toBe(60);
  });

  it('★ 从任意站位出发，落点都不会越界、也不会离家超限', function () {
    const vw = 360, edge = 6, maxDrift = 60;
    for (let ax = edge; ax <= vw - edge; ax += 7) {
      const room = walkRoom(ax, 0, vw, edge, maxDrift);
      expect(room).not.toBeNull();
      for (const d of [room!.lo, room!.hi, 0, room!.lo / 2, room!.hi / 2]) {
        /* 锚点留在可用区域里 */
        expect(ax + d).toBeGreaterThanOrEqual(edge - 0.001);
        expect(ax + d).toBeLessThanOrEqual(vw - edge + 0.001);
        /* 也不离家太远 */
        expect(Math.abs(d)).toBeLessThanOrEqual(maxDrift + 0.001);
      }
    }
  });

  it('贴着边站**不算**没地方 —— 另一边还有很宽的路可以走', function () {
    /* 靠左边：不能再往左（只剩 6px），但往右有 60px */
    expect(walkRoom(12, 0, 360, 6, 60)).toEqual({ lo: -6, hi: 60 });
    /* 靠右边同理 */
    expect(walkRoom(357, 0, 360, 6, 60)).toEqual({ lo: -60, hi: -3 });
  });

  it('真的没地方走时返回 null（调用方就干脆不让它走）', function () {
    /* 视口只比两侧余量宽一点点：哪儿都去不了 */
    expect(walkRoom(10, 0, 19, 6, 60)).toBeNull();
    /* 明确不允许偏离（maxDrift = 0）时也不走 */
    expect(walkRoom(180, 0, 360, 6, 0)).toBeNull();
  });

  it('脏数据一律返回 null，不返回 NaN 区间', function () {
    expect(walkRoom(NaN, 0, 360, 6, 60)).toBeNull();
    expect(walkRoom(180, 0, NaN, 6, 60)).toBeNull();
    expect(walkRoom(180, 0, 0, 6, 60)).toBeNull();
    expect(walkRoom(180, 0, 360, 6, NaN)).toBeNull();
  });
});

describe('走动这一步怎么走', function () {
  const room = { lo: -60, hi: 60 };
  const rng = function (v: number) { return function () { return v; }; };

  it('落在区间内，朝向与位移符号一致', function () {
    const p = planWalkStep(room, 0, 34, 72, { min: 9, max: 14 }, rng(0.9));
    expect(p).not.toBeNull();
    expect(p!.to).toBeGreaterThanOrEqual(room.lo);
    expect(p!.to).toBeLessThanOrEqual(room.hi);
    expect(p!.dir).toBe(p!.to >= 0 ? 1 : -1);
  });

  it('★ 已经偏到一边时会往回走（不会一路走出去）', function () {
    /* 随机数固定为 0.9（本来会往右），但 drift 已经 +50 —— 应当改往左 */
    const p = planWalkStep(room, 50, 34, 72, { min: 9, max: 14 }, rng(0.9));
    expect(p!.dir).toBe(-1);
    expect(p!.to).toBeLessThan(50);
  });

  it('★ 走到区间端点时还能往回走（不会卡死在边上）', function () {
    const p = planWalkStep(room, 60, 34, 72, { min: 9, max: 14 }, rng(0.9));
    expect(p).not.toBeNull();
    expect(p!.dir).toBe(-1);
    expect(p!.to).toBeLessThanOrEqual(60);
  });

  it('★ 时长由距离和速度算出来，而且一定能在动作窗口里走完', function () {
    /*
     * 这一条钉的是「迈了半天还在原地」那个毛病：以前距离与时长是两个独立的随机数
     * （24–72px、11–20 秒），而微动作窗口只有 5–9 秒 —— 每一趟都在半路被打断，
     * 有效速度只剩 2–4 px/s。现在给的是速度，时长 = 距离 ÷ 速度。
     */
    const speed = { min: 9, max: 14 };
    for (let i = 0; i <= 10; i++) {
      const p = planWalkStep(room, 0, 34, 72, speed, rng(i / 10))!;
      const dist = Math.abs(p.to);
      const realSpeed = dist / (p.ms / 1000);
      expect(realSpeed).toBeGreaterThanOrEqual(speed.min - 1.5);
      expect(realSpeed).toBeLessThanOrEqual(speed.max + 1.5);
      /* 而且不会拖到动作窗口（4500–10000ms）之外 */
      expect(p.ms).toBeLessThanOrEqual(10000);
    }
  });

  it('步长不会超过剩余空间', function () {
    const tight = { lo: 0, hi: 30 };
    const p = planWalkStep(tight, 0, 34, 72, { min: 9, max: 14 }, rng(0.9));
    expect(p!.to).toBeLessThanOrEqual(30);
  });

  it('剩不下 8px 就不走了', function () {
    expect(planWalkStep({ lo: 0, hi: 5 }, 0, 34, 72, { min: 9, max: 14 }, rng(0.5))).toBeNull();
  });

  it('drift 落在区间外时先收回区间内（脏数据兜底）', function () {
    const p = planWalkStep(room, 999, 34, 72, { min: 9, max: 14 }, rng(0.5));
    expect(p).not.toBeNull();
    expect(p!.to).toBeLessThanOrEqual(room.hi);
  });
});

describe('位置是否需要纠正', function () {
  it('合法位置不用动', function () {
    expect(isInside(0.5, 0.5, O)).toBe(true);
  });

  it('★ 落在屏幕外的锚点会被收回来（这条是"角色找不回来"的保险）', function () {
    expect(isInside(1.4, 0.5, O)).toBe(false);
    expect(isInside(0.5, -0.3, O)).toBe(false);
    const fixed = clampAnchor(1.4, -0.3, O);
    expect(fixed.x).toBeLessThanOrEqual(1);
    expect(fixed.y).toBeGreaterThan(0);
  });

  it('刚好贴在合法边界上算合法', function () {
    const c = clampAnchor(0, 0, O);
    expect(isInside(c.x, c.y, O)).toBe(true);
  });
});
