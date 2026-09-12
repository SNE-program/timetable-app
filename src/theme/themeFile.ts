import { defaultTheme, type CardStyle, type Density, type FontKey, type ModePref, type Theme, type WallpaperState } from './tokens';
import { dataUriBytes, formatBytes, readFileAsText } from './image';
import { isHex } from './color';
import { isAssetRef } from '../storage/assetRef';

export const THEME_FORMAT = 'timetable-theme';
export const THEME_VERSION = 1;
export const THEME_EXT = '.timetheme';

export interface ThemeAssetInfo { name: string; field: string; mime: string; bytes: number; bytesText: string; }

export interface ThemeFile {
  format: string;
  version: number;
  exportedAt: string;
  meta: Theme['meta'];
  assets: ThemeAssetInfo[];
  theme: Theme;
}

function mimeOf(src: string): string {
  const m = /^data:([^;,]+)/.exec(src);
  return m ? m[1] : 'application/octet-stream';
}

function isImageDataUri(s: string): boolean {
  return typeof s === 'string' && s.indexOf('data:image/') === 0 && s.length > 64;
}

/** 打包：图片以 data URI 内嵌在 theme 里，assets 只是一份清单，便于人查看包里有什么图 */
export function buildThemeFile(theme: Theme): ThemeFile {
  /* 原图只留本机，不写进主题包 —— 否则同一张图会存两份 */
  const slim = Object.assign({}, theme, {
    wallpaper: Object.assign({}, theme.wallpaper, { original: undefined }),
  });
  const assets: ThemeAssetInfo[] = [];
  if (theme.wallpaper.kind === 'custom' && isImageDataUri(theme.wallpaper.custom)) {
    /* 只有内嵌图片才配得上"资产清单"这个名头 */
    const b = dataUriBytes(theme.wallpaper.custom);
    assets.push({ name: '自定义壁纸', field: 'wallpaper.custom', mime: mimeOf(theme.wallpaper.custom), bytes: b, bytesText: formatBytes(b) });
  }
  if (theme.courseColors && theme.courseColors.length) {
    /* courseColors 是色值数组，不是图片，这里不列为资产 */
  }
  return {
    format: THEME_FORMAT,
    version: THEME_VERSION,
    exportedAt: new Date().toISOString(),
    meta: theme.meta,
    assets: assets,
    theme: slim,
  };
}

export function themeFileName(theme: Theme): string {
  const safe = (theme.meta.name || 'theme').replace(/[\\/:*?"<>|\s]+/g, '-');
  return safe + THEME_EXT + '.json';
}

/**
 * 生成主题包文本。
 *
 * 这里只负责"内容是什么"，"怎么交到用户手上"交给 platform/saveFile
 * —— 浏览器和安卓 WebView 的落地方式完全不同，混在一起写就是
 * "点了导出没反应"那类 bug 的温床。
 *
 * 注意：写出的是**内存里**的 theme，图片此时是内嵌 data URI 形态。
 * 如果传进来的 theme 壁纸还是 `asset:<key>` 引用，包里就会是一张空图，
 * 所以这里明确拦一道。
 */
export function themeFileText(theme: Theme): { fileName: string; text: string; bytes: number } {
  const packable = isAssetRef(theme.wallpaper.custom)
    ? Object.assign({}, theme, {
      wallpaper: Object.assign({}, theme.wallpaper, { kind: 'none' as const, custom: '' }),
    })
    : theme;
  const text = JSON.stringify(buildThemeFile(packable), null, 2);
  return { fileName: themeFileName(theme), text: text, bytes: text.length };
}

/* --------------------------- 校验与归一化 --------------------------- */

const MODES: ModePref[] = ['light', 'dark', 'auto'];
const CARDS: CardStyle[] = ['solid', 'gradient', 'glass', 'outline'];
const DENSITIES: Density[] = ['compact', 'comfortable', 'cozy'];
const FONTS: FontKey[] = ['system', 'serif', 'mono', 'rounded'];

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function pick<T>(v: unknown, allowed: T[], fallback: T): T {
  return allowed.indexOf(v as T) >= 0 ? (v as T) : fallback;
}

export interface ValidateResult { ok: boolean; errors: string[]; warnings: string[]; theme?: Theme; }

export function validateTheme(raw: unknown): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['不是有效的主题文件'], warnings: warnings };
  }
  const obj = raw as Record<string, unknown>;
  let src = obj;
  if (obj.format) {
    if (obj.format !== THEME_FORMAT) {
      return { ok: false, errors: ['文件格式不是课表主题包（format 应为 ' + THEME_FORMAT + '）'], warnings: warnings };
    }
    const ver = num(obj.version, 0, 0, 999);
    if (ver > THEME_VERSION) warnings.push('主题包版本 (' + ver + ') 高于当前应用支持的版本 (' + THEME_VERSION + ')，部分设置可能被忽略');
    if (!obj.theme || typeof obj.theme !== 'object') return { ok: false, errors: ['主题包缺少 theme 字段'], warnings: warnings };
    src = obj.theme as Record<string, unknown>;
  }

  const base = defaultTheme();
  const metaRaw = (src.meta && typeof src.meta === 'object' ? src.meta : {}) as Record<string, unknown>;
  const wpRaw = (src.wallpaper && typeof src.wallpaper === 'object' ? src.wallpaper : {}) as Record<string, unknown>;

  const wallpaper: WallpaperState = {
    kind: pick(wpRaw.kind, ['none', 'preset', 'custom'] as const, 'none') as WallpaperState['kind'],
    presetId: str(wpRaw.presetId, base.wallpaper.presetId),
    custom: typeof wpRaw.custom === 'string' ? wpRaw.custom : '',
    original: typeof wpRaw.original === 'string' ? wpRaw.original : undefined,
    fit: pick(wpRaw.fit, ['cover', 'contain', 'repeat'] as const, 'cover') as WallpaperState['fit'],
    blur: num(wpRaw.blur, 0, 0, 40),
    scrim: num(wpRaw.scrim, 0, 0, 0.95),
  };

  if (wallpaper.kind === 'custom') {
    /*
     * 这里必须同时放行 `asset:<key>` 引用。
     *
     * 写盘时大图会被外置成引用（localStorage 只有 5 MB，一张壁纸就能吃满），
     * 而启动路径是"先同步读 localStorage → 再由 hydrateAssets 还原图片"。
     * 如果校验只认内嵌 data URI，那么每次冷启动都会在还原之前就把
     * kind 打成 'none'、custom 清空 —— 界面上就是"退出重进后背景没了"。
     */
    if (!isImageDataUri(wallpaper.custom) && !isAssetRef(wallpaper.custom)) {
      warnings.push('自定义壁纸数据缺失或不是内嵌图片，已回退为无壁纸');
      wallpaper.kind = 'none';
      wallpaper.custom = '';
    }
  }
  if (wallpaper.kind === 'preset' && !wallpaper.presetId) {
    wallpaper.kind = 'none';
  }

  const accentRaw = str(src.accent, base.accent);
  const accent = isHex(accentRaw) ? accentRaw : base.accent;
  if (!isHex(accentRaw)) warnings.push('主色 ' + accentRaw + ' 不是合法色值，已使用默认色');

  const lightBgRaw = str(src.lightBg, base.lightBg);
  const darkBgRaw = str(src.darkBg, base.darkBg);

  let courseColors: string[] = [];
  if (Array.isArray(src.courseColors)) {
    courseColors = (src.courseColors as unknown[]).filter(function (c) { return typeof c === 'string' && isHex(c); }) as string[];
    if (courseColors.length > 0 && courseColors.length < 12) {
      warnings.push('课程色板只有 ' + courseColors.length + ' 色（需 12 色），已改为按主色自动生成');
      courseColors = [];
    }
  }

  const theme: Theme = {
    meta: {
      id: str(metaRaw.id, 'imported-' + Date.now()),
      name: str(metaRaw.name, '导入的主题'),
      author: str(metaRaw.author, '未知'),
      description: str(metaRaw.description, ''),
      createdAt: str(metaRaw.createdAt, new Date().toISOString()),
    },
    modePref: pick(src.modePref, MODES, base.modePref),
    accent: accent,
    lightBg: isHex(lightBgRaw) ? lightBgRaw : base.lightBg,
    darkBg: isHex(darkBgRaw) ? darkBgRaw : base.darkBg,
    cardStyle: pick(src.cardStyle, CARDS, base.cardStyle),
    cardOpacity: num(src.cardOpacity, base.cardOpacity, 0.3, 1),
    courseSaturation: num(src.courseSaturation, base.courseSaturation, 0, 1.4),
    radius: num(src.radius, base.radius, 0, 34),
    font: pick(src.font, FONTS, base.font),
    fontScale: num(src.fontScale, base.fontScale, 0.85, 1.3),
    density: pick(src.density, DENSITIES, base.density),
    showTeacher: src.showTeacher === undefined ? base.showTeacher : !!src.showTeacher,
    colorBlind: src.colorBlind === undefined ? base.colorBlind : !!src.colorBlind,
    showDays: (function () {
      const n = num(src.showDays, 0, 0, 7);
      if (n === 5 || n === 6 || n === 7) return n;
      /* 旧主题只有 showWeekend 布尔值 */
      if (src.showWeekend !== undefined) return src.showWeekend ? 7 : 5;
      return base.showDays;
    })(),
    showWeekend: src.showWeekend === undefined ? base.showWeekend : !!src.showWeekend,
    panelAlpha: num(src.panelAlpha, base.panelAlpha, 0.3, 1),
    glassBlur: num(src.glassBlur, base.glassBlur, 0, 40),
    wallpaper: wallpaper,
    courseColors: courseColors,
  };

  if (errors.length) return { ok: false, errors: errors, warnings: warnings };
  return { ok: true, errors: [], warnings: warnings, theme: theme };
}

export async function parseThemeFile(file: File): Promise<{ theme: Theme; warnings: string[] }> {
  const text = await readFileAsText(file);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('文件不是合法的 JSON，可能不是主题包');
  }
  const r = validateTheme(json);
  if (!r.ok || !r.theme) throw new Error(r.errors.join('；'));
  /*
   * 主题包必须是自包含的：图片以 data URI 内嵌。
   * `asset:<key>` 只指向**本机**资产库，换台设备就是一张空图，
   * 所以导入时明确丢弃并给出提示，而不是留一个渲染不出来的壁纸。
   */
  if (isAssetRef(r.theme.wallpaper.custom)) {
    r.warnings.push('主题包里的壁纸是本机引用而非内嵌图片，已跳过；请重新导出一次主题包');
    r.theme = Object.assign({}, r.theme, {
      wallpaper: Object.assign({}, r.theme.wallpaper, { kind: 'none', custom: '' }),
    });
  }
  return { theme: r.theme, warnings: r.warnings };
}
