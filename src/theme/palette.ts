import { accessiblePalette, coursePalette, mix } from './color';
import { resolveDark, type Theme } from './tokens';

/** 与 resolveTokens 中的推导保持一致：JS 侧也要拿到课程色的真实色值（内联样式用） */
export function resolvePalette(theme: Theme, systemDark: boolean): string[] {
  if (theme.courseColors && theme.courseColors.length >= 12) return theme.courseColors;
  const dark = resolveDark(theme.modePref, systemDark);
  if (theme.colorBlind) return accessiblePalette(dark);
  const accent = dark ? mix(theme.accent, '#FFFFFF', 0.16) : theme.accent;
  return coursePalette(accent, dark, theme.courseSaturation, 12);
}

export function courseColor(palette: string[], index: number): string {
  return palette[index % palette.length] || palette[0];
}
