/* 看一眼 123jie.png 的构成：透明度、四角颜色、主要颜色分布。
   用来给图标底色挑一个不会打架的颜色。 */
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(file) {
  const b = fs.readFileSync(file);
  let off = 8, W = 0, H = 0, depth = 0, color = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString('ascii');
    const data = b.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * 4;
  const out = Buffer.alloc(W * H * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0, bb = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + bb) & 255;
      else if (ft === 3) v = (v + ((a + bb) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        v = (v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c))) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w: W, h: H, color: color, data: out };
}

const d = decodePNG('123jie.png');
console.log('尺寸 ' + d.w + 'x' + d.h + '  colorType ' + d.color);

let clear = 0, semi = 0, opaque = 0;
const hist = new Map();
for (let i = 0; i < d.w * d.h; i++) {
  const a = d.data[i * 4 + 3];
  if (a < 10) clear++;
  else if (a < 245) semi++;
  else opaque++;
  if (a > 200) {
    const k = (d.data[i * 4] >> 4) + ',' + (d.data[i * 4 + 1] >> 4) + ',' + (d.data[i * 4 + 2] >> 4);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
}
const total = d.w * d.h;
console.log('全透明 ' + clear + ' (' + (clear / total * 100).toFixed(1) + '%)   半透明 ' + semi + '   不透明 ' + opaque);

console.log('边缘像素 RGBA:');
const probes = [[0, 0], [d.w - 1, 0], [0, d.h - 1], [d.w - 1, d.h - 1], [Math.floor(d.w / 2), 1], [1, Math.floor(d.h / 2)]];
for (const p of probes) {
  const i = (p[1] * d.w + p[0]) * 4;
  console.log('  (' + p[0] + ',' + p[1] + ')  rgba(' + d.data[i] + ',' + d.data[i + 1] + ',' + d.data[i + 2] + ',' + d.data[i + 3] + ')');
}

/* 外圈平均色：自适应图标背景要跟它贴合才不会有"套了个框"的感觉 */
function ringMean(frac) {
  const m = Math.max(1, Math.round(d.w * frac));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      if (x >= m && x < d.w - m && y >= m && y < d.h - m) continue;
      const i = (y * d.w + x) * 4;
      r += d.data[i]; g += d.data[i + 1]; b += d.data[i + 2]; n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
console.log('外圈平均色（不做透明合成，直接取 RGB）:');
for (const f of [0.01, 0.03, 0.08]) {
  const c = ringMean(f);
  console.log('  外侧 ' + (f * 100).toFixed(0) + '%   rgb(' + c.join(',') + ')   #' +
    c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase());
}
/* 把半透明像素按指定底色合成后再看一遍，这才接近真机上的观感 */
function composite(bgc) {
  let r = 0, g = 0, b = 0, n = 0;
  const m = Math.max(1, Math.round(d.w * 0.03));
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      if (x >= m && x < d.w - m && y >= m && y < d.h - m) continue;
      const i = (y * d.w + x) * 4;
      const a = d.data[i + 3] / 255;
      r += d.data[i] * a + bgc[0] * (1 - a);
      g += d.data[i + 1] * a + bgc[1] * (1 - a);
      b += d.data[i + 2] * a + bgc[2] * (1 - a);
      n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
console.log('合成到不同底色后的外圈观感:');
for (const [name, c] of [['纯白 #FFFFFF', [255, 255, 255]], ['深灰 #2F3237', [47, 50, 55]], ['深灰 #33363B', [51, 54, 59]], ['近黑 #23262B', [35, 38, 43]]]) {
  const out = composite(c);
  console.log('  ' + name.padEnd(16) + ' → rgb(' + out.join(',') + ')');
}

console.log('主要颜色（16 级量化）:');
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [k, v] of top) {
  const rgb = k.split(',').map((x) => x * 16);
  console.log('  rgb(' + rgb.join(',') + ')  ' + v + ' px  ' + (v / total * 100).toFixed(1) + '%');
}
