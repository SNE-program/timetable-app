import { beforeEach, describe, expect, it } from 'vitest';
import {
  MASCOT_LIB_MAX, clearHistory, getState, importMascotPackObject, mascotAssetKeys, mascotLibrary,
  removeMascotFromLibrary, renameMascotFromLibrary, saveCurrentMascotToLibrary, setData,
  useMascotFromLibrary, removeMascot,
} from './store';
import { buildEmptyData } from '../core/demo';
import { MASCOT_FORMAT } from '../mascot/pack';
import type { MascotPack } from '../mascot/types';

/*
 * 本机角色库（v1.9.6）。
 *
 * 这一版之前"换角色"只有重新导入一条路，所以库的核心不是"存"，而是**存了之后资产不能被误删**：
 * 换角色时 applyMascot 会回收旧素材，如果没把库里其它条目算进 keep 列表，
 * 切换一次就会把库里别的角色的图删掉 —— 表现是"库里的角色点开是空的"。
 * 下面的用例把这条守住。
 */
beforeEach(function () {
  (globalThis as any).window = {
    setTimeout: function () { return 0; },
    clearTimeout: function () { /* noop */ },
    location: { search: '' },
    addEventListener: function () { /* noop */ },
    removeEventListener: function () { /* noop */ },
  };
  /* 把库清空（条目本来就存在 localStorage，这里靠删除接口逐个清掉） */
  for (const e of mascotLibrary()) removeMascotFromLibrary(e.id);
  removeMascot();
  clearHistory();
  setData(buildEmptyData());
});

function pack(name: string, tag: string): MascotPack {
  return {
    format: MASCOT_FORMAT,
    version: 1,
    id: 'p-' + name,
    name: name,
    height: 140,
    states: { idle: { kind: 'still', src: 'data:image/png;base64,' + tag.repeat(120) } },
    motion: { breathe: 0.02, bob: 0.01, sway: 0 },
    interactive: { click: true, drag: true },
    shadow: true,
    anchor: { x: 0.5, y: 1 },
  };
}

function install(name: string, tag: string): void {
  const r = importMascotPackObject(pack(name, tag));
  expect(r.ok).toBe(true);
}

describe('本机角色库', function () {
  it('存进库之后能列出来，来源也记着', function () {
    install('角色甲', 'a');
    const r = saveCurrentMascotToLibrary('导入');
    expect(r.ok).toBe(true);
    const lib = mascotLibrary();
    expect(lib.length).toBe(1);
    expect(lib[0].name).toBe('角色甲');
    expect(lib[0].from).toBe('导入');
  });

  it('同一个角色不会重复入库', function () {
    install('角色甲', 'a');
    saveCurrentMascotToLibrary('导入');
    const again = saveCurrentMascotToLibrary('导入');
    expect(again.ok).toBe(false);
    expect(mascotLibrary().length).toBe(1);
  });

  it('超过上限丢最旧的，并且把丢了谁说出来', function () {
    for (let i = 0; i < MASCOT_LIB_MAX + 1; i++) {
      install('角色' + i, String.fromCharCode(97 + i));
      const r = saveCurrentMascotToLibrary('导入');
      expect(r.ok).toBe(true);
      if (i === MASCOT_LIB_MAX) expect((r.error || '').indexOf('角色0') >= 0).toBe(true);
    }
    const lib = mascotLibrary();
    expect(lib.length).toBe(MASCOT_LIB_MAX);
    expect(lib.filter(function (e) { return e.name === '角色0'; }).length).toBe(0);
  });

  it('从库里换角色：换回来时素材还在（换角色不能把库里的图删掉）', function () {
    install('角色甲', 'a');
    saveCurrentMascotToLibrary('导入');
    install('角色乙', 'b');
    saveCurrentMascotToLibrary('导入');
    const jia = mascotLibrary().filter(function (e) { return e.name === '角色甲'; })[0];
    /* 连着切换几次：第二次切回来时，第一次换走时如果误删了素材，这里就会失败 */
    expect(useMascotFromLibrary(jia.id)).toBe(true);
    expect(getState().mascot!.name).toBe('角色甲');
    const yi = mascotLibrary().filter(function (e) { return e.name === '角色乙'; })[0];
    expect(useMascotFromLibrary(yi.id)).toBe(true);
    expect(useMascotFromLibrary(jia.id)).toBe(true);
    expect(getState().mascot!.name).toBe('角色甲');
  });

  it('库里的角色算进"角色占用的素材"，清理孤儿时不会被回收', function () {
    install('角色甲', 'a');
    saveCurrentMascotToLibrary('导入');
    install('角色乙', 'b');
    const keys = mascotAssetKeys();
    const jia = mascotLibrary().filter(function (e) { return e.name === '角色甲'; })[0];
    const jiaKey = (jia.pack.states.idle as { src: string }).src;
    /* 库里的那条也在清单里 —— 否则清孤儿时会把它删掉 */
    expect(keys.indexOf(jiaKey) >= 0 || jiaKey.indexOf('asset:') < 0).toBe(true);
  });

  it('改名与删除', function () {
    install('角色甲', 'a');
    saveCurrentMascotToLibrary('导入');
    const id = mascotLibrary()[0].id;
    renameMascotFromLibrary(id, '  我的角色  ');
    expect(mascotLibrary()[0].name).toBe('我的角色');
    removeMascotFromLibrary(id);
    expect(mascotLibrary().length).toBe(0);
  });
});