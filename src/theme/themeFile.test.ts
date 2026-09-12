import { describe, expect, it } from 'vitest';
import { themeFileText, validateTheme } from './themeFile';
import { defaultTheme, type Theme } from './tokens';
import { buildEmptyData } from '../core/demo';
import { extractAssets, hydrateAssets, isAssetRef } from '../storage/assetRef';

/**
 * 回归：自定义壁纸必须能熬过一次重启。
 *
 * 这里刻意把"写盘 / 冷启动"这串动作**原样走一遍** ——
 * 之前的 bug 不是某一环写错了，而是两个模块对"合法的壁纸值"理解不一致：
 * 写盘时把大图换成 `asset:<key>` 引用，启动校验却只认内嵌 data URI，
 * 于是在还原之前就被清空。单测任何一环都发现不了，只有把链路连起来跑才会露。
 */

/** 超过 INLINE_LIMIT（4096），会被外置成引用 */
function bigImage(tag: string): string {
  return 'data:image/webp;base64,' + tag.repeat(5000);
}
/** 超过 isImageDataUri 的 64 字符下限，但小到仍然内联 */
const INLINE = 'data:image/webp;base64,' + 'A'.repeat(200);

function themeWith(custom: string): Theme {
  const t = defaultTheme();
  t.wallpaper = Object.assign({}, t.wallpaper, { kind: 'custom', custom: custom });
  return t;
}

describe('自定义壁纸跨重启保留', function () {
  const data = buildEmptyData();

  it('写盘产生的 asset: 引用能通过启动校验（这就是那个 bug）', function () {
    const uri = bigImage('x');
    const saved = extractAssets(themeWith(uri), data).theme;
    expect(isAssetRef(saved.wallpaper.custom)).toBe(true);

    /* 模拟 localStorage：过一遍 JSON 就成了真正的冷启动输入 */
    const fromDisk = JSON.parse(JSON.stringify(saved));
    const r = validateTheme(fromDisk);

    expect(r.ok).toBe(true);
    expect(r.theme!.wallpaper.kind).toBe('custom');
    expect(r.theme!.wallpaper.custom).toBe(saved.wallpaper.custom);
    expect(r.warnings.filter(function (w) { return w.indexOf('已回退为无壁纸') >= 0; })).toEqual([]);
  });

  it('校验之后还能把图片还原回来', function () {
    const uri = bigImage('y');
    const ex = extractAssets(themeWith(uri), data);
    const store: Record<string, string> = {};
    for (const a of ex.assets) store[a.key] = a.uri;

    const fromDisk = JSON.parse(JSON.stringify(ex.theme));
    const r = validateTheme(fromDisk);
    const back = hydrateAssets(r.theme!, data, function (k) {
      return store[k] === undefined ? null : store[k];
    });

    expect(back.theme.wallpaper.custom).toBe(uri);
    expect(back.theme.wallpaper.kind).toBe('custom');
  });

  it('内联的小图不受影响', function () {
    const saved = extractAssets(themeWith(INLINE), data).theme;
    expect(isAssetRef(saved.wallpaper.custom)).toBe(false);
    const r = validateTheme(JSON.parse(JSON.stringify(saved)));
    expect(r.theme!.wallpaper.kind).toBe('custom');
    expect(r.theme!.wallpaper.custom).toBe(INLINE);
  });

  it('图片真的丢了：还原成空串，界面据此回退（不显示"已选自定义壁纸"却看不到图）', function () {
    const ex = extractAssets(themeWith(bigImage('z')), data);
    const back = hydrateAssets(ex.theme, data, function () { return null; });
    expect(back.theme.wallpaper.kind).toBe('custom');
    expect(back.theme.wallpaper.custom).toBe('');
    /* store 里的自愈条件就是这一条 */
    expect(back.theme.wallpaper.kind === 'custom' && !back.theme.wallpaper.custom).toBe(true);
  });

  it('内嵌图片缺失时仍然回退为无壁纸（原有行为不能被破坏）', function () {
    const r = validateTheme({ wallpaper: { kind: 'custom', custom: '' } });
    expect(r.theme!.wallpaper.kind).toBe('none');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('主题包', function () {
  const data = buildEmptyData();

  it('导出的是内嵌图片，不是本机引用', function () {
    const uri = bigImage('p');
    const pack = themeFileText(themeWith(uri));
    expect(pack.fileName).toContain('.timetheme');

    const parsed = JSON.parse(pack.text);
    expect(parsed.format).toBe('timetable-theme');
    expect(parsed.theme.wallpaper.custom).toBe(uri);
    expect(parsed.assets.length).toBe(1);

    /* 包里那份必须自己就能通过校验 —— 否则发给别人导入就是坏的 */
    const again = validateTheme(parsed);
    expect(again.ok).toBe(true);
    expect(again.theme!.wallpaper.kind).toBe('custom');
    expect(again.theme!.wallpaper.custom).toBe(uri);
  });

  it('引用形态的 theme 不会把一张空图写进包里', function () {
    const refTheme = extractAssets(themeWith(bigImage('q')), data).theme;
    expect(isAssetRef(refTheme.wallpaper.custom)).toBe(true);

    const parsed = JSON.parse(themeFileText(refTheme).text);
    expect(parsed.theme.wallpaper.kind).toBe('none');
    expect(parsed.theme.wallpaper.custom).toBe('');
    expect(parsed.assets.length).toBe(0);
  });

  it('原图不外带（同一张图不该在包里存两份）', function () {
    const uri = bigImage('r');
    const t = themeWith(uri);
    t.wallpaper = Object.assign({}, t.wallpaper, { original: uri });
    const parsed = JSON.parse(themeFileText(t).text);
    expect(parsed.theme.wallpaper.original).toBeUndefined();
  });
});
