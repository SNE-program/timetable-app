import type { Course, DayOfWeek, ID, Session, TimetableData, WeekSelector } from './types';

/**
 * 表格 → 课表：列映射 + 单元格语义解析。
 *
 * 这一层刻意与"读文件"分开（`sheetImport.ts` 只负责把文件变成二维字符串表），
 * 因为真正容易出错的是**语义**：教务系统里"周次"能写出十几种花样，
 * "节次"可能是 `1-2` / `第1-2节` / `0102`，"星期"可能是 `周一` / `星期一` / `1`。
 *
 * 这里全部是纯函数，且**只做解析不做写入** —— 解析结果要先给用户看，
 * 确认之后才走 `setData` 入库（可撤销）。导入是批量操作，一次写错很难手工修回来。
 */

export type FieldKey = 'name' | 'teacher' | 'day' | 'period' | 'weeks' | 'place';

export interface ColumnMap {
  name: number;
  teacher: number;
  day: number;
  period: number;
  weeks: number;
  place: number;
}

/** -1 表示这一列没有对应的数据 */
export function emptyMap(): ColumnMap {
  return { name: -1, teacher: -1, day: -1, period: -1, weeks: -1, place: -1 };
}

export const FIELD_ORDER: FieldKey[] = ['name', 'teacher', 'day', 'period', 'weeks', 'place'];

export const FIELD_LABEL: Record<FieldKey, string> = {
  name: '课程名',
  teacher: '教师',
  day: '星期',
  period: '节次',
  weeks: '周次',
  place: '教室',
};

/** 必填的两项：少了它们这一行就没法变成一节课 */
export const FIELD_REQUIRED: Record<FieldKey, boolean> = {
  name: true, teacher: false, day: true, period: true, weeks: false, place: false,
};

/* --------------------------- 文本归一化 --------------------------- */

/** 全角 → 半角，去空白与常见装饰符，统一大小写 */
export function norm(s: string): string {
  return String(s === undefined || s === null ? '' : s)
    .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/\u3000/g, ' ')
    .replace(/[\s]/g, '')
    .replace(/[（）()【】\[\]：:、,，.。]/g, '')
    .toLowerCase();
}

const CN_NUM: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
};

/** `周一` / `星期一` / `礼拜二` / `一` / `1` / `Mon` → 1..7，认不出来返回 null */
export function parseWeekday(raw: string): DayOfWeek | null {
  const s = norm(raw);
  if (!s) return null;

  const cn = /(?:周|星期|礼拜)([一二三四五六日天1-7])/.exec(s);
  if (cn) return CN_NUM[cn[1]] as DayOfWeek;

  const en = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)/.exec(s);
  if (en) {
    const map: Record<string, number> = {
      mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7,
    };
    return map[en[1]] as DayOfWeek;
  }

  /* 只有单独一个"三"或"3"时也认 —— 教务表的星期列常常就是一个字 */
  if (s.length === 1 && CN_NUM[s] !== undefined) return CN_NUM[s] as DayOfWeek;
  return null;
}

/** 节次上限定在 1..30：再大基本是解析错了，宁可报错也不写进课表 */
const MAX_PERIOD = 30;

/**
 * 中文数字 → 阿拉伯数字。教务表里"第一节""三-四节"并不少见，
 * 只认阿拉伯数字会白白丢掉这些行。
 * 先处理"十X"再处理单个汉字，顺序不能反（否则"十一"会变成"1一"之后各算各的）。
 */
export function cnToDigit(s: string): string {
  return s
    .replace(/十([一二三四五六七八九])/g, '1$1')
    .replace(/十/g, '10')
    .replace(/[一二三四五六七八九]/g, function (c) {
      return String('一二三四五六七八九'.indexOf(c) + 1);
    });
}

/**
 * `1-2` / `1~2` / `第1-2节` / `0102` / `3` / `1,2` → 起止节次
 */
export function parsePeriods(raw: string): { start: number; end: number } | null {
  const s = cnToDigit(String(raw || '')
    .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }))
    .replace(/[～〜]|—|–|－|~|至|到/g, '-')
    .trim();
  if (!s) return null;

  const take = function (a: number, b: number) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (!isFinite(lo) || !isFinite(hi) || lo < 1 || hi > MAX_PERIOD) return null;
    return { start: lo, end: hi };
  };

  /* 第3-4节 / 3-4 / 3 - 4 */
  const range = /(\d+)\s*-\s*(\d+)/.exec(s);
  if (range) return take(parseInt(range[1], 10), parseInt(range[2], 10));

  /* 1,2 节 / 1、2 节 */
  const listed = /(\d+)\s*[,，、]\s*(\d+)/.exec(s);
  if (listed) return take(parseInt(listed[1], 10), parseInt(listed[2], 10));

  /* 0102 这种四位连写（1-2 节） */
  const packed = /^(\d{2})(\d{2})$/.exec(s);
  if (packed) return take(parseInt(packed[1], 10), parseInt(packed[2], 10));

  const single = /(\d+)/.exec(s);
  if (single) return take(parseInt(single[1], 10), parseInt(single[1], 10));

  return null;
}

/**
 * 周次：
 *   `1-16` `1-16周` `第1-16周` → range
 *   `1,3,5` `1,3,5周` → list
 *   `单周` `1-16周(单)` `1-16单` → stepped step=2 from=1
 *   `双周` `2-16周(双)` → stepped step=2 from=2
 *   `每周` `全周` `每周都上` → all
 *   `1-8,10-16` → 展开成 list（跨段不连续，用 stepped 表达不了）
 */
export function parseWeeks(raw: string): WeekSelector | null {
  const s0 = String(raw || '')
    .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[～〜]|—|–|－|~|至|到/g, '-')
    .trim();
  if (!s0) return null;

  /* 先判"每周"这类整词，再动刀去字 —— 反过来的话 "每周" 会被削成 "每"，就认不出来了 */
  if (/^(每周|全周|全部|整学期|每周都上|每周上课|全学期)$/.test(s0)) return { type: 'all' };

  /* 、和 ，都当逗号用：教务表里两种混着写是常态 */
  const s = s0.replace(/周|学期|上课|第/g, '').replace(/[、，]/g, ',').trim();
  if (!s) return { type: 'all' };

  const odd = /单/.test(s);
  const even = /双/.test(s);
  const numbers = s.match(/\d+/g) || [];

  if (odd || even) {
    const first = numbers.length > 0 ? String(numbers[0]) : '';
    const second = numbers.length > 1 ? String(numbers[1]) : '';
    const from = first ? parseInt(first, 10) : (even ? 2 : 1);
    const to = second ? parseInt(second, 10) : undefined;
    if (from < 1 || from > 60) return null;
    return { type: 'stepped', from: even ? (from % 2 === 0 ? from : from + 1) : (from % 2 === 1 ? from : from + 1), to: to, step: 2 };
  }

  if (numbers.length === 0) return null;
  if (numbers.length === 1 && !/-/.test(s)) {
    const w = parseInt(numbers[0], 10);
    if (w < 1 || w > 60) return null;
    return { type: 'list', weeks: [w] };
  }

  /* 单段范围：1-16 */
  const single = /^(\d+)-(\d+)$/.exec(s);
  if (single) {
    const from = parseInt(single[1], 10);
    const to = parseInt(single[2], 10);
    if (from < 1 || to > 60 || to < from) return null;
    return { type: 'range', from: from, to: to };
  }

  /* 多段或列表：全部展开成显式周次，最省心也最不容易错 */
  const weeks: number[] = [];
  const parts = s.split(',');
  for (const part of parts) {
    const seg = /^(\d+)-(\d+)$/.exec(part.trim());
    if (seg) {
      const a = parseInt(seg[1], 10);
      const b = parseInt(seg[2], 10);
      if (a < 1 || b > 60 || b < a) continue;
      for (let w = a; w <= b; w++) weeks.push(w);
    } else {
      const one = parseInt(part.trim(), 10);
      if (one >= 1 && one <= 60) weeks.push(one);
    }
  }
  if (weeks.length === 0) return null;
  return { type: 'list', weeks: Array.from(new Set(weeks)).sort(function (a, b) { return a - b; }) };
}

/** 周次指纹，用来判重 */
export function weeksKey(sel: WeekSelector): string {
  if (sel.type === 'all') return 'all';
  if (sel.type === 'list') return 'l:' + sel.weeks.join(',');
  if (sel.type === 'range') return 'r:' + sel.from + '-' + (sel.to === undefined ? '' : sel.to);
  return 's:' + sel.from + '-' + (sel.to === undefined ? '' : sel.to) + '/' + sel.step;
}

/* --------------------------- 列名猜测 --------------------------- */

const SYNONYMS: Record<FieldKey, string[]> = {
  name: ['课程名称', '课程名', '课程', '科目', '教学班名称', '教学班', '课名', '名称'],
  teacher: ['任课教师', '授课教师', '主讲教师', '教师姓名', '教师', '老师'],
  day: ['上课星期', '星期几', '星期', '周几', '上课日'],
  period: ['上课节次', '节次', '节数', '上课时间', '时间'],
  weeks: ['上课周次', '起止周', '周次', '周数'],
  place: ['上课地点', '上课教室', '教室', '地点', '场地'],
};

function scoreHeader(cell: string, field: FieldKey, extra?: Partial<Record<FieldKey, string[]>>): number {
  const c = norm(cell);
  if (!c) return 0;
  /*
   * 插件预设的写法排在**前面**：那是"这个学校的导出文件就是这么写的"，是确定的；
   * 内置同义词是猜测。两者都命中同一列时，确定的那个应该赢。
   */
  const lists: string[][] = [];
  const add = extra && extra[field];
  if (add && add.length) lists.push(add);
  lists.push(SYNONYMS[field]);
  for (let li = 0; li < lists.length; li++) {
    const list = lists[li];
    const base = li === 0 ? 200 : 100;      /* 预设那组整体加权 */
    for (let i = 0; i < list.length; i++) {
      const syn = norm(list[i]);
      if (!syn) continue;
      if (c === syn) return base - i;          /* 完全相等最可信 */
      if (c.indexOf(syn) >= 0) return base - 40 - i; /* 包含次之 */
    }
  }
  return 0;
}

export interface GuessResult {
  headerRow: number;
  map: ColumnMap;
  header: string[];
  /** 命中了几个字段，界面据此判断"猜得像不像" */
  hits: number;
}

/**
 * 猜表头行与列映射。
 *
 * 只看前 10 行 —— 教务导出的表经常在前面挂"XX大学2026春季课表"之类的标题行，
 * 但很少超过 10 行。评分方式是"这一行能对上多少个字段"，全对不上就返回 -1，
 * 让用户自己指。
 */
export function guessColumns(
  rows: string[][],
  /**
   * 插件带来的**额外写法**（可选）。
   *
   * 一个学校一个写法，靠内置同义词永远追不完；而让插件提供"这份文件里表头长什么样"
   * 是纯数据、可校验、也不需要任何权限 —— 见 plugins/types.ts 的 ImportCapability。
   */
  extra?: Partial<Record<FieldKey, string[]>>,
  /** 插件声明"表头固定在这一行"时直接用它，不再逐行打分（0 基） */
  fixedHeaderRow?: number
): GuessResult {
  const scan = Math.min(rows.length, 10);
  let bestRow = 0;
  let bestScore = 0;

  const forced = typeof fixedHeaderRow === 'number' && fixedHeaderRow >= 0 && fixedHeaderRow < rows.length
    ? Math.round(fixedHeaderRow) : -1;
  if (forced >= 0) bestRow = forced;

  for (let r = 0; r < scan; r++) {
    if (forced >= 0 && r !== forced) continue;
    let score = 0;
    for (const f of FIELD_ORDER) {
      let colBest = 0;
      for (const cell of rows[r]) colBest = Math.max(colBest, scoreHeader(cell, f, extra));
      score += colBest;
    }
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }

  const header = rows[bestRow] || [];
  const map = emptyMap();
  const used: number[] = [];

  /* 先按字段优先级分配：课程名最不该被抢走 */
  for (const f of FIELD_ORDER) {
    let bestCol = -1;
    let best = 0;
    for (let c = 0; c < header.length; c++) {
      if (used.indexOf(c) >= 0) continue;
      const s = scoreHeader(header[c], f, extra);
      if (s > best) { best = s; bestCol = c; }
    }
    if (bestCol >= 0) { map[f] = bestCol; used.push(bestCol); }
  }

  const hits = FIELD_ORDER.filter(function (f) { return map[f] >= 0; }).length;
  /* 表头没猜中时把第一行当数据行更安全：宁可多导一行让用户看出来，也不要静默吃掉一门课 */
  return {
    headerRow: bestScore > 0 || forced >= 0 ? bestRow : -1,
    map: map, header: header, hits: hits,
  };
}

/* --------------------------- 单元格 → 一节课 --------------------------- */

export interface ParsedSession {
  name: string;
  teacher?: string;
  place?: string;
  dayOfWeek: DayOfWeek;
  periodStart: number;
  periodEnd: number;
  weeks: WeekSelector;
}

export interface RowIssue { row: number; reason: string; raw: string[] }

export interface ParseOutcome {
  sessions: ParsedSession[];
  issues: RowIssue[];
  /** 识别出的课程门数（按名字去重） */
  courseNames: string[];
}

/** 从课程名里抠出括号里的周次，例如 "高等数学(1-16周)" */
function weeksFromName(name: string): WeekSelector | null {
  const m = /[（(【\[]([^）)】\]]*)[）)】\]]/.exec(name);
  if (!m) return null;
  return parseWeeks(m[1]);
}

/** 去掉名字里的括号注释，让"高等数学(1-16周)"和"高等数学"合成同一门课 */
function cleanName(name: string): string {
  return name.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').trim() || name.trim();
}

export function parseSheet(
  rows: string[][], headerRow: number, map: ColumnMap, maxRows?: number
): ParseOutcome {
  const sessions: ParsedSession[] = [];
  const issues: RowIssue[] = [];
  const names: string[] = [];
  const start = headerRow + 1;
  const limit = maxRows === undefined ? rows.length : Math.min(rows.length, start + maxRows);

  for (let r = start; r < limit; r++) {
    const cells = rows[r] || [];
    const at = function (col: number): string {
      if (col < 0 || col >= cells.length) return '';
      return String(cells[col] === undefined ? '' : cells[col]).trim();
    };

    const rawName = at(map.name);
    if (!rawName && cells.every(function (c) { return !c; })) continue;  /* 整行空，跳过不算错 */
    if (!rawName) { issues.push({ row: r + 1, reason: '课程名为空', raw: cells }); continue; }

    const day = parseWeekday(at(map.day));
    if (day === null) {
      issues.push({ row: r + 1, reason: at(map.day) ? ('星期「' + at(map.day) + '」认不出来') : '缺少星期', raw: cells });
      continue;
    }

    const per = parsePeriods(at(map.period));
    if (per === null) {
      issues.push({ row: r + 1, reason: at(map.period) ? ('节次「' + at(map.period) + '」认不出来') : '缺少节次', raw: cells });
      continue;
    }

    const weeksRaw = at(map.weeks);
    const weeks = weeksRaw ? parseWeeks(weeksRaw) : null;
    const finalWeeks = weeks || weeksFromName(rawName) || { type: 'all' as const };

    const teacher = at(map.teacher) || undefined;
    const place = at(map.place) || undefined;
    const name = cleanName(rawName) || rawName;

    if (names.indexOf(name) < 0) names.push(name);
    sessions.push({
      name: name, teacher: teacher, place: place,
      dayOfWeek: day, periodStart: per.start, periodEnd: per.end, weeks: finalWeeks,
    });
  }

  return { sessions: sessions, issues: issues, courseNames: names };
}

/* --------------------------- 解析结果 → 课表数据 --------------------------- */

export interface ImportSummary {
  data: TimetableData;
  courses: number;
  sessions: number;
  /** 与已有课表重复、被跳过的时段数 */
  duplicates: number;
}

const PALETTE_SIZE = 12;

/**
 * 把解析结果写进课表数据。
 *
 * `merge`：同名课程合并到已有课程上（继续用它的配色），重复时段跳过；
 * `replace`：清空课程与时段再写入 —— 调课记录和出勤也跟着清，
 * 因为它们挂在旧 sessionId 上，留着就是一堆指向不存在时段的孤儿数据。
 */
export function buildImportedData(
  prev: TimetableData, parsed: ParsedSession[], mode: 'merge' | 'replace'
): ImportSummary {
  const keep = mode === 'merge';
  const courses: Course[] = keep ? prev.courses.slice() : [];
  const sessions: Session[] = keep ? prev.sessions.slice() : [];
  const overrides = keep ? prev.overrides.slice() : [];
  const attendance = keep ? prev.attendance.slice() : [];

  let seq = 0;
  const nextId = function (prefix: string): ID {
    for (;;) {
      seq++;
      const id = prefix + Date.now().toString(36) + '-' + seq.toString(36);
      const taken = courses.some(function (c) { return c.id === id; }) || sessions.some(function (s) { return s.id === id; });
      if (!taken) return id;
    }
  };

  const findCourse = function (name: string, teacher: string | undefined): Course | undefined {
    const n = norm(name);
    return courses.filter(function (c) {
      if (norm(c.name) !== n) return false;
      /* 教师两边都有时才比对；只填了课程名的行不该因此新建一门课 */
      if (teacher && c.teacher) return norm(c.teacher) === norm(teacher);
      return true;
    })[0];
  };

  const usedColors: number[] = courses.map(function (c) { return c.colorIndex; });
  const nextColor = function (): number {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      if (usedColors.indexOf(i) < 0) { usedColors.push(i); return i; }
    }
    return courses.length % PALETTE_SIZE;
  };

  let duplicates = 0;
  const fresh: Session[] = [];

  for (const p of parsed) {
    let course = findCourse(p.name, p.teacher);
    if (!course) {
      course = {
        id: nextId('c'),
        name: p.name,
        teacher: p.teacher,
        colorIndex: nextColor(),
      };
      courses.push(course);
    }

    const wk = weeksKey(p.weeks);
    const dup = sessions.concat(fresh).some(function (s) {
      return s.courseId === course!.id && s.dayOfWeek === p.dayOfWeek &&
        s.periodStart === p.periodStart && s.periodEnd === p.periodEnd &&
        weeksKey(s.weeks) === wk && (s.location || '') === (p.place || '');
    });
    if (dup) { duplicates++; continue; }

    fresh.push({
      id: nextId('s'),
      courseId: course.id,
      dayOfWeek: p.dayOfWeek,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      weeks: p.weeks,
      location: p.place,
    });
  }

  const data: TimetableData = Object.assign({}, prev, {
    courses: courses,
    sessions: sessions.concat(fresh),
    overrides: overrides,
    attendance: attendance,
  });

  return { data: data, courses: courses.length, sessions: fresh.length, duplicates: duplicates };
}

/* --------------------------- 课表矩阵（行=节次，列=星期） --------------------------- */

/**
 * 教务系统最常导出的其实是"课表矩阵"：行是节次，列是星期，格子里塞着
 * 课程名 / 教师 / 周次 / 教室 几行文本。它和"一行一个时段"的长表完全不同，
 * 列映射那套用不上，所以单独一条解析路径。
 *
 * 格子里的格式千校千面，这里只做**尽力而为**的识别：
 * 认出来的进预览，认不出来的整格原样列在"无法解析"里。
 * 因为导入前必须过预览、确认才入库，猜错也不会把脏数据写进课表。
 */

export interface MatrixGuess {
  headerRow: number;
  /** 每个星期列的下标 */
  dayCols: { col: number; day: DayOfWeek }[];
  /** 节次所在列 */
  periodCol: number;
}

const PERIOD_HEAD = /^(节次|课节|节|时间|上课时间|第几节|序号)$/;

/** 认出"这是课表矩阵"并定位表头；认不出返回 null */
export function detectMatrix(rows: string[][]): MatrixGuess | null {
  const scan = Math.min(rows.length, 12);
  let best: MatrixGuess | null = null;
  let bestScore = 0;

  for (let r = 0; r < scan; r++) {
    const cells = rows[r] || [];
    const dayCols: { col: number; day: DayOfWeek }[] = [];
    let periodCol = -1;

    for (let c = 0; c < cells.length; c++) {
      const day = parseWeekday(cells[c]);
      /* 只认"周一 / 星期一"这类明确写法：矩阵里单独一个"一"多半是别的意思 */
      if (day !== null && norm(cells[c]).length > 1) {
        dayCols.push({ col: c, day: day });
        continue;
      }
      if (periodCol < 0 && PERIOD_HEAD.test(norm(cells[c]))) periodCol = c;
    }

    /* 至少三个星期列才算矩阵，否则误判概率太高 */
    if (dayCols.length < 3) continue;
    if (periodCol < 0) {
      /* 表头里没写"节次"就取最左边那一列 */
      let left = 0;
      for (const d of dayCols) if (d.col === 0) { left = -1; break; }
      if (left < 0) continue;
      periodCol = left;
    }

    const score = dayCols.length * 10 + (periodCol >= 0 ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { headerRow: r, dayCols: dayCols, periodCol: periodCol };
    }
  }
  return best;
}

/** 教室不一定带数字："操场""体育馆""文科楼"都算 */
const PLACE_TAIL = /(楼|馆|场|室|区|院|中心|操场|体育馆|田径场|机房|实验室|礼堂)$/;

function looksLikePlace(s: string): boolean {
  if (/周|星期|节/.test(s) || s.length > 16) return false;
  if (PLACE_TAIL.test(s)) return true;
  return /\d/.test(s) && /[A-Za-z\u4e00-\u9fa5]/.test(s);
}

function looksLikeTeacher(s: string): boolean {
  return /^[\u4e00-\u9fa5]{2,4}$/.test(s) && !/周|星期|节/.test(s);
}

export interface MatrixCell {
  name: string;
  teacher?: string;
  place?: string;
  weeks: WeekSelector | null;
}

/** 解析矩阵里的一个格子 */
export function parseMatrixCell(text: string): MatrixCell | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  /* 换行是主分隔；Excel 里单元格内换行存的就是 \n。没有换行时退化成按空白切词 */
  let parts = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (parts.length === 1 && /\s/.test(parts[0])) parts = parts[0].split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  let name = parts[0];
  let teacher: string | undefined;
  let place: string | undefined;
  let weeks: WeekSelector | null = null;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (weeks === null) {
      const w = parseWeeks(p);
      if (w) { weeks = w; continue; }
    }
    if (!place && looksLikePlace(p)) { place = p; continue; }
    if (!teacher && looksLikeTeacher(p)) { teacher = p; continue; }
    /* 认不出的并进名字里，至少信息不丢 */
    if (name.indexOf(p) < 0 && p.length <= 12) name = name + ' ' + p;
  }

  if (weeks === null) weeks = weeksFromName(name);
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  return { name: cleaned, teacher: teacher, place: place, weeks: weeks };
}

/** 整张矩阵 → 时段列表 */
export function parseMatrix(rows: string[][], g: MatrixGuess): ParseOutcome {
  const sessions: ParsedSession[] = [];
  const issues: RowIssue[] = [];
  const names: string[] = [];

  for (let r = g.headerRow + 1; r < rows.length; r++) {
    const cells = rows[r] || [];
    const periodRaw = g.periodCol >= 0 && g.periodCol < cells.length ? String(cells[g.periodCol] || '').trim() : '';
    const per = parsePeriods(periodRaw);
    if (per === null) {
      /* "上午/下午"这类分组行和空行都不算错误 */
      if (periodRaw && !/^(上午|下午|晚上|中午)$/.test(periodRaw)) {
        issues.push({ row: r + 1, reason: '节次「' + periodRaw + '」认不出来', raw: cells });
      }
      continue;
    }

    for (const dc of g.dayCols) {
      if (dc.col >= cells.length) continue;
      const text = String(cells[dc.col] === undefined ? '' : cells[dc.col]).trim();
      if (!text) continue;

      const cell = parseMatrixCell(text);
      if (!cell) continue;
      if (names.indexOf(cell.name) < 0) names.push(cell.name);

      sessions.push({
        name: cell.name,
        teacher: cell.teacher,
        place: cell.place,
        dayOfWeek: dc.day,
        periodStart: per.start,
        periodEnd: per.end,
        weeks: cell.weeks || { type: 'all' },
      });
    }
  }

  return { sessions: sessions, issues: issues, courseNames: names };
}

