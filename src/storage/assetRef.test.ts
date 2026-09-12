import { describe, expect, it } from 'vitest';
import {
  ASSET_PREFIX, assetKey, collectAssetKeys, contentHash, extractAssets, hydrateAssets, isAssetRef, toAssetRef,
} from './assetRef';
import { defaultTheme, type Theme } from '../theme/tokens';
import { buildEmptyData } from '../core/demo';

/** 造一个够大、看起来像真图片的 data URI */
/* 必须超过 INLINE_LIMIT（4096），否则按"小图内联"处理，测不到外置路径 */
function bigImage(tag: string): string {
  return 'data:image/webp;base64,' + tag.repeat(5000);
}
const SMALL = 'data:image/webp;base64,AAAA';

function themeWith(custom: string, original?: string): Theme {
  const t = defaultTheme();
  t.wallpaper = Object.assign({}, t.wallpaper, { kind: 'custom', custom: custom, original: original });
  return t;
}

describe('图片外置', function () {
  it('小图不外置 —— 不值得为它多一次读写', function () {
    const r = extractAssets(themeWith(SMALL), buildEmptyData());
    expect(r.assets.length).toBe(0);
    expect(r.theme.wallpaper.custom).toBe(SMALL);
  });

  it('大图被换成引用，原图也一起抽出来', function () {
    const r = extractAssets(themeWith(bigImage('a'), bigImage('b')), buildEmptyData());
    expect(r.assets.length).toBe(2);
    expect(isAssetRef(r.theme.wallpaper.custom)).toBe(true);
    expect(isAssetRef(r.theme.wallpaper.original)).toBe(true);
  });

  it('同一张图只存一份（内容哈希去重）', function () {
    const same = bigImage('same');
    const r = extractAssets(themeWith(same, same), buildEmptyData());
    expect(r.assets.length).toBe(1);
    expect(r.theme.wallpaper.custom).toBe(r.theme.wallpaper.original);
  });

  it('不同的图得到不同的 key', function () {
    const a = contentHash(bigImage('x'));
    const b = contentHash(bigImage('y'));
    expect(a).not.toBe(b);
  });

  it('课程配图也会被外置', function () {
    const d = buildEmptyData();
    d.courses = [{ id: 'c1', name: '高数', colorIndex: 0, image: bigImage('c') } as never];
    const r = extractAssets(defaultTheme(), d);
    expect(r.assets.length).toBe(1);
    expect(isAssetRef(r.data.courses[0].image)).toBe(true);
  });

  it('没有大图时原样返回（不做无谓的对象复制）', function () {
    const d = buildEmptyData();
    const t = defaultTheme();
    const r = extractAssets(t, d);
    expect(r.theme).toBe(t);
    expect(r.data).toBe(d);
  });

  it('不改动入参', function () {
    const t = themeWith(bigImage('k'));
    const before = t.wallpaper.custom;
    extractAssets(t, buildEmptyData());
    expect(t.wallpaper.custom).toBe(before);
  });
});

describe('图片还原', function () {
  it('引用能还原成原始 data URI', function () {
    const uri = bigImage('r');
    const ex = extractAssets(themeWith(uri), buildEmptyData());
    const key = assetKey(ex.theme.wallpaper.custom);
    const back = hydrateAssets(ex.theme, ex.data, function (k) { return k === key ? uri : null; });
    expect(back.theme.wallpaper.custom).toBe(uri);
  });

  it('找不到的引用降级成空串，而不是留一个坏 URL', function () {
    const ex = extractAssets(themeWith(bigImage('m')), buildEmptyData());
    const back = hydrateAssets(ex.theme, ex.data, function () { return null; });
    expect(back.theme.wallpaper.custom).toBe('');
    expect(back.theme.wallpaper.custom.indexOf(ASSET_PREFIX)).toBe(-1);
  });

  it('导出/还原往返一致', function () {
    const uri = bigImage('round');
    const t = themeWith(uri, bigImage('orig'));
    const ex = extractAssets(t, buildEmptyData());
    const store: Record<string, string> = {};
    for (const a of ex.assets) store[a.key] = a.uri;
    const back = hydrateAssets(ex.theme, ex.data, function (k) { return store[k] === undefined ? null : store[k]; });
    expect(back.theme.wallpaper.custom).toBe(uri);
    expect(back.theme.wallpaper.original).toBe(t.wallpaper.original);
  });

  it('本来就不是引用的值原样保留', function () {
    const t = themeWith(SMALL);
    const back = hydrateAssets(t, buildEmptyData(), function () { return null; });
    expect(back.theme.wallpaper.custom).toBe(SMALL);
  });
});

describe('资产引用收集', function () {
  it('收集到壁纸与课程图的所有 key，用于统计与清理孤儿', function () {
    const d = buildEmptyData();
    d.courses = [
      { id: 'c1', name: 'A', colorIndex: 0, image: bigImage('1') } as never,
      { id: 'c2', name: 'B', colorIndex: 1, image: bigImage('2') } as never,
    ];
    const ex = extractAssets(themeWith(bigImage('w')), d);
    const keys = collectAssetKeys(ex.theme, ex.data);
    expect(keys.length).toBe(3);
    for (const k of keys) expect(k.indexOf(ASSET_PREFIX)).toBe(-1);
  });

  it('没有引用时返回空数组', function () {
    expect(collectAssetKeys(defaultTheme(), buildEmptyData()).length).toBe(0);
  });
});

describe('引用格式', function () {
  it('前缀往返', function () {
    expect(toAssetRef('abc')).toBe('asset:abc');
    expect(assetKey(toAssetRef('abc'))).toBe('abc');
    expect(isAssetRef('asset:abc')).toBe(true);
    expect(isAssetRef('data:image/png;base64,x')).toBe(false);
    expect(isAssetRef('')).toBe(false);
    expect(isAssetRef(undefined)).toBe(false);
  });
});
