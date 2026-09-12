/** 内置壁纸：全部由 SVG 程序化生成，不依赖任何网络资源 */

function uri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function noiseFilter(id: string, freq: number, octaves: number): string {
  return '<filter id="' + id + '" x="0" y="0" width="100%" height="100%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="' + freq + '" numOctaves="' + octaves + '" stitchTiles="stitch"/>' +
    '<feColorMatrix type="saturate" values="0"/>' +
    '</filter>';
}

function blob(cx: number, cy: number, r: number, fill: string, opacity: number, blur: number): string {
  return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" opacity="' + opacity + '" filter="url(#soft' + blur + ')"/>';
}

function softFilters(): string {
  let s = '';
  const sizes = [60, 90, 140];
  for (const b of sizes) {
    s += '<filter id="soft' + b + '" x="-60%" y="-60%" width="220%" height="220%">' +
      '<feGaussianBlur stdDeviation="' + b + '"/></filter>';
  }
  return s;
}

function svgWrap(w: number, h: number, body: string, defs: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' + defs + softFilters() + '</defs>' + body + '</svg>';
}

export interface WallpaperPreset {
  id: string;
  name: string;
  dark: boolean;
  make: () => string;
}

export const WALLPAPERS: WallpaperPreset[] = [
  {
    id: 'aurora', name: '极光', dark: false,
    make: function () {
      const defs = '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#EEF3FF"/><stop offset="1" stop-color="#FDF0F6"/></linearGradient>';
      const body = '<rect width="1000" height="1400" fill="url(#bg)"/>' +
        blob(220, 300, 260, '#7FA8FF', 0.62, 140) +
        blob(820, 200, 220, '#C9A7FF', 0.5, 140) +
        blob(500, 760, 320, '#8FE0D2', 0.42, 140) +
        blob(880, 1120, 260, '#FFC3D8', 0.45, 140);
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
  {
    id: 'neon', name: '霓虹', dark: true,
    make: function () {
      const defs = '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#0A0C16"/><stop offset="1" stop-color="#140E22"/></linearGradient>' +
        noiseFilter('nz', 0.9, 3);
      const body = '<rect width="1000" height="1400" fill="url(#bg)"/>' +
        blob(200, 260, 240, '#6D3BFF', 0.55, 140) +
        blob(830, 430, 200, '#00D4FF', 0.38, 140) +
        blob(430, 1080, 300, '#FF2E9A', 0.32, 140) +
        '<rect width="1000" height="1400" filter="url(#nz)" opacity="0.055"/>';
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
  {
    id: 'paper', name: '纸纹', dark: false,
    make: function () {
      const defs = '<linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">' +
        '<stop offset="0" stop-color="#FBF6EC"/><stop offset="1" stop-color="#F3EADA"/></linearGradient>' +
        noiseFilter('paper', 0.75, 4);
      const body = '<rect width="1000" height="1400" fill="url(#bg)"/>' +
        '<rect width="1000" height="1400" filter="url(#paper)" opacity="0.09"/>' +
        blob(760, 240, 300, '#E8D9BE', 0.35, 140);
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
  {
    id: 'grid', name: '网格纸', dark: false,
    make: function () {
      const defs = '<pattern id="g" width="28" height="28" patternUnits="userSpaceOnUse">' +
        '<path d="M28 0 L0 0 0 28" fill="none" stroke="#9DB4D0" stroke-width="0.8" opacity="0.5"/></pattern>';
      const body = '<rect width="1000" height="1400" fill="#F7FAFF"/>' +
        '<rect width="1000" height="1400" fill="url(#g)"/>' +
        blob(240, 1080, 300, '#BFE0FF', 0.55, 140);
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
  {
    id: 'sakura', name: '樱花', dark: false,
    make: function () {
      const defs = '<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">' +
        '<stop offset="0" stop-color="#FFF3F6"/><stop offset="1" stop-color="#FFE6EF"/></linearGradient>';
      let petals = '';
      const pts = [[180, 220, -20], [700, 380, 35], [420, 700, 10], [860, 900, -45], [260, 1150, 25], [640, 1240, -10]];
      for (const p of pts) {
        petals += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="86" ry="52" fill="#FFB7CE" opacity="0.5" transform="rotate(' + p[2] + ' ' + p[0] + ' ' + p[1] + ')" filter="url(#soft90)"/>';
      }
      const body = '<rect width="1000" height="1400" fill="url(#bg)"/>' + petals +
        blob(500, 140, 320, '#FFFFFF', 0.5, 140);
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
  {
    id: 'ocean', name: '深海', dark: true,
    make: function () {
      const defs = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#06131F"/><stop offset="1" stop-color="#0A2438"/></linearGradient>' +
        noiseFilter('nz2', 0.85, 3);
      const body = '<rect width="1000" height="1400" fill="url(#bg)"/>' +
        blob(300, 380, 300, '#1E7FA8', 0.5, 140) +
        blob(820, 900, 340, '#0F5C7A', 0.45, 140) +
        blob(500, 1250, 260, '#2AA0A8', 0.28, 140) +
        '<rect width="1000" height="1400" filter="url(#nz2)" opacity="0.05"/>';
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
  {
    id: 'ink', name: '水墨', dark: false,
    make: function () {
      const defs = '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F0F1F3"/></linearGradient>' +
        noiseFilter('ink', 0.5, 5);
      const body = '<rect width="1000" height="1400" fill="url(#bg)"/>' +
        blob(220, 1080, 360, '#9AA3AE', 0.3, 140) +
        blob(820, 260, 260, '#B9C2CC', 0.28, 140) +
        '<rect width="1000" height="1400" filter="url(#ink)" opacity="0.045"/>';
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
];


/* ------------------------- 工业向壁纸 ------------------------- */

WALLPAPERS.push(
  {
    id: 'blueprint', name: '图纸', dark: true,
    make: function () {
      const defs = '<pattern id="bp" width="40" height="40" patternUnits="userSpaceOnUse">' +
        '<path d="M40 0 L0 0 0 40" fill="none" stroke="#1E5F8C" stroke-width="0.7" opacity="0.55"/></pattern>' +
        '<pattern id="bp5" width="200" height="200" patternUnits="userSpaceOnUse">' +
        '<path d="M200 0 L0 0 0 200" fill="none" stroke="#2C86C4" stroke-width="1.1" opacity="0.5"/></pattern>';
      const body = '<rect width="1000" height="1400" fill="#08151F"/>' +
        '<rect width="1000" height="1400" fill="url(#bp)"/>' +
        '<rect width="1000" height="1400" fill="url(#bp5)"/>' +
        '<rect x="60" y="120" width="880" height="1160" fill="none" stroke="#2C86C4" stroke-width="1.4" opacity="0.35"/>' +
        blob(820, 180, 240, '#12507A', 0.4, 140);
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
);

WALLPAPERS.push(
  {
    id: 'carbon', name: '碳纤维', dark: true,
    make: function () {
      const defs = '<pattern id="cf" width="16" height="16" patternUnits="userSpaceOnUse">' +
        '<rect width="16" height="16" fill="#15171B"/>' +
        '<path d="M0 0 L8 8 L0 16 Z" fill="#1D2026"/>' +
        '<path d="M16 0 L8 8 L16 16 Z" fill="#101216"/></pattern>' +
        noiseFilter('cfn', 0.9, 2);
      const body = '<rect width="1000" height="1400" fill="url(#cf)"/>' +
        '<rect width="1000" height="1400" filter="url(#cfn)" opacity="0.05"/>' +
        blob(220, 320, 300, '#2B4A6F', 0.28, 140);
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
);

WALLPAPERS.push(
  {
    id: 'dots', name: '点阵', dark: false,
    make: function () {
      const defs = '<pattern id="dt" width="22" height="22" patternUnits="userSpaceOnUse">' +
        '<circle cx="2" cy="2" r="1.1" fill="#9AA4B2" opacity="0.55"/></pattern>';
      const body = '<rect width="1000" height="1400" fill="#F7F8FA"/>' +
        '<rect width="1000" height="1400" fill="url(#dt)"/>';
      return uri(svgWrap(1000, 1400, body, defs));
    },
  },
);

export function wallpaperSrc(id: string): string {
  const w = WALLPAPERS.find(function (x) { return x.id === id; });
  return w ? w.make() : '';
}
