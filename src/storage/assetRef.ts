import type { Theme } from '../theme/tokens';
import type { TimetableData } from '../core/types';

/**
 * 内联图片的外置与还原。
 *
 * ## 为什么只把图片挪出去
 *
 * 实测过：结构化课表数据只有 **约 11 KB**，而一张自定义壁纸（剪裁后的成品
 * 加原图）能到 **2–5 MB**，Chromium 给每个应用的 localStorage 配额是 **约 5 MB**。
 * 也就是说配额风险几乎全部来自图片。
 *
 * 所以这里的做法是：**图片存进 SQLite，结构化数据仍留在 localStorage**。
 * 好处不只是省事 —— 它还让启动路径保持**同步**：
 * initialState() 照旧同步读到课表就能立刻渲染，只有壁纸需要在挂载后异步补上，
 * 补不上最多是壁纸晚一拍出现，而不是整屏空白。
 *
 * 内存里的表示**仍然是 data URI**，外置只发生在"写入磁盘"这一步。
 * 这样所有渲染代码一行都不用改 —— 换存储最容易出事的就是渲染路径，
 * 不动它就没有回归面。
 */

export const ASSET_PREFIX = 'asset:';
/** 小于这个体积不值得外置，直接内联更省事（也避免碎片化出一堆小文件） */
export const INLINE_LIMIT = 4 * 1024;

export function isAssetRef(v: string | undefined | null): boolean {
  return !!v && v.indexOf(ASSET_PREFIX) === 0;
}

export function assetKey(ref: string): string {
  return ref.slice(ASSET_PREFIX.length);
}

export function toAssetRef(key: string): string {
  return ASSET_PREFIX + key;
}

/** 值得外置的内联大图。角色包也要用这个判断，所以导出 */
export function isInlineImage(v: string | undefined | null): boolean {
  return !!v && v.indexOf('data:image/') === 0 && v.length > INLINE_LIMIT;
}

/**
 * 内容哈希（FNV-1a 32 位）。
 * 用内容定 key 而不是随机 id：同一张图存两次只会占一份，
 * 用户反复换壁纸也不会把库撑大。
 */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8) + '-' + s.length.toString(36);
}

export interface ExtractedAsset {
  key: string;
  uri: string;
}

export interface ExtractResult {
  theme: Theme;
  data: TimetableData;
  assets: ExtractedAsset[];
}

/**
 * 把 theme 与 data 里的大图抽出来，原位换成 `asset:<key>` 引用。
 * 纯函数，不改动入参。
 */
export function extractAssets(theme: Theme, data: TimetableData): ExtractResult {
  const assets: ExtractedAsset[] = [];
  const seen: Record<string, string> = {};

  function take(uri: string | undefined): string | undefined {
    if (!isInlineImage(uri)) return uri;
    const key = contentHash(uri!);
    if (!seen[key]) { seen[key] = key; assets.push({ key: key, uri: uri! }); }
    return toAssetRef(key);
  }

  const wp = theme.wallpaper;
  const nextCustom = take(wp.custom);
  const nextOriginal = take(wp.original);
  const nextCourses = data.courses.map(function (c) {
    if (!isInlineImage(c.image)) return c;
    return Object.assign({}, c, { image: take(c.image) });
  });

  /* 什么都没抽出来就别造新对象 —— 调用方常常拿返回值和原值比引用，
     每次都复制会让"有没有变化"判断失效，也会带来无谓的重渲染 */
  if (assets.length === 0) return { theme: theme, data: data, assets: assets };

  const nextWp = Object.assign({}, wp, {
    custom: nextCustom || '',
    original: nextOriginal,
  });
  const coursesChanged = nextCourses.some(function (c, i) { return c !== data.courses[i]; });

  return {
    theme: Object.assign({}, theme, { wallpaper: nextWp }),
    data: coursesChanged ? Object.assign({}, data, { courses: nextCourses }) : data,
    assets: assets,
  };
}

/** 收集一份数据里所有的 asset 引用，用于统计占用与清理孤儿 */
export function collectAssetKeys(theme: Theme, data: TimetableData): string[] {
  const keys: string[] = [];
  if (isAssetRef(theme.wallpaper.custom)) keys.push(assetKey(theme.wallpaper.custom));
  if (isAssetRef(theme.wallpaper.original)) keys.push(assetKey(theme.wallpaper.original!));
  for (const c of data.courses) {
    if (isAssetRef(c.image)) keys.push(assetKey(c.image!));
  }
  return keys;
}

/**
 * 把引用还原成 data URI。查不到的引用会被**降级成空串**而不是原样留着 ——
 * 留着的话 `background-image: url(asset:xxx)` 会变成一个坏 URL，
 * 浏览器会去请求它，控制台一堆报错。
 */
export function hydrateAssets(
  theme: Theme, data: TimetableData, lookup: (key: string) => string | null
): ExtractResult {
  const resolve = function (v: string | undefined, fallback: string): string {
    if (!isAssetRef(v)) return v === undefined ? fallback : v;
    const got = lookup(assetKey(v!));
    return got === null ? '' : got;
  };

  const wp = theme.wallpaper;
  const nextWp = Object.assign({}, wp, {
    custom: resolve(wp.custom, ''),
    original: wp.original === undefined ? undefined : resolve(wp.original, ''),
  });

  let touched = false;
  const nextCourses = data.courses.map(function (c) {
    if (!isAssetRef(c.image)) return c;
    touched = true;
    return Object.assign({}, c, { image: resolve(c.image, '') || undefined });
  });

  return {
    theme: Object.assign({}, theme, { wallpaper: nextWp }),
    data: touched ? Object.assign({}, data, { courses: nextCourses }) : data,
    assets: [],
  };
}
