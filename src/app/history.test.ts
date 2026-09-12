import { beforeEach, describe, expect, it } from 'vitest';
import {
  popRedo, popUndo, pushRedo, pushUndo, recordChange, redoSize, resetHistory, undoSize,
} from './history';
import type { TimetableData } from '../core/types';

/** 快照本身是什么内容不重要，这里只验证栈的语义 */
function snap(tag: string): TimetableData {
  return { tag: tag } as unknown as TimetableData;
}

describe('变更集历史栈', function () {
  beforeEach(function () {
    resetHistory();
  });

  it('记录一笔之后可以撤销', function () {
    expect(undoSize()).toBe(0);
    const c = recordChange('调课', 'user', snap('before'), snap('after'));
    expect(undoSize()).toBe(1);
    expect(c.label).toBe('调课');
    expect(c.source).toBe('user');
    expect((c.before as unknown as { tag: string }).tag).toBe('before');
    expect((c.after as unknown as { tag: string }).tag).toBe('after');
    expect(popUndo()!.id).toBe(c.id);
    expect(undoSize()).toBe(0);
  });

  it('新的改动会清掉重做分支', function () {
    const a = recordChange('添加课程', 'user', snap('0'), snap('1'));
    popUndo();
    pushRedo(a);
    expect(redoSize()).toBe(1);
    recordChange('删除课程', 'user', snap('0'), snap('2'));
    expect(redoSize()).toBe(0);
  });

  it('撤销再重做能回到原样（栈语义闭环）', function () {
    const a = recordChange('A', 'user', snap('v0'), snap('v1'));
    const b = recordChange('B', 'user', snap('v1'), snap('v2'));
    /* 撤销两步 */
    const s1 = popUndo()!; expect(s1.id).toBe(b.id); pushRedo(s1);
    const s2 = popUndo()!; expect(s2.id).toBe(a.id); pushRedo(s2);
    expect(undoSize()).toBe(0);
    expect(redoSize()).toBe(2);
    /* 重做两步 */
    const r1 = popRedo()!; expect(r1.id).toBe(a.id); pushUndo(r1);
    const r2 = popRedo()!; expect(r2.id).toBe(b.id); pushUndo(r2);
    expect(undoSize()).toBe(2);
    expect(redoSize()).toBe(0);
  });

  it('深度封顶，不会无限增长', function () {
    for (let i = 0; i < 60; i++) recordChange('第 ' + i + ' 步', 'user', snap('a'), snap('b'));
    expect(undoSize()).toBe(40);
    /* 留下的是最近的那批，最早那步已经被挤出去 */
    let last = popUndo()!;
    expect(last.label).toBe('第 59 步');
    let n = 1;
    while (popUndo()) n++;
    expect(n).toBe(40);
  });

  it('空栈上撤销/重做返回 null，不会崩', function () {
    expect(popUndo()).toBeNull();
    expect(popRedo()).toBeNull();
  });

  it('导入来源会被记下来，便于将来区分 AI / 插件', function () {
    const c = recordChange('导入课表', 'import', snap('a'), snap('b'));
    expect(c.source).toBe('import');
  });
});
