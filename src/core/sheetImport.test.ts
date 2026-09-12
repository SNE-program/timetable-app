import { describe, expect, it } from 'vitest';
import {
  blocks, colIndex, decodeBytes, guessDelimiter, listZipEntries, looksLikeXlsx, parseDelimited,
  parseSharedStrings, parseSheetXml, parseXlsx, readSheetBytes, sheetNames, xmlUnescape,
} from './sheetImport';

/* ------------------------- 造一个真的 zip（xlsx） ------------------------- */

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 最小 zip 写入器。
 * CRC 一律写 0 —— 我们的读取端不校验 CRC（只解压、只取文本），
 * 这里要验的是"能不能正确解析 zip 结构"，不是"能不能造一个合规的 zip"。
 */
async function makeZip(entries: { name: string; text: string }[], method: 0 | 8): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const raw = enc.encode(e.text);
    const data = method === 8 ? await deflateRaw(raw) : raw;

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, method, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, raw.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    centrals.push(cd);

    offset += local.length;
  }

  const cdSize = centrals.reduce(function (n, c) { return n + c.length; }, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = locals.concat(centrals, [eocd]);
  const total = all.reduce(function (n, p) { return n + p.length; }, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** 把二维表编成一个真实的 xlsx（用 sharedStrings，和 Excel 导出的结构一致） */
async function makeXlsx(sheets: { name: string; rows: string[][] }[], method: 0 | 8 = 8): Promise<Uint8Array> {
  const shared: string[] = [];
  const indexOf = function (v: string): number {
    const i = shared.indexOf(v);
    if (i >= 0) return i;
    shared.push(v);
    return shared.length - 1;
  };

  const entries: { name: string; text: string }[] = [];
  sheets.forEach(function (s, si) {
    const rows = s.rows.map(function (cells, ri) {
      const cs = cells.map(function (v, ci) {
        const ref = String.fromCharCode(65 + ci) + (ri + 1);
        return '<c r="' + ref + '" t="s"><v>' + indexOf(v) + '</v></c>';
      }).join('');
      return '<row r="' + (ri + 1) + '">' + cs + '</row>';
    }).join('');
    entries.push({
      name: 'xl/worksheets/sheet' + (si + 1) + '.xml',
      text: '<?xml version="1.0"?><worksheet><sheetData>' + rows + '</sheetData></worksheet>',
    });
  });

  entries.push({
    name: 'xl/sharedStrings.xml',
    text: '<?xml version="1.0"?><sst count="' + shared.length + '">' +
      shared.map(function (v) { return '<si><t>' + v.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</t></si>'; }).join('') +
      '</sst>',
  });
  entries.push({
    name: 'xl/workbook.xml',
    text: '<?xml version="1.0"?><workbook><sheets>' +
      sheets.map(function (s, i) {
        return '<sheet name="' + s.name + '" sheetId="' + (i + 1) + '"/>';
      }).join('') +
      '</sheets></workbook>',
  });
  entries.push({ name: '[Content_Types].xml', text: '<Types/>' });

  return await makeZip(entries, method);
}

/* ------------------------------- 编码 ------------------------------- */

describe('字节 → 文本', function () {
  it('带 BOM 的 UTF-8', function () {
    const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode('课程,教师')]);
    const r = decodeBytes(bytes);
    expect(r.text).toBe('课程,教师');
    expect(r.encoding).toContain('BOM');
  });

  it('不带 BOM 的 UTF-8', function () {
    const r = decodeBytes(new TextEncoder().encode('课程,教师'));
    expect(r.text).toBe('课程,教师');
    expect(r.encoding).toBe('UTF-8');
  });

  it('GBK —— 教务导出的 CSV 十有八九是这个', function () {
    /* "中国" 的 GBK 编码；这几个字节不是合法 UTF-8，所以必须落到 GBK 分支 */
    const r = decodeBytes(new Uint8Array([0xD6, 0xD0, 0xB9, 0xFA]));
    expect(r.text).toBe('中国');
    expect(r.encoding).toBe('GBK');
  });

  it('UTF-8 优先：GBK 能解 UTF-8 但会得到乱码，顺序不能反', function () {
    const r = decodeBytes(new TextEncoder().encode('中国'));
    expect(r.text).toBe('中国');
    expect(r.encoding).toBe('UTF-8');
  });
});

/* ------------------------------- CSV ------------------------------- */

describe('CSV 解析', function () {
  it('基本表格', function () {
    const rows = parseDelimited('课程名,教师\n高等数学,张三\n大学英语,李四');
    expect(rows).toEqual([['课程名', '教师'], ['高等数学', '张三'], ['大学英语', '李四']]);
  });

  it('引号里的逗号与换行', function () {
    const rows = parseDelimited('a,"x,y"\nb,"1\n2"');
    expect(rows[0]).toEqual(['a', 'x,y']);
    expect(rows[1]).toEqual(['b', '1\n2']);
  });

  it('转义引号 ""', function () {
    expect(parseDelimited('a,"说""引号"""')[0]).toEqual(['a', '说"引号"']);
  });

  it('CRLF：行号必须和文件对齐，所以空行保留、结尾不多加一行', function () {
    const rows = parseDelimited('a,b\r\nc,d\r\n\r\n');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['c', 'd']);
    expect(rows.length).toBe(3);   /* 第 3 行确实是空行，第 4 行不存在 */
  });

  it('自动认分隔符：制表符', function () {
    expect(guessDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('自动认分隔符：分号', function () {
    expect(guessDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('课程名里带逗号时不会被带偏', function () {
    const text = '课程名,教师\n"高等数学,上",张三\n"大学英语,下",李四';
    expect(parseDelimited(text)[1]).toEqual(['高等数学,上', '张三']);
  });

  it('单列文本不会误判分隔符', function () {
    expect(guessDelimiter('课程表\n高等数学\n大学英语')).toBe(',');
    expect(parseDelimited('课程表\n高等数学')).toEqual([['课程表'], ['高等数学']]);
  });
});

/* ------------------------------- XML ------------------------------- */

describe('XML 小工具', function () {
  it('实体反转义', function () {
    expect(xmlUnescape('a&amp;b&lt;c&gt;d&quot;e&apos;f')).toBe('a&b<c>d"e\'f');
    expect(xmlUnescape('&#65;&#x42;')).toBe('AB');
  });

  it('块提取', function () {
    expect(blocks('<a><si>1</si><si>2</si></a>', 'si')).toEqual(['1', '2']);
  });

  it('列号换算', function () {
    expect(colIndex('A1')).toBe(0);
    expect(colIndex('Z9')).toBe(25);
    expect(colIndex('AA1')).toBe(26);
    expect(colIndex('AB12')).toBe(27);
  });

  it('共享字符串：多段 <t> 拼接、跳过注音', function () {
    const xml = '<sst>' +
      '<si><t>高等数学</t></si>' +
      '<si><r><t>大学</t></r><r><t>英语</t></r></si>' +
      '<si><t>化</t><rPh sb="0" eb="1"><t>か</t></rPh><t>学</t></si>' +
      '</sst>';
    expect(parseSharedStrings(xml)).toEqual(['高等数学', '大学英语', '化学']);
  });

  it('工作表名', function () {
    const xml = '<workbook><sheets><sheet name="课表" sheetId="1"/><sheet name="成绩" sheetId="2"/></sheets></workbook>';
    expect(sheetNames(xml)).toEqual(['课表', '成绩']);
  });
});

describe('工作表 XML', function () {
  it('共享字符串引用 + 按 r 属性补空列', function () {
    const xml = '<sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c></row>' +
      '</sheetData>';
    const rows = parseSheetXml(xml, ['甲', '丙', '乙']);
    expect(rows[0]).toEqual(['甲', '', '丙']);
    expect(rows[1]).toEqual(['乙']);
  });

  it('跳过的行号会补空行，不会把数据上移', function () {
    const xml = '<sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>头</t></is></c></row>' +
      '<row r="4"><c r="A4" t="inlineStr"><is><t>第四行</t></is></c></row>' +
      '</sheetData>';
    const rows = parseSheetXml(xml, []);
    expect(rows.length).toBe(4);
    expect(rows[3][0]).toBe('第四行');
  });

  it('纯数字单元格', function () {
    const rows = parseSheetXml('<sheetData><row r="1"><c r="A1"><v>3</v></c></row></sheetData>', []);
    expect(rows[0][0]).toBe('3');
  });
});

/* ------------------------------- ZIP / XLSX ------------------------------- */

describe('xlsx 读取', function () {
  const rows = [
    ['课程名称', '教师', '星期', '节次', '周次', '教室'],
    ['高等数学', '张三', '周一', '1-2', '1-16周', 'A301'],
    ['大学英语', '李四', '周三', '3-4', '1-16周(单)', 'B202'],
  ];

  it('识别 xlsx 魔数', async function () {
    expect(looksLikeXlsx(await makeXlsx([{ name: '课表', rows: rows }]))).toBe(true);
    expect(looksLikeXlsx(new TextEncoder().encode('a,b'))).toBe(false);
  });

  it('deflate 压缩的 xlsx（Excel 的真实情况）', async function () {
    const buf = await makeXlsx([{ name: '课表', rows: rows }]);
    const tables = await parseXlsx(buf);
    expect(tables.length).toBe(1);
    expect(tables[0].name).toBe('课表');
    expect(tables[0].rows).toEqual(rows);
  });

  it('store（不压缩）的 xlsx 也要能读', async function () {
    const buf = await makeXlsx([{ name: 'S1', rows: rows }], 0);
    const tables = await parseXlsx(buf);
    expect(tables[0].rows).toEqual(rows);
  });

  it('多个工作表按顺序返回，名字对得上', async function () {
    const buf = await makeXlsx([
      { name: '第一张', rows: [['a']] },
      { name: '第二张', rows: [['b'], ['c']] },
    ]);
    const tables = await parseXlsx(buf);
    expect(tables.map(function (t) { return t.name; })).toEqual(['第一张', '第二张']);
    expect(tables[1].rows).toEqual([['b'], ['c']]);
  });

  it('zip 目录能列出来', async function () {
    const entries = listZipEntries(await makeXlsx([{ name: 'x', rows: [['1']] }]));
    expect(entries.map(function (e) { return e.name; })).toContain('xl/workbook.xml');
  });

  it('不是 zip 就明确报错，而不是返回空表', async function () {
    await expect(parseXlsx(new TextEncoder().encode('not a zip at all'))).rejects.toThrow();
  });
});

describe('统一入口', function () {
  it('xlsx', async function () {
    const buf = await makeXlsx([{ name: '课表', rows: [['甲']] }]);
    const r = await readSheetBytes(buf, 'x.xlsx');
    expect(r.encoding).toContain('xlsx');
    expect(r.tables[0].rows).toEqual([['甲']]);
  });

  it('csv 用文件名当表名', async function () {
    const r = await readSheetBytes(new TextEncoder().encode('a,b\n1,2'), '我的课表.csv');
    expect(r.tables[0].name).toBe('我的课表.csv');
    expect(r.tables[0].rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});
