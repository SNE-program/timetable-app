import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllCourses, clearHistory, getState, redo, setData, undo } from './store';
import { buildEmptyData } from '../core/demo';
import type { Course } from '../core/types';

/*
 * 走真实 store 的撤销/重做验证。
 *
 * store 在模块加载时对各处 window / localStorage 都有 try/catch 兜底，
 * 所以能在 Node 里直接跑；但 showToast 会调 window.setTimeout，
 * 撤销成功时正会走到那里，所以这里补一个最小 window 桩。
 */
beforeEach(function () {
  (globalThis as any).window = {
    setTimeout: function () { return 0; },
    clearTimeout: function () { /* noop */ },
    location: { search: '' },
    addEventListener: function () { /* noop */ },
    removeEventListener: function () { /* noop */ },
  };
  /*
   * 顺序很重要：必须**先清历史再重置数据**。
   * 反过来（靠 while(undo()) 抽空）会把上一条快照的数据还原回来，
   * 下一个用例的基线就不是空的 —— 我第一版就是这么写错的。
   */
  clearHistory();
  setData(buildEmptyData());
});

function course(id: string, name: string): Course {
  return { id: id, name: name, colorIndex: 0 } as Course;
}

describe('课表撤销 / 重做', function () {
  it('带标签的写入会进历史，不带标签的不会', function () {
    expect(getState().history.undo).toBe(0);
    setData(Object.assign({}, getState().data, { courses: [course('c1', '高数')] }));
    expect(getState().history.undo).toBe(0);
    setData(Object.assign({}, getState().data, { courses: [course('c1', '高数'), course('c2', '英语')] }), '添加课程');
    expect(getState().history.undo).toBe(1);
    expect(getState().history.lastLabel).toBe('添加课程');
  });

  it('撤销把数据还原，重做再推回去', function () {
    const base = getState().data;
    setData(Object.assign({}, base, { courses: [course('c1', '高数')] }), '添加课程');
    expect(getState().data.courses.length).toBe(1);

    expect(undo()).toBe(true);
    expect(getState().data.courses.length).toBe(0);
    expect(getState().history.undo).toBe(0);
    expect(getState().history.redo).toBe(1);

    expect(redo()).toBe(true);
    expect(getState().data.courses.length).toBe(1);
    expect(getState().history.redo).toBe(0);
  });

  it('连续多步撤销回到最初，重做逐条还原', function () {
    const base = getState().data;
    setData(Object.assign({}, base, { courses: [course('c1', 'A')] }), '第一步');
    setData(Object.assign({}, getState().data, { courses: [course('c1', 'A'), course('c2', 'B')] }), '第二步');
    setData(Object.assign({}, getState().data, { courses: [course('c1', 'A'), course('c2', 'B'), course('c3', 'C')] }), '第三步');
    expect(getState().data.courses.length).toBe(3);

    undo(); undo(); undo();
    expect(getState().data.courses.length).toBe(0);
    expect(getState().history.undo).toBe(0);
    expect(getState().history.redo).toBe(3);

    redo();
    expect(getState().data.courses.length).toBe(1);
    redo(); redo();
    expect(getState().data.courses.length).toBe(3);
  });

  it('撤销之后再改东西，重做分支失效（和所有编辑器一致）', function () {
    const base = getState().data;
    setData(Object.assign({}, base, { courses: [course('c1', 'A')] }), '添加课程');
    undo();
    expect(getState().history.redo).toBe(1);
    setData(Object.assign({}, getState().data, { tasks: [] }), '另一个改动');
    expect(getState().history.redo).toBe(0);
    expect(redo()).toBe(false);
  });

  it('清空课表可以完整撤销回来', function () {
    setData(Object.assign({}, getState().data, {
      courses: [course('c1', '高数'), course('c2', '英语')],
    }), '添加课程');
    while (undo()) { /* 回到只有初始状态 */ }

    setData(Object.assign({}, getState().data, {
      courses: [course('c1', '高数'), course('c2', '英语')],
    }), '添加课程');
    expect(getState().data.courses.length).toBe(2);

    clearAllCourses();
    expect(getState().data.courses.length).toBe(0);
    expect(undo()).toBe(true);
    expect(getState().data.courses.length).toBe(2);
  });

  it('栈空时撤销/重做安全返回 false', function () {
    expect(undo()).toBe(false);
    expect(redo()).toBe(false);
  });
});
