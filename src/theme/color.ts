/** 颜色工具：所有取色都来自这里，保证主题推导一致 */

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(c: RGB): string {
  const f = function (v: number) { return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'); };
  return '#' + f(c.r) + f(c.g) + f(c.b);
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a); const y = hexToRgb(b);
  return rgbToHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
  });
}

export function withAlpha(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + Number(alpha.toFixed(3)) + ')';
}

export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  const f = function (v: number) {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function readableOn(hex: string): string {
  return luminance(hex) > 0.55 ? '#14161A' : '#FFFFFF';
}

export function rgbToHsl(c: RGB): HSL {
  const r = c.r / 255; const g = c.g / 255; const b = c.b / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  if (ss === 0) { const v = Math.round(ll * 255); return { r: v, g: v, b: v }; }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hue = function (t: number) {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: Math.round(hue(hh + 1 / 3) * 255),
    g: Math.round(hue(hh) * 255),
    b: Math.round(hue(hh - 1 / 3) * 255),
  };
}

export function hslToHex(h: number, s: number, l: number): string { return rgbToHex(hslToRgb(h, s, l)); }
export function hexToHsl(hex: string): HSL { return rgbToHsl(hexToRgb(hex)); }

export function adjust(hex: string, dl: number, ds: number): string {
  const c = hexToHsl(hex);
  return hslToHex(c.h, clamp(c.s + ds, 0, 100), clamp(c.l + dl, 0, 100));
}

/**
 * 由主色推导 12 色课程色板：
 * 色相在主色基础上均匀展开，饱和度与明度统一 —— 保证放在一起好看、深浅色都清晰。
 */
export function coursePalette(accent: string, dark: boolean, saturationScale: number, count: number): string[] {
  const base = hexToHsl(accent);
  const sat = clamp(base.s * (saturationScale < 0.2 ? saturationScale : 1) * (dark ? 0.92 : 1), 6, 88);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const h = base.h + (360 / count) * i;
    const jitter = (i % 2 === 0 ? 1 : -1) * 3;
    out.push(hslToHex(h, sat * saturationScale, (dark ? 64 : 56) + jitter));
  }
  return out;
}

/**
 * 色盲友好色板：4 个色相 × 3 档明度。
 * 常见的红绿色盲主要损失的是"色相"分辨力，所以这里刻意让明度也拉开差距 ——
 * 即使完全转成灰度，12 个颜色依然能两两区分。
 */
export function accessiblePalette(dark: boolean): string[] {
  const hues = [210, 25, 150, 300];
  const lightL = dark ? [72, 58, 80] : [38, 52, 66];
  const out: string[] = [];
  for (let level = 0; level < 3; level++) {
    for (let h = 0; h < 4; h++) {
      out.push(hslToHex(hues[h], dark ? 62 : 68, lightL[level]));
    }
  }
  return out;
}

export function isHex(v: string): boolean { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim()); }
