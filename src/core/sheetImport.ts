/**
 * 表格文件读取：CSV / TXT / XLSX → 二维字符串表。
 *
 * ## 为什么自己写，不用库
 *
 * - **xlsx 库动辄几百 KB**，而这个应用目前的产物总共不到 500 KB，
 *   为了"读一次教务导出表"背一个 SheetJS 进来不划算；
 * - xlsx 本质就是一个 ZIP 里装几份 XML，而我们只需要"把单元格读成字符串"，
 *   用不到样式、公式、图表；
 * - **不引入依赖 = 不引入供应链风险**。这个产品的"无广告无追踪"承诺
 *   靠的就是产物里没有第三方代码，能不加就不加。
 *
 * ## 为什么不用 DOMParser / FileReader
 *
 * 解析这几种 XML 只需要"按标签切开"，用不上完整 DOM。
 * 不用 DOM 带来的好处很实在：**整个模块在 Node 里就能跑单测**，不用搭 jsdom。
 * 同理入口收的是 `ArrayBuffer` 而不是 `File` —— 调用方负责 `file.arrayBuffer()`。
 *
 * ## 编码
 *
 * 教务系统导出的 CSV 十有八九是 **GBK**（Excel 默认另存为 ANSI），
 * 直接按 UTF-8 读会得到一堆乱码。这里的做法是：先**严格**按 UTF-8 解，
 * 失败再退回 GBK —— 顺序不能反，因为 GBK 几乎不会解码失败，
 * 拿 GBK 去解 UTF-8 只会得到一堆看起来"合法"的乱码。
 */

export interface SheetTable {
  /** 工作表名（CSV 时是文件名） */
  name: string;
  /** 行 × 列；单元格一律是去过首尾空白的字符串 */
  rows: string[][];
}

export interface DecodedText {
  text: string;
  /** 实际用的编码，导入预览里显示出来，出问题时好判断 */
  encoding: string;
}

function toBytes(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

/** UTF-8 严格解码，遇到非法序列就抛 —— 这是判断"是不是 UTF-8"最可靠的办法 */
function tryUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return null;
  }
}

export function decodeBytes(buf: ArrayBuffer | Uint8Array): DecodedText {
  const bytes = toBytes(buf);
  /* 有 BOM 就不用猜 */
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' };
  }
  const utf8 = tryUtf8(bytes);
  if (utf8 !== null) return { text: utf8, encoding: 'UTF-8' };

  try {
    return { text: new TextDecoder('gbk').decode(bytes), encoding: 'GBK' };
  } catch (e) {
    /* 有些环境没有 gbk 解码器，退回带替换符的 UTF-8，至少不整块失败 */
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8（含乱码）' };
  }
}

/* ------------------------------ CSV / TSV ------------------------------ */

/** 按分隔符切一行，正确处理双引号包裹与 "" 转义 */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 分隔符探测：看哪种分隔符切出来的列数最稳定。
 * 只看"谁出现得多"会被"课程名里带逗号"的表骗到，看一致性更稳。
 */
export function guessDelimiter(text: string): string {
  const candidates = [',', '\t', ';', '|'];
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; }).slice(0, 12);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map(function (l) { return splitLine(l, d).length; });
    const max = Math.max.apply(null, counts);
    if (max < 2) continue;
    const same = counts.filter(function (c) { return c === max; }).length;
    /* 得分 = 一致行数 × 100 + 列数：既要求真的在分隔，也要求每行列数一致 */
    const score = same * 100 + max;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** CSV / TSV → 二维表。支持引号包裹的字段里出现换行（"备注"列常有） */
export function parseDelimited(text: string, delim?: string): string[][] {
  const d = delim || guessDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;

  const endCell = function (): void { row.push(cur); cur = ''; };
  const endRow = function (): void { endCell(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === d) { endCell(); continue; }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    if (ch === '\n') { endRow(); continue; }
    cur += ch;
  }
  /* 结尾正好是换行时不要多出一行空行 */
  if (cur.length > 0 || row.length > 0) endRow();

  /*
   * 刻意**不**丢掉空行：数组下标要等于文件里的行号，
   * 否则导入预览里报"第 37 行无法解析"，用户对着文件找不到那一行。
   * 空行由上层（parseSheet）跳过。
   */
  return rows.map(function (r) { return r.map(function (c) { return c.trim(); }); });
}

/* ------------------------------ XLSX ------------------------------ */

export function xmlUnescape(s: string): string {
  return s.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, function (_m, hex, dec, name) {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    if (name === 'amp') return '&';
    if (name === 'lt') return '<';
    if (name === 'gt') return '>';
    if (name === 'quot') return '"';
    return "'";
  });
}

/** 取出所有 <tag …>…</tag> 的内部（这几份 XML 都是机器生成的，不会嵌套同名标签） */
export function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** A1 → 0，B1 → 1，AA1 → 26 */
export function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!m) return 0;
  let n = 0;
  for (let i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
  return n - 1;
}

/** sharedStrings.xml → 字符串表 */
export function parseSharedStrings(xml: string): string[] {
  return blocks(xml, 'si').map(function (si) {
    /* 日语注音那类 <rPh> 是读音提示不是内容，先扔掉再拼 <t> */
    const cleaned = si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr[^>]*\/>/g, '');
    const parts = blocks(cleaned, 't');
    if (parts.length === 0) return '';
    return xmlUnescape(parts.join(''));
  });
}

/** workbook.xml → 工作表名（按出现顺序） */
export function sheetNames(xml: string): string[] {
  const out: string[] = [];
  const re = /<sheet\s[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const n = /\sname="([^"]*)"/.exec(m[0]);
    if (n && n[1]) out.push(xmlUnescape(n[1]));
  }
  return out;
}

/** sheetN.xml → 二维表（按 r 属性还原真实行列位置，跳过的行补空） */
export function parseSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml)) !== null) {
    const rowXml = rm[0];
    const rowAttr = /<row(?:\s[^>]*)?\sr="(\d+)"/.exec(rowXml);
    const rowNo = rowAttr ? parseInt(rowAttr[1], 10) : rows.length + 1;

    const cells: string[] = [];
    const cellRe = /<c(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;

    while ((cm = cellRe.exec(rowXml)) !== null) {
      const head = /^<c((?:\s[^>]*?)?)\/?>/.exec(cm[0]);
      const attrs = head && head[1] ? head[1] : '';
      const refM = /\sr="([A-Z]+\d+)"/.exec(attrs);
      const col = refM ? colIndex(refM[1]) : cells.length;
      const typeM = /\st="([^"]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : '';
      const inner = cm[1] || '';

      let value = '';
      if (type === 'inlineStr') {
        value = blocks(inner, 't').map(xmlUnescape).join('');
      } else {
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const raw = v ? xmlUnescape(v[1]) : '';
        value = type === 's' ? (shared[parseInt(raw, 10)] || '') : raw;
      }

      while (cells.length < col) cells.push('');
      cells[col] = String(value).trim();
    }

    while (rows.length < rowNo - 1) rows.push([]);
    rows[rowNo - 1] = cells;
  }

  /* 同上：保留空行，让下标等于工作表里的真实行号 */
  return rows;
}

/* ------------------------------ ZIP ------------------------------ */

export interface ZipEntry { name: string; method: number; offset: number; size: number; }

function findEocd(dv: DataView): number {
  /* EOCD 在文件末尾，后面最多再跟 65535 字节注释；从后往前找签名 */
  const max = Math.min(dv.byteLength, 22 + 65535);
  for (let i = dv.byteLength - 22; i >= dv.byteLength - max && i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

export function listZipEntries(buf: ArrayBuffer | Uint8Array): ZipEntry[] {
  const bytes = toBytes(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(dv);
  if (eocd < 0) throw new Error('不是有效的 xlsx（找不到 ZIP 结束记录）');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (p + 46 > dv.byteLength || dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({ name: name, method: method, offset: offset, size: size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function readZipEntry(buf: ArrayBuffer | Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const bytes = toBytes(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(entry.offset, true) !== 0x04034b50) throw new Error('ZIP 条目损坏：' + entry.name);
  const nameLen = dv.getUint16(entry.offset + 26, true);
  const extraLen = dv.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return await inflateRaw(raw);
  throw new Error('不支持的压缩方式（' + entry.method + '）');
}

/** 读一个 .xlsx，返回其中所有工作表 */
export async function parseXlsx(buf: ArrayBuffer | Uint8Array): Promise<SheetTable[]> {
  const entries = listZipEntries(buf);
  const find = function (n: string): ZipEntry | undefined {
    return entries.filter(function (e) { return e.name === n; })[0];
  };
  const readText = async function (n: string): Promise<string> {
    const e = find(n);
    if (!e) return '';
    return decodeBytes(await readZipEntry(buf, e)).text;
  };

  const sharedXml = await readText('xl/sharedStrings.xml');
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const names = sheetNames(await readText('xl/workbook.xml'));

  const sheetFiles = entries
    .filter(function (e) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name); })
    .sort(function (a, b) {
      const na = parseInt((/sheet(\d+)/.exec(a.name) || ['', '0'])[1], 10);
      const nb = parseInt((/sheet(\d+)/.exec(b.name) || ['', '0'])[1], 10);
      return na - nb;
    });

  if (sheetFiles.length === 0) throw new Error('这个 xlsx 里没有任何工作表');

  const out: SheetTable[] = [];
  for (let i = 0; i < sheetFiles.length; i++) {
    const xml = decodeBytes(await readZipEntry(buf, sheetFiles[i])).text;
    out.push({ name: names[i] || ('工作表 ' + (i + 1)), rows: parseSheetXml(xml, shared) });
  }
  return out;
}

/* ------------------------------ 入口 ------------------------------ */

export function looksLikeXlsx(buf: ArrayBuffer | Uint8Array): boolean {
  const b = toBytes(buf);
  /* PK\x03\x04 */
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
}

/** 旧版 .xls 是 OLE 复合文档（D0 CF 11 E0），是完全不同的二进制格式，读不了 */
export function looksLikeLegacyXls(buf: ArrayBuffer | Uint8Array): boolean {
  const b = toBytes(buf);
  return b.length > 8 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;
}

/** 统一入口：字节 → 工作表。调用方负责 file.arrayBuffer() */
export async function readSheetBytes(
  buf: ArrayBuffer | Uint8Array, name: string
): Promise<{ tables: SheetTable[]; encoding: string }> {
  if (looksLikeLegacyXls(buf)) {
    throw new Error('这是旧版 .xls（二进制格式），用 Excel 打开后「另存为」成 .xlsx 或 CSV 再试');
  }
  if (looksLikeXlsx(buf)) {
    return { tables: await parseXlsx(buf), encoding: 'xlsx（ZIP + XML）' };
  }
  const d = decodeBytes(buf);
  return { tables: [{ name: name || '表格', rows: parseDelimited(d.text) }], encoding: d.encoding };
}
