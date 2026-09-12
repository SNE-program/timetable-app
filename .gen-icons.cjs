/* 用 123jie.png 生成全部应用图标与启动图。
   自己写 PNG 解码（zlib inflate + 反滤波）与缩放（面积平均），不依赖图形库。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- PNG 解码（限 8 位 RGBA） ---------------- */
function decodePNG(file) {
  const b = fs.readFileSync(file);
  if (b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('不是 PNG');
  let off = 8;
  let W = 0, H = 0, depth = 0, color = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString('ascii');
    const data = b.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || color !== 6) throw new Error('只支持 8 位 RGBA，当前 depth=' + depth + ' color=' + color);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * 4;
  const out = Buffer.alloc(W * H * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const bb = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + bb) & 255;
      else if (ft === 3) v = (v + ((a + bb) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + bb - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
        v = (v + pr) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w: W, h: H, data: out };
}

/* ---------------- 面积平均缩放（预乘 alpha） ---------------- */
function resample(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = y * sh / dh, sy1 = (y + 1) * sh / dh;
    for (let x = 0; x < dw; x++) {
      const sx0 = x * sw / dw, sx1 = (x + 1) * sw / dw;
      let ra = 0, ga = 0, ba = 0, aa = 0, ws = 0;
      for (let sy = Math.floor(sy0); sy < Math.min(sh, Math.ceil(sy1)); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(sx0); sx < Math.min(sw, Math.ceil(sx1)); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * sw + sx) * 4;
          const al = src[i + 3] / 255;
          ra += src[i] * al * w; ga += src[i + 1] * al * w; ba += src[i + 2] * al * w;
          aa += al * w; ws += w;
        }
      }
      const o = (y * dw + x) * 4;
      out[o + 3] = Math.round(aa / ws * 255);
      if (aa > 0) {
        out[o] = Math.min(255, Math.round(ra / aa));
        out[o + 1] = Math.min(255, Math.round(ga / aa));
        out[o + 2] = Math.min(255, Math.round(ba / aa));
      }
    }
  }
  return out;
}

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 合成工具 ---------------- */
function place(dst, dw, dh, src, sw, sh, x0, y0) {
  for (let y = 0; y < sh; y++) {
    const ty = Math.round(y0) + y;
    if (ty < 0 || ty >= dh) continue;
    for (let x = 0; x < sw; x++) {
      const tx = Math.round(x0) + x;
      if (tx < 0 || tx >= dw) continue;
      const si = (y * sw + x) * 4;
      const a = src[si + 3] / 255;
      if (a <= 0) continue;
      const di = (ty * dw + tx) * 4;
      dst[di] = Math.round(dst[di] * (1 - a) + src[si] * a);
      dst[di + 1] = Math.round(dst[di + 1] * (1 - a) + src[si + 1] * a);
      dst[di + 2] = Math.round(dst[di + 2] * (1 - a) + src[si + 2] * a);
      dst[di + 3] = Math.max(dst[di + 3], Math.round(a * 255));
    }
  }
}
function circleMask(buf, W, H) {
  const R = Math.min(W, H) / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2);
      const cover = Math.min(1, Math.max(0, R - d + 0.5));
      buf[(y * W + x) * 4 + 3] = Math.round(buf[(y * W + x) * 4 + 3] * cover);
    }
  }
}
function solid(W, H, c) {
  const b = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { b[i * 4] = c[0]; b[i * 4 + 1] = c[1]; b[i * 4 + 2] = c[2]; b[i * 4 + 3] = 255; }
  return b;
}

/* ---------------- 主流程 ---------------- */
const raw0 = decodePNG('123jie.png');
console.log('源图: ' + raw0.w + 'x' + raw0.h);

/**
 * 先把源图**居中裁成正方形**。
 *
 * 图标管线后面一律按正方形处理（自适应图标的前景/背景都是方的）；
 * 以前是直接把源图拉伸成方的 —— 封面只要不是正方形，图案就会被压扁，
 * 而"被压扁"这种事在手机桌面上只有用户看得出来。
 */
const SIDE = Math.min(raw0.w, raw0.h);
const src = SIDE === raw0.w && SIDE === raw0.h ? raw0 : {
  w: SIDE, h: SIDE,
  data: (function () {
    const out = Buffer.alloc(SIDE * SIDE * 4);
    const ox = Math.floor((raw0.w - SIDE) / 2);
    const oy = Math.floor((raw0.h - SIDE) / 2);
    for (let y = 0; y < SIDE; y++) {
      raw0.data.copy(out, y * SIDE * 4, ((y + oy) * raw0.w + ox) * 4, ((y + oy) * raw0.w + ox + SIDE) * 4);
    }
    return out;
  })(),
};
if (src.w !== raw0.w || src.h !== raw0.h) {
  console.log('源图不是正方形，已居中裁成 ' + SIDE + 'x' + SIDE);
}

/**
 * 图标底色。
 *
 * 曾经用过纯白，装到手机上很跳 —— 原因是源图外圈本身就是中性灰
 * （实测外侧 3% 平均 rgb(106,107,115) ≈ #6A6B73），而且 91% 的像素带
 * alpha 217 的半透明，底色会直接从画面里透出来。白底等于在一块灰边图案
 * 外面又套了一圈白环。
 *
 * 换成同色系的深灰之后，外圈和图案是一块完整的砖，不会互相打架。
 * 想调色只改这一行。
 */
const BG = [47, 50, 55];   /* #2F3237 */
const BG_HEX = '#' + BG.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('').toUpperCase();

/* 取四角平均色，只做日志参考 */
function cornerColor(d) {
  const s = 12; let r = 0, g = 0, b = 0, n = 0;
  const pts = [[0, 0], [d.w - s, 0], [0, d.h - s], [d.w - s, d.h - s]];
  for (const p of pts) {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = ((p[1] + y) * d.w + (p[0] + x)) * 4;
      if (d.data[i + 3] < 200) continue;
      r += d.data[i]; g += d.data[i + 1]; b += d.data[i + 2]; n++;
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [30, 120, 255];
}
console.log('源图角落采样: rgb(' + cornerColor(src).join(',') + ')   图标底色: ' + BG_HEX);

/**
 * 封面**外圈**（最外 8%）的平均色。
 *
 * 自适应图标上，图案只占中间 70%，外面那一圈全是垫底色 ——
 * 所以垫底色必须跟封面外圈同色系，否则就是"图案外面套了一圈别的颜色"。
 * 这里把实测值打出来（顺带生成三种做法的对照图），换封面的人一眼能判断要不要调 BG。
 */
function ringColor(d) {
  const s = Math.max(4, Math.round(d.w * 0.08));
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  const push = function (x, y) {
    const i = (y * d.w + x) * 4;
    const al = d.data[i + 3] / 255;
    if (al <= 0.05) return;
    r += d.data[i] * al; g += d.data[i + 1] * al; b += d.data[i + 2] * al; a += al; n++;
  };
  for (let y = 0; y < s; y++) for (let x = 0; x < d.w; x++) { push(x, y); push(x, d.h - 1 - y); }
  for (let x = 0; x < s; x++) for (let y = 0; y < d.h; y++) { push(x, y); push(d.w - 1 - x, y); }
  if (!n || a <= 0) return null;
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a)];
}
const RING = ringColor(src);
if (RING) {
  const diff = Math.max(Math.abs(RING[0] - BG[0]), Math.abs(RING[1] - BG[1]), Math.abs(RING[2] - BG[2]));
  console.log('封面外圈平均色: rgb(' + RING.join(',') + ')   与垫底色相差 ' + diff
    + (diff > 40 ? '   ← 差得较多：图案外圈可能和垫底色打架，看 shots/icon-appearance-options.png' : '   ← 同色系'));
}

/*
 * 高分辨率基准：后面所有尺寸都从它缩。
 *
 * 上限 992，但**绝不放大源图** —— 封面是 520 的话，先放大到 992 再缩回 192，
 * 中间那次插值只会让成品更糊。基准等于源图尺寸时是恒等变换，一点损失都没有。
 */
const BASE = Math.min(992, Math.max(64, SIDE));
const base = resample(src.data, src.w, src.h, BASE, BASE);
console.log('生成基准: ' + BASE + 'x' + BASE + (BASE === SIDE ? '（与源图同尺寸，无插值损失）' : '（源图更大，缩到 992）'));

/**
 * 把半透明像素压到实色底上。
 *
 * 源图没有全透明像素，但有 91% 是 alpha 217 —— 不压平的话，
 * 圆形/方形图标在桌面上会直接透出壁纸，观感完全不可控。
 */
function flatten(buf, W, H, c) {
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = buf[i * 4 + 3] / 255;
    out[i * 4] = Math.round(buf[i * 4] * a + c[0] * (1 - a));
    out[i * 4 + 1] = Math.round(buf[i * 4 + 1] * a + c[1] * (1 - a));
    out[i * 4 + 2] = Math.round(buf[i * 4 + 2] * a + c[2] * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return out;
}
const flat = flatten(base, BASE, BASE, BG);

const RES = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
const DENS = [
  { dir: 'mipmap-mdpi', icon: 48, fg: 108 },
  { dir: 'mipmap-hdpi', icon: 72, fg: 162 },
  { dir: 'mipmap-xhdpi', icon: 96, fg: 216 },
  { dir: 'mipmap-xxhdpi', icon: 144, fg: 324 },
  { dir: 'mipmap-xxxhdpi', icon: 192, fg: 432 },
];
let n = 0;
for (const d of DENS) {
  const dir = path.join(RES, d.dir);
  fs.mkdirSync(dir, { recursive: true });

  /* 方形图标：压平后铺满，不再透出壁纸 */
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'),
    encodePNG(d.icon, d.icon, resample(flat, BASE, BASE, d.icon, d.icon)));
  n++;

  /* 圆形图标：先缩再套圆形遮罩 */
  const r1 = resample(flat, BASE, BASE, d.icon, d.icon);
  circleMask(r1, d.icon, d.icon);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), encodePNG(d.icon, d.icon, r1));
  n++;

  /* 自适应前景：透明底 + 图案缩到 70% 居中。
     留白处会露出 ic_launcher_background，所以两者必须是同一个颜色，
     否则又会出现"图案外面套一圈别的颜色"—— 那正是纯白底难看的原因。 */
  const F = d.fg;
  const fgBuf = Buffer.alloc(F * F * 4);
  const gs = Math.round(F * 0.70);
  place(fgBuf, F, F, resample(flat, BASE, BASE, gs, gs), gs, gs, (F - gs) / 2, (F - gs) / 2);
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), encodePNG(F, F, fgBuf));
  n++;
}

/* 启动图：底色 + 居中的图标 */
const SPLASH = [
  ['drawable-port-mdpi', 320, 480], ['drawable-port-hdpi', 480, 800], ['drawable-port-xhdpi', 640, 960],
  ['drawable-port-xxhdpi', 960, 1440], ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320], ['drawable-land-hdpi', 800, 480], ['drawable-land-xhdpi', 960, 640],
  ['drawable-land-xxhdpi', 1440, 960], ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable', 480, 320],
];
for (const s of SPLASH) {
  const [dir, W, H] = s;
  const dd = path.join(RES, dir);
  fs.mkdirSync(dd, { recursive: true });
  const buf = solid(W, H, BG);
  const gs = Math.round(Math.min(W, H) * 0.36);
  place(buf, W, H, resample(flat, BASE, BASE, gs, gs), gs, gs, (W - gs) / 2, (H - gs) / 2);
  fs.writeFileSync(path.join(dd, 'splash.png'), encodePNG(W, H, buf));
  n++;
}

/* 自适应图标背景色必须跟底色一致 */
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">' + BG_HEX + '</color>\n</resources>\n');

/* 预览图 */
const PV = path.join(__dirname, 'shots');
fs.mkdirSync(PV, { recursive: true });
const S = 512;
fs.writeFileSync(path.join(PV, 'icon-preview.png'), encodePNG(S, S, resample(flat, BASE, BASE, S, S)));
const rp = resample(flat, BASE, BASE, S, S); circleMask(rp, S, S);
fs.writeFileSync(path.join(PV, 'icon-round.png'), encodePNG(S, S, rp));
const fp = Buffer.alloc(S * S * 4);
const fgs = Math.round(S * 0.70);
place(fp, S, S, resample(flat, BASE, BASE, fgs, fgs), fgs, fgs, (S - fgs) / 2, (S - fgs) / 2);
fs.writeFileSync(path.join(PV, 'icon-foreground.png'), encodePNG(S, S, fp));
const sp = solid(S, S, BG);
const sps = Math.round(S * 0.36);
place(sp, S, S, resample(flat, BASE, BASE, sps, sps), sps, sps, (S - sps) / 2, (S - sps) / 2);
fs.writeFileSync(path.join(PV, 'splash-preview.png'), encodePNG(S, S, sp));

/* 底色候选对照图：把几个候选色并排画出来，直接看哪个顺眼。
   真机上自适应图标 = 底色铺满 + 图案缩到 70% 居中 + 系统遮罩，
   所以这里也按同样的方式合成，而不是简单地铺一层底色。 */
const CANDIDATES = [
  ['#FFFFFF', [255, 255, 255]],
  ['#E8E9EB', [232, 233, 235]],
  ['#6A6B73', [106, 107, 115]],
  ['#3A3D42', [58, 61, 66]],
  ['#2F3237', [47, 50, 55]],
  ['#1F2126', [31, 33, 38]],
];
const TS = 220;
const sheet = Buffer.alloc(TS * CANDIDATES.length * TS * 4);
for (let ci = 0; ci < CANDIDATES.length; ci++) {
  const c = CANDIDATES[ci][1];
  const tile = solid(TS, TS, c);
  const tgs = Math.round(TS * 0.70);
  const fb = flatten(resample(src.data, src.w, src.h, tgs, tgs), tgs, tgs, c);
  place(tile, TS, TS, fb, tgs, tgs, (TS - tgs) / 2, (TS - tgs) / 2);
  circleMask(tile, TS, TS);
  place(sheet, TS * CANDIDATES.length, TS, tile, TS, TS, ci * TS, 0);
}
fs.writeFileSync(path.join(PV, 'icon-bg-options.png'), encodePNG(TS * CANDIDATES.length, TS, sheet));
console.log('底色候选（从左到右）: ' + CANDIDATES.map(function (c) { return c[0]; }).join('  '));

/*
 * 三种做法的对照图（左 → 右）：
 *   1. 现在这种做法：垫底色 + 图案缩到 70%
 *   2. 按封面外圈取色垫底（换封面时如果色系变了，用这个最省事）
 *   3. 满幅：封面自己铺满，不留垫底（图案会被系统遮罩裁掉四角）
 * 真机上的自适应图标 = 背景铺满 + 图案 70% 居中 + 系统遮罩，所以这里也按同样方式合成。
 */
const VS = 240;
const variants = [
  { label: '垫底 ' + BG_HEX + '（当前）', bg: BG, full: false },
  { label: '垫底取封面外圈色' + (RING ? ' rgb(' + RING.join(',') + ')' : '（取不到）'), bg: RING || BG, full: false },
  { label: '满幅（封面铺满，不留垫底）', bg: null, full: true },
];
const vSheet = Buffer.alloc(VS * variants.length * VS * 4);
for (let i = 0; i < variants.length; i++) {
  const v = variants[i];
  let tile;
  if (v.full) {
    tile = flatten(resample(src.data, src.w, src.h, VS, VS), VS, VS, [0, 0, 0]);
  } else {
    tile = solid(VS, VS, v.bg);
    const gs = Math.round(VS * 0.70);
    const fb = flatten(resample(src.data, src.w, src.h, gs, gs), gs, gs, v.bg);
    place(tile, VS, VS, fb, gs, gs, (VS - gs) / 2, (VS - gs) / 2);
  }
  circleMask(tile, VS, VS);
  place(vSheet, VS * variants.length, VS, tile, VS, VS, i * VS, 0);
}
fs.writeFileSync(path.join(PV, 'icon-appearance-options.png'), encodePNG(VS * variants.length, VS, vSheet));
console.log('三种做法对照（左→右）: ' + variants.map(function (v) { return v.label; }).join('  |  '));

console.log('生成 ' + n + ' 张图 + 6 张预览，底色 ' + BG_HEX);
