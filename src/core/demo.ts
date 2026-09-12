import { addDays, mondayOf, toISODate } from './engine';
import type {
  AttendanceRecord, Course, Override, Period, PeriodScheme, Session, Task, Term, TimetableData,
} from './types';

/**
 * 默认作息时间（12 节）。
 * 注意第 1-2、3-4 节等是首尾相接的 —— 中间没有课间，
 * 这正是本校的排法，冲突检测会据此判断"换楼来不及"。
 */
export const PERIODS: Period[] = [
  { index: 1, start: '08:30', end: '09:15' },
  { index: 2, start: '09:15', end: '10:00' },
  { index: 3, start: '10:15', end: '11:00' },
  { index: 4, start: '11:00', end: '11:45' },
  { index: 5, start: '13:00', end: '13:45' },
  { index: 6, start: '13:45', end: '14:30' },
  { index: 7, start: '14:45', end: '15:30' },
  { index: 8, start: '15:30', end: '16:15' },
  { index: 9, start: '18:00', end: '18:45' },
  { index: 10, start: '18:45', end: '19:30' },
  { index: 11, start: '19:45', end: '20:30' },
  { index: 12, start: '20:30', end: '21:15' },
];

function schemes(): PeriodScheme[] {
  return [{ id: 'scheme-default', name: '默认作息', periods: PERIODS }];
}

/** 空课表：开学日期默认落在本周一，用户添加第一门课时就能立刻看到 */
export function buildEmptyData(): TimetableData {
  const term: Term = {
    id: 'term-1',
    name: '我的课表',
    startDate: toISODate(mondayOf(new Date())),
    totalWeeks: 20,
    periodSchemeId: 'scheme-default',
  };
  return {
    term: term, schemes: schemes(), courses: [], sessions: [],
    overrides: [], reminderRules: [], tasks: [], attendance: [],
  };
}

/**
 * 示例课表。仅供开发时用 ?demo=1 预览版式与主题，
 * 应用界面里没有任何入口能载入它。
 */
export function buildDemoData(): TimetableData {
  const termStart = addDays(mondayOf(new Date()), -42);
  const term: Term = {
    id: 'term-1',
    name: '2025-2026 学年第一学期',
    startDate: toISODate(termStart),
    totalWeeks: 20,
    periodSchemeId: 'scheme-default',
  };

  const courses: Course[] = [
    { id: 'c1', name: '高等数学 A', teacher: '王建国', colorIndex: 0, tags: ['必修'] },
    { id: 'c2', name: '大学英语 III', teacher: '李梦琪', colorIndex: 1, tags: ['必修'] },
    { id: 'c3', name: '程序设计基础', teacher: '张伟', colorIndex: 2, tags: ['必修'] },
    { id: 'c4', name: '数据结构与算法', teacher: '陈立', colorIndex: 3, tags: ['必修'] },
    { id: 'c5', name: '线性代数', teacher: '刘芳', colorIndex: 4, tags: ['必修'] },
    { id: 'c6', name: '大学物理', teacher: '赵鹏', colorIndex: 5, tags: ['必修'] },
    { id: 'c7', name: '体育（羽毛球）', teacher: '孙教练', colorIndex: 6, tags: ['必修'] },
    { id: 'c8', name: '思想道德与法治', teacher: '周敏', colorIndex: 7, tags: ['必修'] },
    { id: 'c9', name: '数据结构实验', teacher: '陈立', colorIndex: 3, tags: ['实验'] },
    { id: 'c10', name: '工程制图（选修）', teacher: '吴磊', colorIndex: 9, tags: ['选修'] },
  ];

  const sessions: Session[] = [
    { id: 's1', courseId: 'c1', dayOfWeek: 1, periodStart: 1, periodEnd: 2, weeks: { type: 'all' }, location: 'A301', building: '第三教学楼' },
    { id: 's2', courseId: 'c1', dayOfWeek: 3, periodStart: 3, periodEnd: 4, weeks: { type: 'all' }, location: 'A301', building: '第三教学楼' },
    { id: 's3', courseId: 'c2', dayOfWeek: 2, periodStart: 3, periodEnd: 4, weeks: { type: 'all' }, location: 'B205', building: '第二教学楼' },
    { id: 's4', courseId: 'c2', dayOfWeek: 4, periodStart: 1, periodEnd: 2, weeks: { type: 'all' }, location: 'B205', building: '第二教学楼' },
    { id: 's5', courseId: 'c3', dayOfWeek: 1, periodStart: 5, periodEnd: 6, weeks: { type: 'range', from: 1, to: 16 }, location: '实验楼 C402', building: '实验楼' },
    { id: 's6', courseId: 'c3', dayOfWeek: 5, periodStart: 3, periodEnd: 4, weeks: { type: 'range', from: 1, to: 16 }, location: '实验楼 C402', building: '实验楼' },
    { id: 's7', courseId: 'c4', dayOfWeek: 2, periodStart: 5, periodEnd: 6, weeks: { type: 'stepped', from: 1, to: 17, step: 2 }, location: 'A208', building: '第三教学楼' },
    { id: 's8', courseId: 'c4', dayOfWeek: 4, periodStart: 5, periodEnd: 6, weeks: { type: 'stepped', from: 2, to: 18, step: 2 }, location: 'A208', building: '第三教学楼' },
    { id: 's9', courseId: 'c5', dayOfWeek: 3, periodStart: 1, periodEnd: 2, weeks: { type: 'range', from: 1, to: 16 }, location: 'A105', building: '第三教学楼' },
    { id: 's10', courseId: 'c6', dayOfWeek: 4, periodStart: 7, periodEnd: 8, weeks: { type: 'all' }, location: '理科楼 201', building: '理科楼' },
    { id: 's11', courseId: 'c7', dayOfWeek: 5, periodStart: 5, periodEnd: 6, weeks: { type: 'all' }, location: '体育馆', building: '体育馆' },
    { id: 's12', courseId: 'c8', dayOfWeek: 2, periodStart: 7, periodEnd: 8, weeks: { type: 'range', from: 1, to: 8 }, location: 'B101', building: '第二教学楼' },
    { id: 's14', courseId: 'c10', dayOfWeek: 1, periodStart: 2, periodEnd: 3, weeks: { type: 'range', from: 1, to: 16 }, location: '实验楼 C101', building: '实验楼' },
    { id: 's13', courseId: 'c9', dayOfWeek: 3, periodStart: 7, periodEnd: 9, weeks: { type: 'stepped', from: 2, to: 16, step: 2 }, location: '实验楼 C301', building: '实验楼' },
  ];

  const w6 = function (d: number) { return toISODate(addDays(termStart, 5 * 7 + d - 1)); };
  const w7 = function (d: number) { return toISODate(addDays(termStart, 6 * 7 + d - 1)); };
  const w8 = function (d: number) { return toISODate(addDays(termStart, 7 * 7 + d - 1)); };
  const overrides: Override[] = [
    { id: 'o1', sessionId: 's2', date: w7(3), action: 'roomChange', patch: { location: 'A302' }, reason: 'A301 被占用' },
    { id: 'o2', sessionId: 's12', date: w7(2), action: 'cancel', reason: '教师出差，停课一次' },
    { id: 'o3', sessionId: 's11', date: w8(5), action: 'reschedule', patch: { newDate: w8(6), periodStart: 3, periodEnd: 4, location: '体育馆' }, reason: '场地冲突，改到周六' },
  ];

  const tasks: Task[] = [
    { id: 'k1', title: '高数作业 第 5 章习题', courseId: 'c1', due: w7(5), done: false },
    { id: 'k2', title: '数据结构实验报告', courseId: 'c9', due: w7(7), dueMinutes: 22 * 60, done: false },
    { id: 'k3', title: '英语 presentation 准备', courseId: 'c2', due: w8(3), done: false },
    { id: 'k4', title: '线性代数小测复习', courseId: 'c5', due: w6(4), done: true },
    { id: 'k5', title: '选课系统确认志愿', done: false },
  ];

  /* 演示一点考勤记录 */
  const attendance: AttendanceRecord[] = [
    { id: 'a1', sessionId: 's1', date: w6(1), status: 'present' },
    { id: 'a2', sessionId: 's9', date: w6(3), status: 'late' },
    { id: 'a3', sessionId: 's3', date: w6(2), status: 'absent' },
  ];

  return {
    term: term, schemes: schemes(), courses: courses, sessions: sessions,
    overrides: overrides, reminderRules: [], tasks: tasks, attendance: attendance,
  };
}
