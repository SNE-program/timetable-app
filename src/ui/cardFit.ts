import type { ConcreteEvent } from '../core/types';

/**
 * 卡片里"放得下什么"的计算。
 *
 * ## 为什么要有它
 *
 * 课表卡片的宽度是**天数决定的**：一周 7 天时，320px 的屏上每张卡只有 30 多像素。
 * 那时候：
 *
 *   - 用省略号 → "实验楼 C101" 变成"实…"，信息量为零（用户反馈"大量文字被截断"）；
 *   - 让它折行 → 变成"实验"\n"楼"这种碎片，比省略号更难看。
 *
 * 真正的问题不是"怎么截断好看"，而是**这么窄的地方根本不该放这一行**。
 * 所以这里算：这一行值不值得显示、显示完整名字还是短名字（去掉楼名前缀）。
 * 宁可少显示一行，也不要显示一行看不懂的碎片。
 *
 * 纯函数，有单测（cardFit.test.ts）—— 判据必须是可验的，否则每次调样式都要靠肉眼猜。
 */

/** 一个字符大约多宽：中日韩字符按一个字宽算，其余按半个字宽（够准了，不需要精确排版引擎） */
export function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? fontSize : fontSize * 0.56;
  }
  return w;
}

/** 取地点里最有辨识度的一段："实验楼 C101" → "C101"（楼名在窄卡上没有价值） */
export function shortRoom(location: string): string {
  const parts = location.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : location.trim();
}

export interface FitResult {
  /** 实际显示的文字；空串表示"这一行不要放" */
  text: string;
  /** 是否显示的是完整名称（false 表示用了短名字） */
  full: boolean;
}

/**
 * 在 avail 像素里放一行文字。
 *
 * 优先级：完整名字 → 短名字 → 不放（返回空串）。
 * 字号按 11px 传进来（卡片上辅助行的字号）。
 */
export function fitLine(text: string, avail: number, fontSize: number, shorten?: (s: string) => string): FitResult {
  const clean = (text || '').trim();
  if (!clean || avail <= 0) return { text: '', full: false };
  if (textWidth(clean, fontSize) <= avail) return { text: clean, full: true };
  const short = shorten ? shorten(clean) : '';
  if (short && short !== clean && textWidth(short, fontSize) <= avail) return { text: short, full: false };
  return { text: '', full: false };
}

/** 卡片里文字部分的可用宽度：卡片宽 − 左右内边距（8px） */
export function cardTextWidth(colWidth: number): number {
  return Math.max(0, colWidth - 10);
}

/** 卡片上辅助信息（教室 / 教师）显示什么 */
export function fitCardMeta(e: ConcreteEvent, colWidth: number, fontSize: number): {
  room: FitResult; teacher: FitResult;
} {
  const avail = cardTextWidth(colWidth);
  const room = fitLine(e.location || e.building || '', avail, fontSize, shortRoom);
  const teacher = fitLine(e.teacher || '', avail, fontSize);
  return { room: room, teacher: teacher };
}