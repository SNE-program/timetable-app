import { describe, expect, it } from 'vitest';
import {
  MASCOT_FORMAT, buildMascotFile, collectMascotKeys, describeAsset, extractMascotAssets, hydrateMascot,
  mascotFileText, packFromImage, parseMascotFileText, providedStates, sheetAsset, validateMascotPack,
} from './pack';
import { isAssetRef } from '../storage/assetRef';
import { blankCells, frameCount, type MascotPack } from './types';

/** 超过 INLINE_LIMIT（4096）才会被外置成引用；前缀本身占 23 个字符，所以这里得给足 */
function bigImage(tag: string): string {
  return 'data:image/webp;base64,' + tag.repeat(5000);
}
const SMALL = 'data:image/png;base64,' + 'A'.repeat(200);

function validPack(): MascotPack {
  return {
    format: MASCOT_FORMAT,
    version: 1,
    id: 'demo',
    name: '演示角色',
    height: 140,
    states: {
      idle: { kind: 'still', src: bigImage('i') },
      react: { kind: 'animated', src: bigImage('r') },
      sleep: { kind: 'sheet', src: bigImage('s'), cols: 4, rows: 6, fps: 12 },
    },
    motion: { breathe: 0.02, bob: 0.01, sway: 0 },
    interactive: { click: true, drag: true },
    shadow: true,
    anchor: { x: 0.5, y: 1 },
  };
}

describe('角色包校验', function () {
  it('完整包通过，字段原样保留', function () {
    const r = validateMascotPack(JSON.parse(JSON.stringify(validPack())));
    expect(r.ok).toBe(true);
    expect(r.pack!.name).toBe('演示角色');
    expect(r.pack!.states.sleep!.kind).toBe('sheet');
    expect(r.pack!.states.sleep!.cols).toBe(4);
    expect(r.pack!.states.sleep!.fps).toBe(12);
  });

  it('没有 idle 直接拒绝 —— 这是唯一必须有的素材', function () {
    const p: any = validPack();
    delete p.states.idle;
    const r = validateMascotPack(p);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('待机');
  });

  it('format 不对就明确拒绝，而不是硬着头皮猜', function () {
    const r = validateMascotPack({ format: 'timetable-theme', mascot: {} });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain(MASCOT_FORMAT);
  });

  it('缺素材的状态被跳过，其余状态照常可用', function () {
    const p: any = validPack();
    p.states.react = { kind: 'still', src: 'https://example.com/a.png' };
    const r = validateMascotPack(p);
    expect(r.ok).toBe(true);
    expect(r.pack!.states.react).toBeUndefined();
    expect(r.warnings.join()).toContain('react');
    expect(providedStates(r.pack!)).toEqual(['idle', 'sleep']);
  });

  it('标成逐帧但只有一格：降级成静态图而不是报错', function () {
    const p: any = validPack();
    p.states.sleep = { kind: 'sheet', src: bigImage('s'), cols: 1, rows: 1, fps: 12 };
    const r = validateMascotPack(p);
    expect(r.ok).toBe(true);
    expect(r.pack!.states.sleep!.kind).toBe('still');
    expect(r.warnings.join()).toContain('逐帧');
  });

  it('越界的数值被收敛，而不是原样吃进去', function () {
    const p: any = validPack();
    p.height = 99999;
    p.motion = { breathe: 99, bob: -5, sway: 999 };
    p.anchor = { x: 9, y: -9 };
    const r = validateMascotPack(p);
    expect(r.pack!.height).toBe(320);
    expect(r.pack!.motion.breathe).toBe(0.08);
    expect(r.pack!.motion.bob).toBe(0);
    expect(r.pack!.anchor).toEqual({ x: 1, y: 0 });
  });

  it('asset 引用必须放行 —— 否则每次重启素材都会被清掉', function () {
    const p: any = validPack();
    p.states.idle = { kind: 'still', src: 'asset:abc123' };
    const r = validateMascotPack(p);
    expect(r.ok).toBe(true);
    expect(r.pack!.states.idle!.src).toBe('asset:abc123');
    expect(r.warnings.length).toBe(0);
  });

  it('不是对象 / 不是 JSON 都给得出人话', function () {
    expect(validateMascotPack(null).ok).toBe(false);
    expect(validateMascotPack('abc').ok).toBe(false);
    const bad = parseMascotFileText('{ 不是 json');
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain('JSON');
  });

  it('导入别人的包时 format 存在就走包格式，缺失就当作裸 pack', function () {
    const bare = validPack();
    const r = validateMascotPack(JSON.parse(JSON.stringify(bare)));
    expect(r.ok).toBe(true);
    const wrapped = buildMascotFile(bare);
    expect(validateMascotPack(JSON.parse(JSON.stringify(wrapped))).ok).toBe(true);
  });
});

describe('一张图也能变成角色', function () {
  it('拖一张图进来就得到一个可用角色', function () {
    const p = packFromImage(bigImage('x'), '某二游角色.png');
    const r = validateMascotPack(JSON.parse(JSON.stringify(p)));
    expect(r.ok).toBe(true);
    expect(r.pack!.name).toBe('某二游角色.png');
    expect(r.pack!.states.idle!.kind).toBe('still');
    /* 默认就该有呼吸感，否则是一张死图 */
    expect(r.pack!.motion.breathe).toBeGreaterThan(0);
  });

  it('同一张图得到同一个 id，重复导入不会堆两份', function () {
    const a = packFromImage(bigImage('same'), 'a');
    const b = packFromImage(bigImage('same'), 'b');
    expect(a.id).toBe(b.id);
  });
});

describe('素材外置与还原', function () {
  it('大图被换成引用，小图留在原地', function () {
    const p = validPack();
    p.states.react = { kind: 'still', src: SMALL };
    const r = extractMascotAssets(p);
    expect(isAssetRef(r.pack.states.idle!.src)).toBe(true);
    expect(isAssetRef(r.pack.states.sleep!.src)).toBe(true);
    expect(r.pack.states.react!.src).toBe(SMALL);
    expect(r.assets.length).toBe(2);
  });

  it('同一张图只存一份', function () {
    const same = bigImage('same');
    const p = validPack();
    p.states.idle = { kind: 'still', src: same };
    p.states.react = { kind: 'still', src: same };
    const r = extractMascotAssets(p);
    /* 只有 idle 与 react 是同一张（sleep 那张是另外的图） */
    expect(r.assets.length).toBe(2);
    expect(r.pack.states.idle!.src).toBe(r.pack.states.react!.src);
  });

  it('没有大图时返回原对象（调用方拿引用做比较）', function () {
    const p = validPack();
    p.states.idle = { kind: 'still', src: SMALL };
    delete p.states.react;
    delete p.states.sleep;
    const r = extractMascotAssets(p);
    expect(r.pack).toBe(p);
    expect(r.assets.length).toBe(0);
  });

  it('写盘 → 冷启动 → 还原，整条链路走一遍', function () {
    const ex = extractMascotAssets(validPack());
    const store: Record<string, string> = {};
    for (const a of ex.assets) store[a.key] = a.uri;

    /* 模拟 localStorage：过一遍 JSON 就是真正的冷启动输入 */
    const fromDisk = JSON.parse(JSON.stringify(ex.pack));
    const v = validateMascotPack(fromDisk);
    expect(v.ok).toBe(true);
    expect(isAssetRef(v.pack!.states.idle!.src)).toBe(true);

    const back = hydrateMascot(v.pack!, function (k) { return store[k] === undefined ? null : store[k]; });
    expect(back.states.idle!.src).toContain('data:image/webp');
    /* 还原出来的必须和抽出来之前一模一样 */
    expect(back.states.idle!.src).toBe(ex.assets[0].uri);
    expect(back.states.sleep!.cols).toBe(4);
  });

  it('素材真的丢了：那个状态消失，而不是留一张空图', function () {
    const ex = extractMascotAssets(validPack());
    const back = hydrateMascot(ex.pack, function () { return null; });
    expect(back.states.idle).toBeUndefined();
    /* 校验会因此拒绝整包 —— 界面据此提示"素材丢失，请重新导入" */
    expect(validateMascotPack(JSON.parse(JSON.stringify(back))).ok).toBe(false);
  });

  it('key 收集与占用清理对得上', function () {
    const ex = extractMascotAssets(validPack());
    const keys = collectMascotKeys(ex.pack);
    expect(keys.length).toBe(3);
    expect(collectMascotKeys(null)).toEqual([]);
  });
});

describe('角色包导出', function () {
  it('导出的是内嵌图片，不是本机引用', function () {
    const pack = validPack();
    const out = mascotFileText(pack);
    expect(out.fileName).toContain('.mascot');
    expect(out.hasRefs).toBe(false);
    const parsed = JSON.parse(out.text);
    expect(parsed.format).toBe(MASCOT_FORMAT);
    expect(parsed.assets.length).toBe(3);
    /* 包里那份自己就能通过校验 */
    expect(validateMascotPack(parsed).ok).toBe(true);
  });

  it('内存里还是引用形态时：如实报告，而不是写一张空图进包', function () {
    const refPack = extractMascotAssets(validPack()).pack;
    const out = mascotFileText(refPack);
    expect(out.hasRefs).toBe(true);
    expect(JSON.parse(out.text).assets.length).toBe(0);
  });

  it('素材摘要能读', function () {
    expect(describeAsset({ kind: 'sheet', src: 'x', cols: 4, rows: 6, fps: 12 })).toContain('4×6');
    expect(describeAsset({ kind: 'still', src: 'x' })).toContain('静态图');
    expect(describeAsset(undefined)).toBe('未提供');
  });
});
describe('逐帧图的真实帧数（"一闪一闪"那个 bug 的出口）', function () {
  function sheetPack(asset: Record<string, unknown>) {
    return {
      format: MASCOT_FORMAT, version: 1, id: 'x', name: 'x', height: 140,
      states: { idle: Object.assign({ kind: 'sheet', src: 'data:image/png;base64,' + 'A'.repeat(200) }, asset) },
    };
  }

  it('网格排不满时按真实帧数存下来', function () {
    const v = validateMascotPack(sheetPack({ cols: 8, rows: 2, fps: 12, frames: 9 }));
    expect(v.ok).toBe(true);
    expect(v.pack!.states.idle!.frames).toBe(9);
    /* 网格 16 格，真实 9 帧 —— 差出来的 7 格是全透明的，绝不能播 */
    expect(frameCount(v.pack!.states.idle)).toBe(9);
    expect(blankCells(v.pack!.states.idle)).toBe(7);
  });

  it('老角色包（没有 frames 字段）按网格格数播，行为与旧版一致', function () {
    const v = validateMascotPack(sheetPack({ cols: 4, rows: 3, fps: 8 }));
    expect(v.ok).toBe(true);
    expect(v.pack!.states.idle!.frames).toBeUndefined();
    expect(frameCount(v.pack!.states.idle)).toBe(12);
    expect(blankCells(v.pack!.states.idle)).toBe(0);
  });

  it('帧数写超了会被夹回格数并给出提示', function () {
    const v = validateMascotPack(sheetPack({ cols: 4, rows: 2, fps: 8, frames: 99 }));
    expect(v.pack!.states.idle!.frames).toBeUndefined();
    expect(frameCount(v.pack!.states.idle)).toBe(8);
    expect(v.warnings.join(' ')).toContain('超过了格数');
  });

  it('帧数少到 1 时退回网格格数（不合法值不往包里写）', function () {
    const v = validateMascotPack(sheetPack({ cols: 4, rows: 2, fps: 8, frames: 1 }));
    expect(v.pack!.states.idle!.frames).toBeUndefined();
    expect(frameCount(v.pack!.states.idle)).toBe(8);
  });

  it('排满时不写这个字段（存盘形态和以前一模一样）', function () {
    const a = sheetAsset('data:image/png;base64,' + 'B'.repeat(200), 8, 6, 12, 48);
    expect(a.frames).toBeUndefined();
    expect(frameCount(a)).toBe(48);
  });

  it('sheetAsset 把帧数收进合法范围', function () {
    expect(sheetAsset('x', 8, 2, 12, 9).frames).toBe(9);
    expect(sheetAsset('x', 8, 2, 12, 0).frames).toBeUndefined();
    expect(sheetAsset('x', 8, 2, 12, 999).frames).toBeUndefined();
  });

  it('★ walk 是正式状态：能被校验、能进包、能导出', function () {
    const img = 'data:image/png;base64,' + 'C'.repeat(200);
    const raw = {
      format: MASCOT_FORMAT, version: 1, id: 'w', name: '走路的角色', height: 140,
      states: {
        idle: { kind: 'still', src: img },
        walk: { kind: 'still', src: img + 'D' },
        sleep: { kind: 'still', src: img + 'E' },
      },
    };
    const v = validateMascotPack(raw);
    expect(v.ok).toBe(true);
    expect(v.pack!.states.walk).toBeTruthy();
    expect(providedStates(v.pack!).slice().sort()).toEqual(['idle', 'sleep', 'walk']);
    /* 导出时也要带上 —— 否则分享出去的包会丢走路素材 */
    const out = mascotFileText(v.pack!);
    const parsed = JSON.parse(out.text);
    expect(parsed.mascot.states.walk).toBeTruthy();
    expect(parsed.assets.filter(function (a: { state: string }) { return a.state === 'walk'; }).length).toBe(1);
  });

  it('摘要里把"网格几格、真实几帧"都写出来', function () {
    const text = describeAsset({ kind: 'sheet', src: 'x', cols: 8, rows: 2, fps: 12, frames: 9 });
    expect(text).toContain('共 9 帧');
    expect(text).toContain('网格 16 格');
    /* 排满的时候不啰嗦 */
    expect(describeAsset({ kind: 'sheet', src: 'x', cols: 4, rows: 2, fps: 12 })).toContain('共 8 帧');
  });
});
