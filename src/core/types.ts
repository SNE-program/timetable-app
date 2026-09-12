/** 核心数据模型（对应 docs/03-core-data-model.ts） */

export type ID = string;
export type ISODate = string;
export type ClockTime = string;
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Period { index: number; label?: string; start: ClockTime; end: ClockTime; }
export interface PeriodScheme { id: ID; name: string; periods: Period[]; }
export interface Term {
  id: ID;
  name: string;
  startDate: ISODate;
  /**
   * 教学周数。省略 = 学期不设结束，周次可以无限往后延伸。
   * 它同时也是「这个学期到第几周为止」的上限，而不是时间轴的上限：
   * 时间轴本身永远可以往后翻，只是学期结束后不再有课。
   */
  totalWeeks?: number;
  periodSchemeId: ID;
}

/** 能翻到的最远周次（约 100 年）。纯粹是导航护栏，防止手滑滑到公元 5000 年。 */
export const MAX_WEEK = 5200;

export interface Course {
  id: ID; name: string; teacher?: string; room?: string;
  colorIndex: number; note?: string; tags?: string[];
  image?: string;
}

/**
 * 周次选择器。`to` 省略表示"一直往后"：
 *   - 学期不设结束 → 真正无限
 *   - 学期有结束 → 到学期结束为止
 */
export type WeekSelector =
  | { type: 'all' }
  | { type: 'range'; from: number; to?: number }
  | { type: 'list'; weeks: number[] }
  | { type: 'stepped'; from: number; to?: number; step: number };

export interface Session {
  id: ID; courseId: ID; dayOfWeek: DayOfWeek;
  periodStart: number; periodEnd: number;
  weeks: WeekSelector; location?: string; building?: string;
  kind?: 'lecture' | 'lab' | 'exam' | 'pe';
}

export type OverrideAction = 'cancel' | 'reschedule' | 'roomChange';
export interface Override {
  id: ID; sessionId: ID; date: ISODate; action: OverrideAction;
  patch?: { dayOfWeek?: DayOfWeek; periodStart?: number; periodEnd?: number; location?: string; newDate?: ISODate };
  reason?: string;
}

export interface ConcreteEvent {
  key: string; date: ISODate; week: number; dayOfWeek: DayOfWeek; courseId: ID; sessionId: ID;
  title: string; teacher?: string;
  start: ClockTime; end: ClockTime; startMinutes: number; endMinutes: number;
  periodStart: number; periodEnd: number;
  location?: string; building?: string; colorIndex: number;
  kind?: Session['kind']; modifiedBy?: ID;
}

/** 提醒规则：按全局 / 按课程 / 按单个上课时段覆盖，越具体优先级越高 */
export type ReminderScope = 'global' | 'course' | 'session';

export interface ReminderRule {
  id: string;
  scope: ReminderScope;
  courseId?: string;
  sessionId?: string;
  /** 多个提前量，如 [15, 5]；空数组表示不提醒 */
  offsetsMinutes: number[];
  enabled: boolean;
}

/** 作业 / DDL。没有 due 就是一条普通待办 */
export interface Task {
  id: string;
  title: string;
  courseId?: string;
  due?: ISODate;
  /** 截止时刻（0:00 起算的分钟）；缺省 23:59 */
  dueMinutes?: number;
  done: boolean;
  note?: string;
}

/** 考勤：按"哪一次课"记录，不是按课程 */
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave';

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  date: ISODate;
  status: AttendanceStatus;
  note?: string;
}

export interface TimetableData {
  term: Term;
  schemes: PeriodScheme[];
  courses: Course[];
  sessions: Session[];
  overrides: Override[];
  reminderRules: ReminderRule[];
  tasks: Task[];
  attendance: AttendanceRecord[];
}

export interface Conflict { kind: string; date: ISODate; message: string; }
