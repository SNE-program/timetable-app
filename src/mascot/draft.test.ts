import { describe, expect, it } from 'vitest';
import { buildPack, cellSize, defaultDraftAsset, draftAdvice, draftFromPack, draftIssues, emptyDraft } from './draft';
import { validateMascotPack } from './pack';
import type { MascotDraft } from './draft';

const IMG = 'data:image/png;base64,' + 'A'.repeat(300);
const SHEET = 'data:image/png;base64,' + 'B'.repeat(300);

function draftWithIdle(): MascotDraft {
  const d = emptyDraft();
  d.name = '我的角色';
  d.assets.idle = defaultDraftAsset(IMG, 240, 320);
  return d;
}

describe('草稿校验', function () {
  it('空草稿不能保存，理由说得清楚', function () {
    const issues = draftIssues(emptyDraft());
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('待机');
  });

  it('只有待机图就能保存 —— 这是最短的一条可用路径', function () {
    expect(draftIssues(draftWithIdle())).toEqual([]);
  });

  it('逐帧图只有一格会被指出来，而不是默默存下去', function () {
    const d = draftWithIdle();
    d.assets.react = defaultDraftAsset(SHEET, 240, 320);
    d.assets.react.kind = 'sheet';
    d.assets.react.cols = 1;
    d.assets.react.rows = 1;
    expect(draftIssues(d)[0]).toContain('至少要有两格');
  });
});

describe('草稿 → 角色包', function () {
  it('最短路径产出的包能通过导入校验', function () {
    const r = buildPack(draftWithIdle());
    expect(r.issues).toEqual([]);
    expect(validateMascotPack(JSON.parse(JSON.stringify(r.pack))).ok).toBe(true);
  });

  it('没填名字就叫"未命名角色"，而不是留空', function () {
    const d = draftWithIdle();
    d.name = '   ';
    expect(buildPack(d).pack.name).toBe('未命名角色');
  });

  it('作者/说明留空时不写进包里（避免导出后多两个空字段）', function () {
    const d = draftWithIdle();
    d.author = '';
    d.description = '   ';
    const p = buildPack(d).pack;
    expect(p.author).toBeUndefined();
    expect(p.description).toBeUndefined();
  });

  it('尺寸与动画参数越界会被夹住，不会写进非法值', function () {
    const d = draftWithIdle();
    d.height = 9999;
    d.motion.breathe = 99;
    d.motion.sway = -5;
    const p = buildPack(d).pack;
    expect(p.height).toBe(320);
    expect(p.motion.breathe).toBeLessThanOrEqual(0.08);
    expect(p.motion.sway).toBeGreaterThanOrEqual(0);
  });

  it('逐帧图：格数越界被夹住，只有一格则降级成静态图（和导入路径同一套规则）', function () {
    const d = draftWithIdle();
    d.assets.react = defaultDraftAsset(SHEET, 480, 320);
    d.assets.react.kind = 'sheet';
    d.assets.react.cols = 99;
    d.assets.react.rows = 99;
    d.assets.react.fps = 999;
    const p = buildPack(d).pack;
    expect(p.states.react!.cols).toBe(32);
    expect(p.states.react!.fps).toBe(24);

    d.assets.react.cols = 1;
    d.assets.react.rows = 1;
    expect(buildPack(d).pack.states.react!.kind).toBe('still');
    expect(buildPack(d).pack.states.react!.cols).toBeUndefined();
  });

  it('没有图的槽位不会被写进包里', function () {
    const d = draftWithIdle();
    d.assets.sleep = defaultDraftAsset('', 0, 0);
    const p = buildPack(d).pack;
    expect(p.states.sleep).toBeUndefined();
    expect(Object.keys(p.states)).toEqual(['idle']);
  });

  it('同一个草稿存两次得到同一个 id（覆盖而不是堆积）', function () {
    const a = buildPack(draftWithIdle()).pack.id;
    const b = buildPack(draftWithIdle()).pack.id;
    expect(a).toBe(b);
  });

  it('改了内容 id 会变（不同角色不该互相覆盖）', function () {
    const d1 = draftWithIdle();
    const d2 = draftWithIdle();
    d2.name = '另一个';
    expect(buildPack(d1).pack.id).not.toBe(buildPack(d2).pack.id);
  });
});

describe('角色包 → 草稿（编辑当前角色）', function () {
  it('往返一趟关键字段不丢', function () {
    const d = draftWithIdle();
    d.author = '某人';
    d.description = '测试';
    d.height = 180;
    d.shadow = false;
    d.click = false;
    d.motion.sway = 4;
    d.assets.react = defaultDraftAsset(SHEET, 480, 320);
    d.assets.react.kind = 'sheet';
    d.assets.react.cols = 4;
    d.assets.react.rows = 2;
    d.assets.react.fps = 12;

    const pack = buildPack(d).pack;
    const back = draftFromPack(pack);
    expect(back.name).toBe('我的角色');
    expect(back.author).toBe('某人');
    expect(back.height).toBe(180);
    expect(back.shadow).toBe(false);
    expect(back.click).toBe(false);
    expect(back.motion.sway).toBe(4);
    expect(back.assets.react!.kind).toBe('sheet');
    expect(back.assets.react!.cols).toBe(4);
    expect(back.assets.react!.rows).toBe(2);
    expect(back.assets.react!.fps).toBe(12);
    /* 再存回去还是一样 */
    expect(buildPack(back).pack.states.react!.cols).toBe(4);
  });

  it('缺的状态在草稿里也是缺的', function () {
    const back = draftFromPack(buildPack(draftWithIdle()).pack);
    expect(back.assets.sleep).toBeUndefined();
    expect(back.assets.react).toBeUndefined();
  });

  it('包里不存像素尺寸，倒回来时留 0（界面显示"未知"而不是编一个数）', function () {
    const back = draftFromPack(buildPack(draftWithIdle()).pack);
    expect(back.assets.idle!.width).toBe(0);
    expect(cellSize(back.assets.idle)).toBeNull();
  });
});

describe('逐帧图单格尺寸提示', function () {
  it('按格数折算', function () {
    const a = defaultDraftAsset(SHEET, 480, 320);
    a.kind = 'sheet';
    a.cols = 4;
    a.rows = 2;
    expect(cellSize(a)).toEqual({ w: 120, h: 160 });
  });

  it('非逐帧图不提示', function () {
    expect(cellSize(defaultDraftAsset(IMG, 240, 320))).toBeNull();
  });
});
describe('逐帧图的真实帧数（草稿侧）', function () {
  function sheetDraft(cols: number, rows: number, frames: number): MascotDraft {
    const d = draftWithIdle();
    d.assets.idle = defaultDraftAsset(SHEET, cols * 100, rows * 200);
    d.assets.idle.kind = 'sheet';
    d.assets.idle.cols = cols;
    d.assets.idle.rows = rows;
    d.assets.idle.fps = 12;
    d.assets.idle.frames = frames;
    return d;
  }

  it('填了真实帧数就写进包里', function () {
    const pack = buildPack(sheetDraft(8, 2, 9)).pack;
    expect(pack.states.idle!.frames).toBe(9);
  });

  it('没填（0）就不写字段 —— 与旧包形态一致', function () {
    const pack = buildPack(sheetDraft(4, 2, 0)).pack;
    expect(pack.states.idle!.frames).toBeUndefined();
  });

  it('超过格数或小于 2 都不写', function () {
    expect(buildPack(sheetDraft(4, 2, 99)).pack.states.idle!.frames).toBeUndefined();
    expect(buildPack(sheetDraft(4, 2, 1)).pack.states.idle!.frames).toBeUndefined();
  });

  it('编辑已有角色时帧数不丢', function () {
    const back = draftFromPack(buildPack(sheetDraft(8, 2, 9)).pack);
    expect(back.assets.idle!.frames).toBe(9);
    expect(buildPack(back).pack.states.idle!.frames).toBe(9);
  });
});

describe('给用户的建议（不拦保存）', function () {
  function sheetDraft(cellW: number, cellH: number, height: number): MascotDraft {
    const d = draftWithIdle();
    d.height = height;
    d.assets.idle = defaultDraftAsset(SHEET, cellW * 4, cellH * 2);
    d.assets.idle.kind = 'sheet';
    d.assets.idle.cols = 4;
    d.assets.idle.rows = 2;
    d.assets.idle.frames = 8;
    return d;
  }

  it('单格像素不够时算给用户看：需要多少、现在有多少', function () {
    const out = draftAdvice(sheetDraft(120, 160, 320), 3.5);
    expect(out.length).toBe(1);
    expect(out[0]).toContain('160');
    expect(out[0]).toContain('1120');
  });

  it('单格够清楚时不多嘴', function () {
    expect(draftAdvice(sheetDraft(400, 600, 140), 3.5).length).toBe(0);
  });

  it('还没量过帧数时提醒一句"可能有空格子会闪"', function () {
    const d = sheetDraft(400, 600, 140);
    d.assets.idle!.frames = 0;
    const out = draftAdvice(d, 3.5);
    expect(out.join(' ')).toContain('自动数帧');
  });

  it('静态图太小也会提醒', function () {
    const d = draftWithIdle();
    d.height = 320;
    d.assets.idle = defaultDraftAsset(IMG, 200, 300);
    const out = draftAdvice(d, 3.5);
    expect(out.length).toBe(1);
    expect(out[0]).toContain('200×300');
  });

  it('屏幕倍率拿不到时按 1 倍算，不崩', function () {
    expect(draftAdvice(draftWithIdle(), NaN).length).toBe(0);
  });
});
