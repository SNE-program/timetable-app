import type { TimetableData } from '../core/types';

/**
 * 变更集（ChangeSet）与撤销栈。
 *
 * 计划书 7.1 节把 change_set 表设计成"审计与撤销（AI / 导入 / 插件共用）"，
 * core 的对外 API 里也有 `applyChangeSet(set): { result, undo }`。
 * 这里是它在纯前端形态下的落地：**快照式**而不是操作式。
 *
 * 为什么用快照而不是 op 列表：课表数据本来就是一棵小树（几十门课、几百个时段，
 * JSON 几十 KB），而且所有改动都走 `Object.assign` 造新对象 —— 结构共享意味着
 * 一份快照几乎不额外占内存。op 列表看着优雅，但每一种操作都要写正反两套逻辑，
 * 漏一个分支就会把数据改坏。快照没有这个风险。
 *
 * **栈只存在内存里**，不落 localStorage：跨重启的撤销历史收益很小，
 * 而把它写进磁盘会让每次编辑都多一份全量序列化。
 */

export type ChangeSource = 'user' | 'import' | 'ai' | 'plugin';

export interface ChangeSet {
  id: string;
  /** 给人看的短标签，撤销时显示「已撤销：调课」 */
  label: string;
  source: ChangeSource;
  at: number;
  before: TimetableData;
  after: TimetableData;
}

/** 栈深度上限。40 步足够覆盖"刚才手滑了"，也不会让内存无限涨 */
const MAX_DEPTH = 40;

let undoStack: ChangeSet[] = [];
let redoStack: ChangeSet[] = [];
let seq = 0;

export function recordChange(label: string, source: ChangeSource, before: TimetableData, after: TimetableData): ChangeSet {
  seq += 1;
  const set: ChangeSet = {
    id: 'cs' + seq + '-' + Date.now(),
    label: label,
    source: source,
    at: Date.now(),
    before: before,
    after: after,
  };
  undoStack.push(set);
  if (undoStack.length > MAX_DEPTH) undoStack.shift();
  /* 新的改动会让原来的重做分支失效 —— 这是所有编辑器的通行语义 */
  redoStack = [];
  return set;
}

export function undoSize(): number { return undoStack.length; }
export function redoSize(): number { return redoStack.length; }

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

/** 清空全部历史（导入、重置这类"换了一份数据"的场景） */
export function resetHistory(): void {
  undoStack = [];
  redoStack = [];
}
