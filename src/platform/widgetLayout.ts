import type { WidgetItem, WidgetPayload } from './widget';

/**
 * 小组件"在某个尺寸下会显示成什么样"。
 *
 * ## 为什么这段逻辑在 Web 层
 *
 * 桌面上的排版由原生侧做（那是唯一能画到桌面的地方），但**应用里要能预览**：
 * 用户在选择器里看到一个空白方块、拖到桌面又不知道拉大之后会怎样，
 * 于是就有了"这个组件没有任何用处"这种判断。所以：
 *
 *   - 应用内按这套判据画出**尺寸预览**（2×2 / 2×3 / 4×2 / 4×3 各长什么样）；
 *   - 判据本身是纯函数，能单测（原生那份没法在这里测）。
 *
 * 原生侧的同一套常数在 `android/.../widget/WidgetSize.java`，两边的注释互相指着对方。
 * **改这里就要改那里**，否则预览会变成骗人的东西 —— 这一条写在两边的文件里。
 */
export type WidgetKind = 'timetable' | 'next';

/** 一个桌面格子的长度（dp）；系统自己的换算是 (dp + 30) / 70 */
const CELL = 70;
const GUTTER = 30;

/* 与 WidgetSize.java 一一对应的四个常数 */
/** 宽组件固定部分：内边距 + 学期行 + 下一节那一块 + 分隔线 */
const FIXED_TALL = 72;
/** 宽组件每一行课的高度 */
const ROW_TALL = 18;
/** 小组件头部（倒计时那一大块）的高度 */
const FIXED_SMALL = 96;
/** 小组件每多一行课的高度 */
const ROW_SMALL = 20;
/** 窄于这个宽度就摆不下「时间 + 课程名 + 地点」三列 */
const NARROW_DP = 230;

export interface WidgetPlan {
  widthDp: number;
  heightDp: number;
  /** 估算的格数（给界面显示"2×3"用） */
  cols: number;
  rows: number;
  /** 窄到要把地点那列收起来 */
  narrow: boolean;
  /** 能列几行课（宽组件） */
  listRows: number;
  /** 拉高之后能补几行（小组件） */
  extraRows: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v);
}

/** 格数 → dp（系统的换算反过来用） */
export function cellsToDp(cells: number): number {
  return cells * CELL - GUTTER;
}

/**
 * 某个尺寸下的排版计划。
 *
 * 行数是**按桌面给的 dp 算的**，不是写死的：矮了硬塞会被裁掉 ——
 * 那正是"只显示了一节课"和"看着像空白"的来源。
 */
export function widgetPlan(widthDp: number, heightDp: number, kind: WidgetKind): WidgetPlan {
  const w = Math.max(60, Math.round(widthDp));
  const h = Math.max(60, Math.round(heightDp));
  const maxRows = kind === 'timetable' ? 3 : 2;
  return {
    widthDp: w,
    heightDp: h,
    cols: Math.max(1, Math.round((w + GUTTER) / CELL)),
    rows: Math.max(1, Math.round((h + GUTTER) / CELL)),
    narrow: w < NARROW_DP,
    listRows: kind === 'timetable' ? clamp(Math.floor((h - FIXED_TALL) / ROW_TALL), 0, maxRows) : 0,
    extraRows: kind === 'next' ? clamp(Math.floor((h - FIXED_SMALL) / ROW_SMALL), 0, maxRows) : 0,
  };
}

/** 界面上列出来的几个尺寸（按格数），预览与自检都用它 */
export const WIDGET_PRESETS: { kind: WidgetKind; cols: number; rows: number; label: string; note: string }[] = [
  { kind: 'next', cols: 2, rows: 2, label: '2×2', note: '下一节课 + 倒计时' },
  { kind: 'next', cols: 2, rows: 3, label: '2×3', note: '上面再加两节课' },
  { kind: 'timetable', cols: 4, rows: 2, label: '4×2', note: '下一节 + 两节课' },
  { kind: 'timetable', cols: 4, rows: 3, label: '4×3', note: '下一节 + 三节课' },
];

export function planForPreset(p: { kind: WidgetKind; cols: number; rows: number }): WidgetPlan {
  return widgetPlan(cellsToDp(p.cols), cellsToDp(p.rows), p.kind);
}

/** 预览里要显示的那几行（与原生侧"今天剩下的课 / 接下来的课"同一套取法） */
export function previewRows(payload: WidgetPayload, nowMs: number, limit: number): {
  next: WidgetItem | null;
  rows: WidgetItem[];
  mode: 'today' | 'upcoming';
} {
  const next = payload.upcoming.filter(function (it) { return it.endMs > nowMs; })[0]
    || payload.today.filter(function (it) { return it.endMs > nowMs; })[0]
    || null;
  /* 数据是今天的就列今天剩下的，过期了就列接下来的（与原生侧 isFresh 的判断一致） */
  const fresh = payload.todayIso === toIso(new Date(nowMs));
  const pool = fresh ? payload.today : payload.upcoming;
  const rows = pool.filter(function (it) { return it.endMs > nowMs; });
  const rest = next ? rows.filter(function (it) { return !(it.startMs === next.startMs && it.title === next.title); }) : rows;
  return { next: next, rows: rest.slice(0, limit), mode: fresh ? 'today' : 'upcoming' };
}

function toIso(d: Date): string {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
