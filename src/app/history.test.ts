import { beforeEach, describe, expect, it } from 'vitest';
import {
  peekUndo, popRedo, popUndo, pushRedo, pushUndo, recentChanges, recordChange, redoBriefs, redoSize,
  resetHistory, undoSize, type ChangeSnapshot,
} from './history';

/** 快照本身是什么内容不重要，这里只验证栈的语义 */
function snap(tag: string): ChangeSnapshot {
  return { data: { tag: tag } as never, theme: { tag: tag } as never };
}

function tagOf(s: ChangeSnapshot): string {
  return (s.data as unknown as { tag: string }).tag;
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
    expect(tagOf(c.before)).toBe('before');
    expect(tagOf(c.after)).toBe('after');
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
    const s1 = popUndo()!; expect(s1.id).toBe(b.id); pushRedo(s1);
    const s2 = popUndo()!; expect(s2.id).toBe(a.id); pushRedo(s2);
    expect(undoSize()).toBe(0);
    expect(redoSize()).toBe(2);
    const r1 = popRedo()!; expect(r1.id).toBe(a.id); pushUndo(r1);
    const r2 = popRedo()!; expect(r2.id).toBe(b.id); pushUndo(r2);
    expect(undoSize()).toBe(2);
    expect(redoSize()).toBe(0);
  });

  it('深度封顶，不会无限增长', function () {
    for (let i = 0; i < 60; i++) recordChange('第 ' + i + ' 步', 'user', snap('a'), snap('b'));
    expect(undoSize()).toBe(40);
    const last = popUndo()!;
    expect(last.label).toBe('第 59 步');
    let n = 1;
    while (popUndo()) n++;
    expect(n).toBe(40);
  });

  it('空栈上撤销/重做返回 null，不会崩', function () {
    expect(popUndo()).toBeNull();
    expect(popRedo()).toBeNull();
    expect(peekUndo()).toBeNull();
  });

  it('导入来源会被记下来，便于将来区分 AI / 插件', function () {
    const c = recordChange('导入课表', 'import', snap('a'), snap('b'));
    expect(c.source).toBe('import');
  });

  it('★ 同一个 key 的连续改动会合并成一步（滑块拖动不塞满撤销栈）', function () {
    const first = recordChange('调外观', 'user', snap('原始'), snap('中间'), 'theme:radius');
    const second = recordChange('调外观', 'user', snap('中间'), snap('最终'), 'theme:radius');
    expect(undoSize()).toBe(1);
    expect(second.id).toBe(first.id);
    /* 合并时 before 不动、after 跟着走：撤销一步退回「开始拖之前」 */
    const top = peekUndo()!;
    expect(tagOf(top.before)).toBe('原始');
    expect(tagOf(top.after)).toBe('最终');
  });

  it('不同 key 的改动不会互相合并', function () {
    recordChange('调外观', 'user', snap('a'), snap('b'), 'theme:radius');
    recordChange('调外观', 'user', snap('b'), snap('c'), 'theme:alpha');
    expect(undoSize()).toBe(2);
    recordChange('调外观', 'user', snap('c'), snap('d'), 'theme:radius');
    expect(undoSize()).toBe(3);
  });

  it('历史面板拿到的是摘要，不含快照（界面改不坏栈里的东西）', function () {
    recordChange('调课', 'user', snap('a'), snap('b'));
    recordChange('停课', 'user', snap('b'), snap('c'));
    const briefs = recentChanges(10);
    expect(briefs.length).toBe(2);
    /* 最近的在最前 */
    expect(briefs[0].label).toBe('停课');
    expect(Object.keys(briefs[0]).sort()).toEqual(['at', 'id', 'label', 'source']);
    expect(recentChanges(1).length).toBe(1);
    /* 重做栈同理 */
    const s = popUndo()!; pushRedo(s);
    expect(redoBriefs(5).map(function (b) { return b.label; })).toEqual(['停课']);
  });
});
