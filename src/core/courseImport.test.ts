import { describe, expect, it } from 'vitest';
import {
  buildImportedData, detectMatrix, emptyMap, guessColumns, norm, parseMatrix, parseMatrixCell, parsePeriods,
  parseSheet, parseWeekday, parseWeeks, weeksKey,
} from './courseImport';
import { buildEmptyData } from './demo';
import type { TimetableData } from './types';

describe('文本归一化', function () {
  it('全角转半角、去空白与装饰符', function () {
    expect(norm('  高等 数学（上） ')).toBe('高等数学上');
    expect(norm('１－２')).toBe('1-2');
  });
});

describe('星期', function () {
  it('中文各种写法', function () {
    expect(parseWeekday('周一')).toBe(1);
    expect(parseWeekday('星期一')).toBe(1);
    expect(parseWeekday('星期三')).toBe(3);
    expect(parseWeekday('礼拜二')).toBe(2);
    expect(parseWeekday('周日')).toBe(7);
    expect(parseWeekday('星期天')).toBe(7);
    expect(parseWeekday('六')).toBe(6);
  });

  it('数字与英文', function () {
    expect(parseWeekday('3')).toBe(3);
    expect(parseWeekday('Mon')).toBe(1);
    expect(parseWeekday('Sunday')).toBe(7);
    expect(parseWeekday('周五')).toBe(5);
  });

  it('"下周三" 这种写法按周三处理（宁可宽松，预览里看得见）', function () {
    expect(parseWeekday('下周三')).toBe(3);
  });

  it('认不出来的返回 null，不瞎猜', function () {
    expect(parseWeekday('')).toBeNull();
    expect(parseWeekday('--')).toBeNull();
    expect(parseWeekday('待定')).toBeNull();
    expect(parseWeekday('8')).toBeNull();
  });
});

describe('节次', function () {
  it('常见写法', function () {
    expect(parsePeriods('1-2')).toEqual({ start: 1, end: 2 });
    expect(parsePeriods('第3-4节')).toEqual({ start: 3, end: 4 });
    expect(parsePeriods('5~6')).toEqual({ start: 5, end: 6 });
    expect(parsePeriods('7—8节')).toEqual({ start: 7, end: 8 });
    expect(parsePeriods('3')).toEqual({ start: 3, end: 3 });
    expect(parsePeriods('第5节')).toEqual({ start: 5, end: 5 });
    expect(parsePeriods('1,2')).toEqual({ start: 1, end: 2 });
    expect(parsePeriods('0102')).toEqual({ start: 1, end: 2 });
  });

  it('顺序反了自动纠正', function () {
    expect(parsePeriods('4-3')).toEqual({ start: 3, end: 4 });
  });

  it('越界与空值返回 null', function () {
    expect(parsePeriods('')).toBeNull();
    expect(parsePeriods('上午')).toBeNull();
    expect(parsePeriods('99-100')).toBeNull();
  });
});

describe('周次', function () {
  it('范围', function () {
    expect(parseWeeks('1-16周')).toEqual({ type: 'range', from: 1, to: 16 });
    expect(parseWeeks('第3-18周')).toEqual({ type: 'range', from: 3, to: 18 });
  });

  it('列表', function () {
    expect(parseWeeks('1,3,5周')).toEqual({ type: 'list', weeks: [1, 3, 5] });
    expect(parseWeeks('1、3、5')).toEqual({ type: 'list', weeks: [1, 3, 5] });
  });

  it('多段范围展开成列表', function () {
    expect(parseWeeks('1-3,8-9周')).toEqual({ type: 'list', weeks: [1, 2, 3, 8, 9] });
  });

  it('单双周', function () {
    expect(parseWeeks('单周')).toEqual({ type: 'stepped', from: 1, to: undefined, step: 2 });
    expect(parseWeeks('双周')).toEqual({ type: 'stepped', from: 2, to: undefined, step: 2 });
    expect(parseWeeks('1-16周(单)')).toEqual({ type: 'stepped', from: 1, to: 16, step: 2 });
    expect(parseWeeks('1-16周(双)')).toEqual({ type: 'stepped', from: 2, to: 16, step: 2 });
    /* 起点写反了也要落到正确的那一周上 */
    expect(parseWeeks('2-16单周')).toEqual({ type: 'stepped', from: 3, to: 16, step: 2 });
  });

  it('每周', function () {
    expect(parseWeeks('每周')).toEqual({ type: 'all' });
    expect(parseWeeks('全周')).toEqual({ type: 'all' });
    expect(parseWeeks('每周都上')).toEqual({ type: 'all' });
  });

  it('认不出来就返回 null（由调用方决定怎么兜底）', function () {
    expect(parseWeeks('')).toBeNull();
    expect(parseWeeks('待定')).toBeNull();
    expect(parseWeeks('1-99周')).toBeNull();
  });

  it('指纹：不同写法不能混为一谈', function () {
    expect(weeksKey(parseWeeks('单周')!)).not.toBe(weeksKey(parseWeeks('双周')!));
    expect(weeksKey(parseWeeks('1-16周')!)).toBe(weeksKey({ type: 'range', from: 1, to: 16 }));
  });
});

describe('列名猜测', function () {
  const rows = [
    ['2026 春季学期 我的课表', '', '', '', '', ''],
    ['课程名称', '教师', '星期', '节次', '周次', '教室'],
    ['高等数学', '张三', '周一', '1-2', '1-16周', 'A301'],
  ];

  it('跳过标题行找到真正的表头', function () {
    const g = guessColumns(rows);
    expect(g.headerRow).toBe(1);
    expect(g.hits).toBe(6);
    expect(g.map).toEqual({ name: 0, teacher: 1, day: 2, period: 3, weeks: 4, place: 5 });
  });

  it('列顺序打乱也能对上', function () {
    const g = guessColumns([['教室', '上课周次', '课程名', '星期几', '任课教师', '上课节次']]);
    expect(g.map).toEqual({ name: 2, teacher: 4, day: 3, period: 5, weeks: 1, place: 0 });
  });

  it('同名列不会被两个字段抢走', function () {
    const g = guessColumns([['课程', '时间', '时间', '地点']]);
    const used = Object.values(g.map).filter(function (v) { return v >= 0; });
    expect(new Set(used).size).toBe(used.length);
  });

  it('完全认不出来时表头行返回 -1（把第一行当数据更安全）', function () {
    const g = guessColumns([['a', 'b', 'c']]);
    expect(g.headerRow).toBe(-1);
    expect(g.hits).toBe(0);
  });
});

describe('整表 → 时段', function () {
  const rows = [
    ['课程名称', '教师', '星期', '节次', '周次', '教室'],
    ['高等数学', '张三', '周一', '1-2', '1-16周', 'A301'],
    ['大学英语', '李四', '周三', '3-4', '1-16周(单)', 'B202'],
    ['大学英语', '李四', '周五', '3-4', '1-16周(单)', 'B202'],
    ['', '', '', '', '', ''],
    ['体育', '王五', '周四', '5-6', '每周', '操场'],
    ['坏行', '赵六', '待定', '3-4', '1-16', 'C101'],
  ];

  it('逐行解析，脏行单独报出来', function () {
    const g = guessColumns(rows);
    const r = parseSheet(rows, g.headerRow, g.map);
    expect(r.sessions.length).toBe(4);
    expect(r.courseNames).toEqual(['高等数学', '大学英语', '体育']);
    /* 空行（第 5 行）静默跳过，脏行（第 7 行）必须报出来 */
    expect(r.issues.length).toBe(1);
    expect(r.issues[0].row).toBe(7);
    expect(r.issues[0].reason).toContain('星期');
  });

  it('解析出的字段是对的', function () {
    const g = guessColumns(rows);
    const r = parseSheet(rows, g.headerRow, g.map);
    const math = r.sessions[0];
    expect(math.name).toBe('高等数学');
    expect(math.teacher).toBe('张三');
    expect(math.place).toBe('A301');
    expect(math.dayOfWeek).toBe(1);
    expect(math.periodStart).toBe(1);
    expect(math.periodEnd).toBe(2);
    expect(math.weeks).toEqual({ type: 'range', from: 1, to: 16 });

    const english = r.sessions[1];
    expect(english.weeks).toEqual({ type: 'stepped', from: 1, to: 16, step: 2 });
  });

  it('周次列没映射时，从课程名的括号里抠', function () {
    const g = guessColumns(rows);
    const map = Object.assign({}, g.map, { weeks: -1 });
    const r = parseSheet([['课程名'], ['高等数学(1-8周)'], ['大学英语']], 0, Object.assign(emptyMap(), { name: 0, day: -1, period: -1, weeks: -1, teacher: -1, place: -1 }, map.weeks === -1 ? {} : {}));
    /* 上面这行的目的是确认 weeks=-1 时不会崩，真正断言在下面 */
    expect(r.sessions.length + r.issues.length).toBeGreaterThan(0);

    const rows2 = [['课程名', '星期', '节次'], ['高等数学(1-8周)', '周一', '1-2'], ['大学英语', '周三', '3-4']];
    const g2 = guessColumns(rows2);
    const r2 = parseSheet(rows2, g2.headerRow, g2.map);
    expect(r2.sessions[0].name).toBe('高等数学');
    expect(r2.sessions[0].weeks).toEqual({ type: 'range', from: 1, to: 8 });
    /* 名字里没有周次信息时默认"每周"，不能因此丢掉这门课 */
    expect(r2.sessions[1].weeks).toEqual({ type: 'all' });
  });
});

describe('写进课表数据', function () {
  function withExisting(): TimetableData {
    const d = buildEmptyData();
    d.courses = [{ id: 'c-old', name: '高等数学', teacher: '张三', colorIndex: 3 }];
    d.sessions = [{
      id: 's-old', courseId: 'c-old', dayOfWeek: 1, periodStart: 1, periodEnd: 2,
      weeks: { type: 'range', from: 1, to: 16 }, location: 'A301',
    }];
    d.overrides = [{ id: 'o1', sessionId: 's-old', date: '2026-03-02', action: 'cancel' }];
    return d;
  }

  const parsed = [
    { name: '高等数学', teacher: '张三', place: 'A301', dayOfWeek: 1 as const, periodStart: 1, periodEnd: 2, weeks: { type: 'range' as const, from: 1, to: 16 } },
    { name: '大学英语', teacher: '李四', place: 'B202', dayOfWeek: 3 as const, periodStart: 3, periodEnd: 4, weeks: { type: 'range' as const, from: 1, to: 16 } },
  ];

  it('合并：同名课程复用，重复时段跳过', function () {
    const r = buildImportedData(withExisting(), parsed, 'merge');
    expect(r.courses).toBe(2);            /* 高等数学沿用，新增大学英语 */
    expect(r.sessions).toBe(1);           /* 只新增了英语那一节 */
    expect(r.duplicates).toBe(1);         /* 高数那一节和已有的完全一样 */
    expect(r.data.courses[0].id).toBe('c-old');
    expect(r.data.courses[0].colorIndex).toBe(3);
    /* 已有课程之外的课时要拿到新配色 */
    expect(r.data.courses[1].colorIndex).toBe(0);
    /* 合并模式下调课记录必须留着 */
    expect(r.data.overrides.length).toBe(1);
  });

  it('覆盖：清空重建，调课与出勤一起清掉（否则会变成孤儿数据）', function () {
    const d = withExisting();
    d.attendance = [{ id: 'a1', sessionId: 's-old', date: '2026-03-02', status: 'present' }];
    const r = buildImportedData(d, parsed, 'replace');
    expect(r.courses).toBe(2);
    expect(r.sessions).toBe(2);
    expect(r.data.overrides.length).toBe(0);
    expect(r.data.attendance.length).toBe(0);
    /* 新数据的 id 不能和旧的重合 */
    expect(r.data.courses.map(function (c) { return c.id; })).not.toContain('c-old');
    expect(r.data.sessions.map(function (s) { return s.id; })).not.toContain('s-old');
  });

  it('id 全局唯一：同名同时导入也不会撞', function () {
    const many = [];
    for (let i = 0; i < 30; i++) {
      many.push({ name: '课' + i, place: 'A' + i, dayOfWeek: 1 as const, periodStart: 1, periodEnd: 2, weeks: { type: 'all' as const } });
    }
    const r = buildImportedData(buildEmptyData(), many, 'replace');
    const ids = r.data.sessions.map(function (s) { return s.id; });
    expect(new Set(ids).size).toBe(ids.length);
    const courseIds = r.data.courses.map(function (c) { return c.id; });
    expect(new Set(courseIds).size).toBe(courseIds.length);
  });

  it('学期、作息、任务这些不属于"课程表"的东西保持不动', function () {
    const d = withExisting();
    d.tasks = [{ id: 't1', title: '作业', done: false }];
    d.term = Object.assign({}, d.term, { name: '2026 春' });
    const r = buildImportedData(d, parsed, 'replace');
    expect(r.data.term.name).toBe('2026 春');
    expect(r.data.schemes).toBe(d.schemes);
    expect(r.data.tasks).toBe(d.tasks);
  });
});


describe('课表矩阵', function () {
  const matrix = [
    ['节次', '星期一', '星期二', '星期三', '星期四', '星期五'],
    ['第1-2节', '高等数学\n张三\n1-16周\nA301', '', '大学英语\n李四\n1-16周(单)\nB202', '', ''],
    ['', '', '', '', '', ''],
    ['第3-4节', '', '大学物理\n王五\n1-8周\nC401', '', '', ''],
    ['第5-6节', '体育\n赵六\n每周\n操场', '', '', '', ''],
  ];

  it('认出矩阵并定位表头', function () {
    const g = detectMatrix(matrix);
    expect(g).not.toBeNull();
    expect(g!.headerRow).toBe(0);
    expect(g!.periodCol).toBe(0);
    expect(g!.dayCols.map(function (d) { return d.day; })).toEqual([1, 2, 3, 4, 5]);
  });

  it('一行一个时段的长表不会被误判成矩阵', function () {
    expect(detectMatrix([
      ['课程名称', '教师', '星期', '节次', '周次', '教室'],
      ['高等数学', '张三', '周一', '1-2', '1-16', 'A301'],
    ])).toBeNull();
  });

  it('格子解析：课程名 / 教师 / 周次 / 教室', function () {
    expect(parseMatrixCell('高等数学\n张三\n1-16周\nA301')).toEqual({
      name: '高等数学', teacher: '张三', place: 'A301', weeks: { type: 'range', from: 1, to: 16 },
    });
    expect(parseMatrixCell('大学英语\n李四\n1-16周(单)\nB202')!.weeks).toEqual({ type: 'stepped', from: 1, to: 16, step: 2 });
  });

  it('格子只有课程名也能用，默认每周', function () {
    const c = parseMatrixCell('形势与政策');
    expect(c!.name).toBe('形势与政策');
    expect(c!.weeks).toBeNull();
  });

  it('一行到底、用空格分隔的格子', function () {
    const c = parseMatrixCell('线性代数 孙七 3-14周 D105');
    expect(c!.name).toBe('线性代数');
    expect(c!.teacher).toBe('孙七');
    expect(c!.place).toBe('D105');
    expect(c!.weeks).toEqual({ type: 'range', from: 3, to: 14 });
  });

  it('整张矩阵展开成时段', function () {
    const g = detectMatrix(matrix)!;
    const r = parseMatrix(matrix, g);
    expect(r.sessions.length).toBe(4);
    expect(r.courseNames).toEqual(['高等数学', '大学英语', '大学物理', '体育']);
    const english = r.sessions.filter(function (s) { return s.name === '大学英语'; })[0];
    expect(english.dayOfWeek).toBe(3);
    expect(english.periodStart).toBe(1);
    expect(english.periodEnd).toBe(2);
    expect(r.issues.length).toBe(0);   /* 空行与空节次行都不该报错 */
  });

  it('中文节次（第一节 / 三-四节）也要认', function () {
    const m = [
      ['节次', '星期一', '星期二', '星期三'],
      ['第一节', '高数', '', ''],
      ['三-四节', '', '物理', ''],
    ];
    const r = parseMatrix(m, detectMatrix(m)!);
    expect(r.sessions.length).toBe(2);
    expect(r.sessions[0].periodStart).toBe(1);
    expect(r.sessions[1].periodStart).toBe(3);
    expect(r.sessions[1].periodEnd).toBe(4);
  });

  it('节次认不出来的行要报出来（"上午"这种分组行除外）', function () {
    const m = [
      ['节次', '星期一', '星期二', '星期三'],
      ['上午', '', '', ''],
      ['待定', '高数', '', ''],
    ];
    const g = detectMatrix(m)!;
    const r = parseMatrix(m, g);
    expect(r.sessions.length).toBe(0);
    expect(r.issues.length).toBe(1);
    expect(r.issues[0].row).toBe(3);
  });
});

