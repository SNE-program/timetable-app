import type { TimetableData } from '../core/types';
import type { Theme } from '../theme/tokens';

/**
 * 变更集（ChangeSet）与撤销栈。
 *
 * 计划书 7.1 节把 change_set 表设计成「审计与撤销（AI / 导入 / 插件共用）」。
 * 这里是它在纯前端形态下的落地：**快照式**而不是操作式。
 *
 * ## 快照里装的是「一整份用户能看到的东西」，不只是课表
 *
 * v1.9.4 之前快照只有 `TimetableData`，于是「从云端恢复」这种一次改好几样东西的操作
 * 撤不干净：课表退回去了，外观还是云端那份 —— 用户看到的是「半还原」，比不能撤销更难受。
 * 所以快照现在是 `{ data, theme }`（外加整份文档级操作才带的 prefs）。
 * 因为所有改动都走 Object.assign 造新对象，没变的那些部分在快照之间是**共享引用**，
 * 多存一份外观几乎不额外占内存。
 *
 * ## 合并（coalesce）
 *
 * 滑块拖动、连点考勤这类操作一秒能触发几十次。每次记一笔的话，撤销栈立刻被同一件事塞满，
 * 真正想撤的那一步反而找不着。所以 `coalesceKey` 相同的连续改动会**合进上一条**：
 * 保留最初的 before、不断更新 after —— 撤销时一步退回「开始拖之前」。
 *
 * **栈只存在内存里**，不落 localStorage：跨重启的撤销历史收益很小，
 * 而把它写进磁盘会让每次编辑都多一份全量序列化。
 */

export type ChangeSource = 'user' | 'import' | 'ai' | 'plugin';

/** 一次改动涉及的全部内容 */
export interface ChangeSnapshot {
  data: TimetableData;
  theme: Theme;
  /** 只有「整份文档」级的操作（云端恢复 / 备份导入）才带它 */
  prefs?: Record<string, unknown>;
}

export interface ChangeSet {
  id: string;
  /** 给人看的短标签，撤销时显示「已撤销：调课」 */
  label: string;
  source: ChangeSource;
  at: number;
  before: ChangeSnapshot;
  after: ChangeSnapshot;
  /** 合并用的键：相同的连续改动会并成一条（见文件开头） */
  coalesceKey?: string;
}

/** 栈深度上限。40 步足够覆盖「刚才手滑了」，也不会让内存无限涨 */
const MAX_DEPTH = 40;
/** 同一件事的多长时间内算「还在连续操作」 */
const COALESCE_MS = 4000;

let undoStack: ChangeSet[] = [];
let redoStack: ChangeSet[] = [];
let seq = 0;

export function recordChange(
  label: string, source: ChangeSource, before: ChangeSnapshot, after: ChangeSnapshot,
  coalesceKey?: string
): ChangeSet {
  const now = Date.now();
  const top = undoStack[undoStack.length - 1];
  /*
   * 合并：同一个键、同一类操作、而且就在刚刚 —— 更新上一条的 after。
   * before 保持不动，于是撤销是「退回最开始」，而不是退回上一次微调。
   */
  if (
    top && coalesceKey && top.coalesceKey === coalesceKey
    && top.label === label && now - top.at <= COALESCE_MS
  ) {
    top.after = after;
    top.at = now;
    redoStack = [];
    return top;
  }
  seq += 1;
  const set: ChangeSet = {
    id: 'cs' + seq + '-' + now,
    label: label,
    source: source,
    at: now,
    before: before,
    after: after,
    coalesceKey: coalesceKey,
  };
  undoStack.push(set);
  if (undoStack.length > MAX_DEPTH) undoStack.shift();
  /* 新的改动会让原来的重做分支失效 —— 这是所有编辑器的通行语义 */
  redoStack = [];
  return set;
}

export function undoSize(): number { return undoStack.length; }
export function redoSize(): number { return redoStack.length; }

/** 栈顶那一笔（界面用它显示「将撤销：调课」） */
export function peekUndo(): ChangeSet | null {
  return undoStack.length ? undoStack[undoStack.length - 1] : null;
}

export interface ChangeBrief { id: string; label: string; at: number; source: ChangeSource; }

/**
 * 最近几步的**摘要**（不含快照）。
 *
 * 历史面板只需要这些 —— 把整份快照递出去，界面就能不小心改坏它。
 */
export function recentChanges(limit: number): ChangeBrief[] {
  const out: ChangeBrief[] = [];
  for (let i = undoStack.length - 1; i >= 0 && out.length < limit; i--) {
    const c = undoStack[i];
    out.push({ id: c.id, label: c.label, at: c.at, source: c.source });
  }
  return out;
}

export function redoBriefs(limit: number): ChangeBrief[] {
  const out: ChangeBrief[] = [];
  for (let i = redoStack.length - 1; i >= 0 && out.length < limit; i--) {
    const c = redoStack[i];
    out.push({ id: c.id, label: c.label, at: c.at, source: c.source });
  }
  return out;
}

export function popUndo(): ChangeSet | null {
  const c = undoStack.pop();
  return c || null;
}

export function popRedo(): ChangeSet | null {
  const c = redoStack.pop();
  return c || null;
}

export function pushUndo(set: ChangeSet): void {
  undoStack.push(set);
  if (undoStack.length > MAX_DEPTH) undoStack.shift();
}

export function pushRedo(set: ChangeSet): void {
  redoStack.push(set);
}

/** 清空全部历史（导入、重置这类「换了一份数据」的场景） */
export function resetHistory(): void {
  undoStack = [];
  redoStack = [];
}
