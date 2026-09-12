import { accessiblePalette, coursePalette, mix, readableOn, withAlpha } from './color';

export type ModePref = 'light' | 'dark' | 'auto';
/** line = 白底 + 左侧色条 + 描边（工业化默认）；其余为更活泼的备选 */
export type CardStyle = 'line' | 'solid' | 'gradient' | 'glass' | 'outline';
export type Density = 'compact' | 'comfortable' | 'cozy';
export type FontKey = 'system' | 'serif' | 'mono' | 'rounded';

export type WallpaperFit = 'cover' | 'contain' | 'repeat';

export interface WallpaperState {
  kind: 'none' | 'preset' | 'custom';
  presetId: string;
  /** 剪裁后的成品图 */
  custom: string;
  /** 原图，只存在本机，用于重新剪裁；导出主题包时会剔除 */
  original?: string;
  /** 填充屏幕（裁切）/ 完整显示（留边）/ 平铺 */
  fit: WallpaperFit;
  blur: number;
  scrim: number;
}

export interface Theme {
  meta: { id: string; name: string; author: string; description: string; createdAt: string };
  modePref: ModePref;
  accent: string;
  lightBg: string;
  darkBg: string;
  cardStyle: CardStyle;
  cardOpacity: number;
  courseSaturation: number;
  radius: number;
  font: FontKey;
  fontScale: number;
  density: Density;
  showTeacher: boolean;
  /** 每周显示几天：5（工作日）/ 6 / 7。窄屏上少显示几天能让每列宽很多 */
  showDays: number;
  /** 色盲友好：课程色改为「色相 × 明度」双维度区分 */
  colorBlind: boolean;
  /** @deprecated 由 showDays 取代，保留只为读旧主题 */
  showWeekend: boolean;
  panelAlpha: number;
  glassBlur: number;
  wallpaper: WallpaperState;
  courseColors: string[];
}

/* 工业审美下密度整体收窄：一屏能看到更多课 */
export const DENSITY_ROW: Record<Density, number> = { compact: 56, comfortable: 68, cozy: 84 };
export const DENSITY_GAP: Record<Density, number> = { compact: 3, comfortable: 4, cozy: 6 };

export function defaultTheme(): Theme {
  return {
    meta: { id: 'default', name: '默认', author: '你', description: '工业风起点', createdAt: new Date().toISOString() },
    modePref: 'light',
    accent: '#1677FF',
    lightBg: '#F4F5F7',
    darkBg: '#111318',
    cardStyle: 'line',
    cardOpacity: 1,
    courseSaturation: 0.92,
    radius: 4,
    font: 'system',
    fontScale: 1,
    density: 'comfortable',
    showTeacher: true,
    showDays: 7,
    colorBlind: false,
    showWeekend: true,
    panelAlpha: 1,
    glassBlur: 0,
    wallpaper: { kind: 'none', presetId: 'blueprint', custom: '', fit: 'cover', blur: 0, scrim: 0 },
    courseColors: [],
  };
}

export function resolveDark(pref: ModePref, systemDark: boolean): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return systemDark;
}

function fontStack(f: FontKey): string {
  if (f === 'serif') return 'var(--font-serif)';
  if (f === 'mono') return 'var(--font-mono)';
  if (f === 'rounded') return 'var(--font-rounded)';
  return 'var(--font-system)';
}

/** 主题 -> CSS 变量表。所有颜色都在这里推导，保证任意组合都不会脏 */
export function resolveTokens(theme: Theme, systemDark: boolean): Record<string, string> {
  const dark = resolveDark(theme.modePref, systemDark);
  const bg = dark ? theme.darkBg : theme.lightBg;
  const surface = dark ? mix(bg, '#FFFFFF', 0.07) : mix(bg, '#FFFFFF', 0.94);
  const surface2 = dark ? mix(bg, '#FFFFFF', 0.13) : mix(bg, '#FFFFFF', 0.55);
  const text = dark ? mix('#FFFFFF', bg, 0.10) : mix('#14161A', bg, 0.04);
  const textMuted = mix(text, bg, 0.46);
  const accent = dark ? mix(theme.accent, '#FFFFFF', 0.14) : theme.accent;
  /* 工业化：描边用实色，不用半透明，保证 1px 线在任何背景上都干净 */
  const border = dark ? mix(bg, '#FFFFFF', 0.16) : mix(bg, '#0B0D12', 0.10);
  const borderStrong = dark ? mix(bg, '#FFFFFF', 0.28) : mix(bg, '#0B0D12', 0.20);
  const palette = theme.courseColors && theme.courseColors.length >= 12
    ? theme.courseColors
    : (theme.colorBlind ? accessiblePalette(dark) : coursePalette(accent, dark, theme.courseSaturation, 12));

  /* 阴影一律压到最轻，层次交给描边 */
  const shadow = dark ? '0 1px 2px rgba(0,0,0,.45)' : '0 1px 2px rgba(0,0,0,.04)';
  const shadowFloat = dark ? '0 8px 24px rgba(0,0,0,.6)' : '0 8px 24px rgba(0,0,0,.12)';

  const scale = theme.fontScale;
  const r = theme.radius;
  const vars: Record<string, string> = {
    '--c-bg': bg,
    '--c-surface': surface,
    '--c-surface-2': surface2,
    '--c-panel': withAlpha(surface, theme.panelAlpha),
    '--c-text': text,
    '--c-text-muted': textMuted,
    '--c-border': border,
    '--c-border-strong': borderStrong,
    '--c-accent': accent,
    '--c-on-accent': readableOn(accent),
    '--c-today': withAlpha(accent, dark ? 0.14 : 0.07),
    '--c-danger': dark ? '#F76965' : '#F53F3F',
    '--shadow-card': shadow,
    '--shadow-float': shadowFloat,
    '--font': fontStack(theme.font),
    '--r-card': r + 'px',
    '--r-panel': (r + 2) + 'px',
    '--r-btn': r + 'px',
    '--r-tag': Math.max(2, r - 1) + 'px',
    '--card-opacity': String(theme.cardOpacity),
    '--panel-alpha': String(theme.panelAlpha),
    '--glass-blur': theme.glassBlur + 'px',
    '--row-h': DENSITY_ROW[theme.density] + 'px',
    '--gap': DENSITY_GAP[theme.density] + 'px',
    '--wp-blur': theme.wallpaper.blur + 'px',
    '--wp-scrim': String(theme.wallpaper.scrim),
    '--fs-xs': Math.round(11 * scale) + 'px',
    '--fs-sm': Math.round(12 * scale) + 'px',
    '--fs-md': Math.round(13.5 * scale) + 'px',
    '--fs-lg': Math.round(16 * scale) + 'px',
    '--fs-xl': Math.round(20 * scale) + 'px',
    '--fs-2xl': Math.round(28 * scale) + 'px',
  };

  for (let i = 0; i < 12; i++) {
    const c = palette[i] || accent;
    vars['--c-course-' + (i + 1)] = c;
    vars['--c-course-' + (i + 1) + '-soft'] = withAlpha(c, dark ? 0.28 : 0.16);
    vars['--c-course-' + (i + 1) + '-on'] = readableOn(c);
  }

  vars['--wp-image'] = 'none';
  return vars;
}

export function applyTokens(vars: Record<string, string>): void {
  const root = document.documentElement;
  for (const k in vars) root.style.setProperty(k, vars[k]);
}
