import { defaultTheme, type Theme } from './tokens';

function t(partial: Partial<Theme>): Theme {
  const base = defaultTheme();
  const merged: Theme = Object.assign({}, base, partial);
  merged.meta = Object.assign({}, base.meta, partial.meta || {});
  merged.wallpaper = Object.assign({}, base.wallpaper, partial.wallpaper || {});
  return merged;
}

export interface ThemePreset { id: string; name: string; hint: string; build: () => Theme; }

/* 前 6 套走工业化路线（小圆角 / 描边分层 / 克制配色），后 2 套留作人格化对照 */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'workbench', name: '工作台', hint: '大厂蓝 · 色条卡',
    build: function () {
      return t({
        meta: { id: 'workbench', name: '工作台', author: '内置', description: '默认的工业化起点', createdAt: '' },
        accent: '#1677FF', lightBg: '#F4F5F7', darkBg: '#111318',
        cardStyle: 'line', courseSaturation: 0.92, radius: 4,
        density: 'comfortable', panelAlpha: 1, glassBlur: 0,
        wallpaper: { kind: 'none', presetId: 'dots', custom: '', fit: 'cover', blur: 0, scrim: 0 },
      });
    },
  },
  {
    id: 'graphite', name: '石墨', hint: '近单色 · 高密度',
    build: function () {
      return t({
        meta: { id: 'graphite', name: '石墨', author: '内置', description: '去掉颜色，只剩结构', createdAt: '' },
        accent: '#4E5969', lightBg: '#FFFFFF', darkBg: '#0E0F12',
        cardStyle: 'line', courseSaturation: 0.16, radius: 2,
        density: 'compact', showTeacher: false, panelAlpha: 1, glassBlur: 0,
        wallpaper: { kind: 'none', presetId: 'dots', custom: '', fit: 'cover', blur: 0, scrim: 0 },
      });
    },
  },
  {
    id: 'terminal', name: '终端', hint: '深色 · 等宽数字',
    build: function () {
      return t({
        meta: { id: 'terminal', name: '终端', author: '内置', description: '给整天盯屏幕的人', createdAt: '' },
        accent: '#23C343', lightBg: '#F2F3F5', darkBg: '#0B0D10',
        modePref: 'dark', cardStyle: 'line', courseSaturation: 0.7, radius: 2,
        font: 'mono', density: 'compact', showTeacher: false,
        panelAlpha: 0.86, glassBlur: 10,
        wallpaper: { kind: 'preset', presetId: 'blueprint', custom: '', fit: 'cover', blur: 0, scrim: 0.34 },
      });
    },
  },
  {
    id: 'tdesign', name: '腾讯蓝', hint: '克制 · 直角',
    build: function () {
      return t({
        meta: { id: 'tdesign', name: '腾讯蓝', author: '内置', description: '标准中后台审美', createdAt: '' },
        accent: '#0052D9', lightBg: '#F3F3F3', darkBg: '#181818',
        cardStyle: 'line', courseSaturation: 0.78, radius: 3,
        density: 'compact', panelAlpha: 1, glassBlur: 0,
        wallpaper: { kind: 'none', presetId: 'dots', custom: '', fit: 'cover', blur: 0, scrim: 0 },
      });
    },
  },
  {
    id: 'safety', name: '工业橙', hint: '警示色 · 点阵底',
    build: function () {
      return t({
        meta: { id: 'safety', name: '工业橙', author: '内置', description: '像一块现场看板', createdAt: '' },
        accent: '#E37318', lightBg: '#F5F6F8', darkBg: '#14161A',
        cardStyle: 'line', courseSaturation: 0.85, radius: 3,
        density: 'comfortable', panelAlpha: 0.94, glassBlur: 8,
        wallpaper: { kind: 'preset', presetId: 'dots', custom: '', fit: 'cover', blur: 0, scrim: 0.5 },
      });
    },
  },
  {
    id: 'blueprint', name: '蓝图', hint: '工程图纸 · 深蓝',
    build: function () {
      return t({
        meta: { id: 'blueprint', name: '蓝图', author: '内置', description: '工程制图的底色', createdAt: '' },
        accent: '#2C86C4', lightBg: '#EEF2F6', darkBg: '#08151F',
        modePref: 'dark', cardStyle: 'line', courseSaturation: 0.8, radius: 3,
        density: 'compact', panelAlpha: 0.8, glassBlur: 14,
        wallpaper: { kind: 'preset', presetId: 'blueprint', custom: '', fit: 'cover', blur: 0, scrim: 0.16 },
      });
    },
  },
  {
    id: 'neon', name: '暗夜', hint: '深色 · 渐变卡',
    build: function () {
      return t({
        meta: { id: 'neon', name: '暗夜', author: '内置', description: '晚自习的配色', createdAt: '' },
        accent: '#7C5CFF', lightBg: '#F3F1FA', darkBg: '#0A0C16',
        modePref: 'dark', cardStyle: 'gradient', courseSaturation: 1.1, radius: 6,
        density: 'comfortable', panelAlpha: 0.7, glassBlur: 16,
        wallpaper: { kind: 'preset', presetId: 'neon', custom: '', fit: 'cover', blur: 0, scrim: 0.3 },
      });
    },
  },
  {
    id: 'sakura', name: '樱花', hint: '柔和粉 · 大圆角',
    build: function () {
      return t({
        meta: { id: 'sakura', name: '樱花', author: '内置', description: '留一个不那么工业的选项', createdAt: '' },
        accent: '#E36A9B', lightBg: '#FFF4F8', darkBg: '#17111A',
        cardStyle: 'glass', cardOpacity: 0.85, courseSaturation: 0.9, radius: 12,
        font: 'rounded', density: 'cozy', panelAlpha: 0.82, glassBlur: 18,
        wallpaper: { kind: 'preset', presetId: 'sakura', custom: '', fit: 'cover', blur: 0, scrim: 0.1 },
      });
    },
  },
];

export function presetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find(function (p) { return p.id === id; });
}
