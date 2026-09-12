/**
 * 角色的摆放计算。
 *
 * ## 为什么单独抽出来
 *
 * "能拖到哪"这件事比看上去复杂：屏幕上真正可用的区域不是整个视口，
 * 而是**顶栏下沿到底部标签栏上沿之间**那块 —— 上面的状态栏、下面的手势条
 * 和标签栏都不该被角色压住。而这些高度在真机上是变的
 * （安全区、横屏、分屏），所以不能写死常量，要按实测的 DOM 矩形算。
 *
 * 抽成纯函数是为了能单测：**"拖到屏幕外找不回来"是最烦人的一类 bug**，
 * 而它完全可以靠几个边界用例钉死。
 */

export interface Insets {
  /** 顶部不可用高度（状态栏 + 顶栏） */
  top: number;
  /** 底部不可用高度（标签栏 + 手势条） */
  bottom: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/**
 * 锚点是角色**底部中心**。
 *
 * 注意：这里**不再需要角色的宽高** —— 判据是「锚点落在可用区域内」，
 * 不是「整个角色都落在可用区域内」。角色的尺寸只影响它自己挂出去多少，
 * 不影响能不能拖到那里。见 clampAnchor 的说明。
 */
export interface AnchorOpts {
  vw: number;
  vh: number;
  insets: Insets;
  /**
   * 贴边余量：锚点离可用区域边缘至少留这么多像素。
   * 不留的话，锚点正好压在边缘上时手指不好按住（也容易被手势条吃掉）。
   */
  edge: number;
}

export interface Anchor {
  x: number;
  y: number;
}

/** 当前的可用纵向范围（像素）。上下都被挤满时返回一个退化的区间，由 clamp 兜底 */
export function usableRange(vh: number, insets: Insets): { top: number; bottom: number } {
  const top = Math.max(0, insets.top);
  const bottom = Math.min(vh, vh - Math.max(0, insets.bottom));
  return bottom > top ? { top: top, bottom: bottom } : { top: 0, bottom: vh };
}

/**
 * 把一个归一化锚点收进**可用区域**。
 *
 * ## 判据放宽过一次，这里记清楚
 *
 * 原来要求「整个角色都在区域内」：左右各让出半个身位、上下各让出整个身高 ——
 * 结果可拖动的范围小得可怜（一只 140px 高的角色，在 660px 的可用高度里
 * 只剩三百多像素的活动余地，左右更是被挤到中间一小条）。用户的原话是
 * 「可以移动的范围太小了」。
 *
 * 现在只要求**锚点（落脚点）在区域内**：角色可以一半挂在屏幕外，
 * 左右能一直拖到只剩落脚点在里面，上边能钻到顶栏上面，下边能贴到标签栏上沿。
 * 拖出边界也没关系 —— 锚点还在，就一定拖得回来。
 *
 * 返回的仍然是归一化坐标（存盘用的就是它），而不是像素 ——
 * 换设备、转屏之后像素坐标可能刚好落在屏幕外，归一化坐标配合这里重新钳制，
 * 最坏情况只是位置变一下，**不会消失**。
 */
export function clampAnchor(x: number, y: number, o: AnchorOpts): Anchor {
  const range = usableRange(o.vh, o.insets);
  const edge = Math.max(0, o.edge);

  const px = clampPx(x * o.vw, edge, o.vw - edge, o.vw / 2);
  const py = clampPx(y * o.vh, range.top + edge, range.bottom - edge, (range.top + range.bottom) / 2);

  return { x: px / o.vw, y: py / o.vh };
}

/**
 * 钳一个像素值。两种兜底都返回 fallback（居中）：
 *   1. 坐标本身是脏数据（NaN / Infinity）—— 宁可回到屏幕中间，也不要算出一个 NaN；
 *   2. 区间退化（可用区域比两边余量还小，例如极小的分屏窗口）。
 */
function clampPx(v: number, lo: number, hi: number, fallback: number): number {
  if (!isFinite(v)) return fallback;
  if (!(hi > lo)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 走动时"落脚点"允许落在哪一段（相对**家**的位移，单位 px）。
 *
 * ## 模型：家 + 漂移
 *
 * 家（home）是用户放它的地方，**只有拖动才会变**；走动是在家附近**漂移**，
 * 走完不一定回到原点 —— 允许偏离原位（用户明确要的），因为速度慢、偏移小，
 * 手动拖回来很容易。所以这里给的不是"半径"，而是一段**允许的漂移区间**：
 *
 *     下限 = max(左边剩余空间, −maxDrift)      （负值，往左）
 *     上限 = min(右边剩余空间, +maxDrift)      （正值，往右）
 *
 * 两个约束同时成立：
 *   1. **不越过边界**：锚点全程留在 [edge, viewW − edge] 内；
 *   2. **不离家太远**：不超过 maxDrift（默认给 1.5 个身位左右），
 *      否则它会在几小时内随机游走到屏幕边缘定居。
 *
 * 区间太窄（< 8px）时返回 null：那点位移看起来像抖动，不像走路，
 * 调用方应当干脆不让它走（状态机那边会把 walk 的权重清零）。
 */
export interface WalkRoom {
  lo: number;
  hi: number;
}

export function walkRoom(homeX: number, drift: number, viewW: number, edge: number, maxDrift: number): WalkRoom | null {
  const e = Math.max(0, edge);
  const cap = Math.max(0, isFinite(maxDrift) ? maxDrift : 0);
  if (!isFinite(homeX) || !isFinite(viewW) || viewW <= 0) return null;
  /* 锚点能落在的绝对范围 → 换算成相对家的位移 */
  const lo = Math.max(e - homeX, -cap);
  const hi = Math.min(viewW - e - homeX, cap);
  if (!isFinite(lo) || !isFinite(hi)) return null;
  if (hi - lo < 8) return null;
  /* 当前漂移已经贴到边界时，仍然返回区间（调用方只会在区间内选目标） */
  return { lo: Math.round(lo), hi: Math.round(hi) };
}

/**
 * 这一趟往哪走、走多远、走多久 —— 纯函数，随机源注入。
 *
 * 方向带一点**回归**倾向：已经偏到一边（|drift| > 24px）时更可能往回走，
 * 于是它会在家附近来回逛，而不是一路走出去。
 *
 * ## 时长由距离和速度算出来，不再独立掷
 *
 * 原来"走多远"和"走多久"是两个独立的随机数（24–72px、11–20 秒），
 * 而微动作窗口只有 5–9 秒 —— 于是每一趟都在半路被打断：**步子的速度只有 2–4 px/s，
 * 迈了半天几乎还在原地**（用户的原话）。现在给的是**速度**（px/s），
 * 时长 = 距离 ÷ 速度，并且夹在 `[minMs, maxMs]` 内 ——
 * 这一趟一定能在动作窗口里走完。
 */
export function planWalkStep(
  room: WalkRoom, drift: number, minStep: number, maxStep: number,
  speed: { min: number; max: number }, rng: () => number,
  /** 时长的硬边界：默认 [1200, 9500]，后者要留在 walk 那个微动作窗口内 */
  msRange?: { min: number; max: number }
): { to: number; ms: number; dir: 1 | -1 } | null {
  const from = Math.min(room.hi, Math.max(room.lo, drift));
  const roomLeft = from - room.lo;
  const roomRight = room.hi - from;
  if (roomLeft < 8 && roomRight < 8) return null;

  let dir: 1 | -1;
  if (drift > 24 && roomLeft >= 8) dir = -1;          /* 偏右了，往回走 */
  else if (drift < -24 && roomRight >= 8) dir = 1;    /* 偏左了，往回走 */
  else if (roomLeft < 8) dir = 1;                     /* 左边没地方 */
  else if (roomRight < 8) dir = -1;                   /* 右边没地方 */
  else dir = rng() < 0.5 ? -1 : 1;

  const avail = dir === 1 ? roomRight : roomLeft;
  const want = minStep + Math.max(0, Math.min(1, rng())) * (maxStep - minStep);
  const step = Math.min(avail, want);
  if (step < 8) return null;

  const to = Math.round(from + dir * step);
  /*
   * 速度取区间内的随机值 → 时长 = 距离 ÷ 速度。
   * 上下界是"别瞬移、也别把一趟拖到下个世纪"的兜底。
   */
  const lo = msRange && isFinite(msRange.min) ? Math.max(200, msRange.min) : 1200;
  const hi = msRange && isFinite(msRange.max) ? Math.max(lo + 100, msRange.max) : 9500;
  const pxPerSec = Math.max(1, speed.min + Math.max(0, Math.min(1, rng())) * Math.max(0, speed.max - speed.min));
  const ms = Math.round(Math.min(hi, Math.max(lo, step / pxPerSec * 1000)));
  return { to: to, ms: ms, dir: dir };
}

/** 这个位置是否已经在可用区域内（用来判断「要不要纠正」） */
export function isInside(x: number, y: number, o: AnchorOpts): boolean {
  const c = clampAnchor(x, y, o);
  return Math.abs(c.x - x) < 0.001 && Math.abs(c.y - y) < 0.001;
}
