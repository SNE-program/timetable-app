import { describe, expect, it } from 'vitest';
import { syncPromptFor } from './syncAsk';

/**
 * 登录后那一问：**四种情形一个都不能问错**。
 *
 * 问错了不是"体验差一点"，而是丢数据：往哪边覆盖，被覆盖的那份就没了。
 */
describe('登录后的同步询问', function () {
  it('云端有备份 + 本机有课表 → 两个方向都摆出来，不替用户选', function () {
    const p = syncPromptFor({ localCourses: 12, cloudHasBackup: true });
    expect(p.kind).toBe('both');
    expect(p.primary!.action).toBe('restore');
    expect(p.secondary!.action).toBe('backup');
    /* 必须说清"只能留一份" */
    expect(p.lead).toContain('只能留一份');
    expect(p.lead).toContain('12');
  });

  it('云端有备份 + 本机是空的 → 只提供"恢复到本机"', function () {
    const p = syncPromptFor({ localCourses: 0, cloudHasBackup: true });
    expect(p.kind).toBe('restore');
    expect(p.primary!.action).toBe('restore');
    expect(p.secondary).toBe(undefined);
  });

  it('云端没有 + 本机有课表 → 只提供"备份上去"', function () {
    const p = syncPromptFor({ localCourses: 3, cloudHasBackup: false });
    expect(p.kind).toBe('backup');
    expect(p.primary!.action).toBe('backup');
    expect(p.secondary).toBe(undefined);
  });

  it('两边都空 → 什么都不问，别打扰用户', function () {
    const p = syncPromptFor({ localCourses: 0, cloudHasBackup: false });
    expect(p.kind).toBe('none');
    expect(p.primary).toBe(undefined);
  });
});
