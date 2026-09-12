/**
 * 课表 App 核心数据模型草案（v0.1）
 * ---------------------------------------------------------------
 * 设计目标：用最小的概念集合，完整表达中国大学真实课表的全部复杂度。
 * 本文件是 packages/core 的类型契约，纯类型 + 纯函数，无 UI、无平台依赖、无网络。
 *
 * 关键决策（详见 02-architecture-design.md 第 3 节）：
 *   1. 周次用显式数组，而不是"单双周"枚举 —— 任意不规则周次都能表达。
 *   2. 节次与钟点解耦 —— 课程只说"第 3-4 节"，具体几点由作息方案决定。
 *   3. 例外用 Override 叠加 —— 停课/补课/换教室不污染原始课表。
 *   4. 所有写入走 ChangeSet —— 这让 AI 和插件天然具备"预览 + 撤销"能力。
 */

// ============================ 基础类型 ============================

export type ID = string;                 // ULID，天然有序
export type ISODate = string;            // "2025-03-03"
export type ClockTime = string;          // "08:00"
export type WeekIndex = number;          // 1 起算的教学周
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;   // 1 = 周一

/** 数据来源：用于审计与 AI 可信度展示 */
export type DataSource = "manual" | "import" | "ai" | "plugin" | "sync";

/** 所有实体的公共字段（软删除 + 版本，为多端同步预留） */
export interface Entity {
  id: ID;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;       // tombstone，同步时保留
  source: DataSource;
  confidence?: number;      // 0-1，AI/导入来源的可信度
}

// ============================ 学期 ============================

export interface Term extends Entity {
  name: string;                 // "2024-2025 学年第二学期"
  startDate: ISODate;           // 第 1 周周一
  /**
   * 教学周数；省略 = 学期不设结束，周次可以无限往后延伸。
   * 注意：它是「学期到第几周为止」，不是「时间轴有多长」。
   * 时间轴本身永远可以往后翻，只是学期结束后不再有课。
   */
  totalWeeks?: number;
  periodSchemeId: ID;           // 使用哪套作息方案
  timezone: string;             // "Asia/Shanghai"
  isActive: boolean;
}

// ============================ 作息方案 ============================
// 决定"第几节 = 几点到几点"。冬夏令时、多校区、临时调整都靠它。

export interface Period {
  index: number;                // 第几节，1 起算
  label?: string;               // "第 1 节" / "早自习"
  start: ClockTime;
  end: ClockTime;
}

export interface PeriodScheme extends Entity {
  name: string;                 // "夏季作息" / "东校区" / "冬季作息"
  periods: Period[];
  /** 每天可选的特殊说明，如周五下午不排课 */
  notes?: string;
}

// ============================ 课程（实体） ============================
// 课程的"是什么"，不含"什么时候上"。

export interface Course extends Entity {
  termId: ID;
  name: string;                 // "高等数学 A"
  teacher?: string;
  credits?: number;
  colorToken?: string;          // 语义色 token，如 "course.blue"，主题可重映射
  tags?: string[];              // "必修" / "选修" / "实验"
  note?: string;                // 教学楼位置、教师联系方式等
}

// ============================ 上课安排（时间） ============================

/**
 * 周次选择器。
 * to 省略 = 一直往后：学期不设结束时是真正无限，学期有结束时到学期末为止。
 * 判定用 O(1) 的 weekMatches(sel, week, limit)，不物化数组 —— 这是时间轴能无限延伸的关键。
 */
export type WeekSelector =
  | { type: "all" }                                     // 从第 1 周起，每周
  | { type: "range"; from: WeekIndex; to?: WeekIndex }   // 1-16 周；不写 to 就一直重复
  | { type: "list"; weeks: WeekIndex[] }                // 任意周，如 [1,2,3,7,8]（永远有限）
  | { type: "stepped"; from: WeekIndex; to?: WeekIndex; step: number }; // 单周 step=2 从1起，双周从2起

/** 能翻到的最远周次（约 100 年），纯粹是导航护栏 */
export const MAX_WEEK = 5200;

export interface Session extends Entity {
  termId: ID;
  courseId: ID;
  dayOfWeek: DayOfWeek;
  periodStart: number;          // 起始节次（含）
  periodEnd: number;            // 结束节次（含）—— 连堂课天然表达
  weeks: WeekSelector;
  location?: string;            // "A301"
  building?: string;            // "第三教学楼"，便于"下周三要去哪些楼"
  teacherOverride?: string;     // 同一门课不同老师授课
  kind?: "lecture" | "lab" | "seminar" | "exam" | "pe";
}

// ============================ 例外与调课 ============================
// 停课、补课、换教室、换时间都表达为"对某天某次课的补丁"。

export type OverrideAction = "cancel" | "reschedule" | "roomChange" | "note";

export interface Override extends Entity {
  termId: ID;
  /** 被修改的那一天；若来自调课则为原定日期 */
  date: ISODate;
  sessionId: ID;
  action: OverrideAction;
  /** reschedule 时的新安排（可只填变化的部分） */
  patch?: Partial<Pick<Session, "dayOfWeek" | "periodStart" | "periodEnd" | "location" | "building">> & {
    newDate?: ISODate;
  };
  reason?: string;              // "劳动节放假" / "教师出差"
}

// ============================ 展开后的具体事件（引擎输出） ============================

export interface ConcreteEvent {
  /** 稳定的指纹键：sessionId + 实际发生日期 */
  key: string;
  date: ISODate;
  week: WeekIndex;
  courseId: ID;
  sessionId: ID;
  title: string;
  start: ClockTime;
  end: ClockTime;
  startMinutes: number;         // 0:00 起算的分钟，便于比较
  endMinutes: number;
  location?: string;
  building?: string;
  teacher?: string;
  colorToken?: string;
  kind?: Session["kind"];
  /** 是否被 Override 影响过，UI 上可标注"已调课" */
  modifiedBy?: ID;
}

// ============================ 提醒 ============================

export type ChannelId = string;   // "system" / "widget" / "ics" / "bark" / 插件提供的渠道

export interface ReminderRule extends Entity {
  /** 作用域优先级：session > course > term > global */
  scope:
    | { type: "global" }
    | { type: "term"; termId: ID }
    | { type: "course"; courseId: ID }
    | { type: "session"; sessionId: ID };
  /** 支持多个提前量，如上课前 30 分钟 + 5 分钟 */
  offsetsMinutes: number[];
  channels: ChannelId[];
  enabled: boolean;
  /** 仅在这些周次生效，可选 */
  weeks?: WeekSelector;
}

/** 已发送记录：防止重启 / 重装 / 多端导致的重复提醒 */
export interface NotificationLog {
  /** hash(sessionId | date | offsetMinutes | channelId) */
  fingerprint: string;
  firedAt: number;
  channelId: ChannelId;
  eventKey: string;
}

// ============================ 变更集：AI 与插件的统一写入口 ============================
// AI 永不直接写数据库，只产出 ChangeSet，由核心校验并应用；应用后可一键回滚。

export interface ChangeSet {
  id: ID;
  source: DataSource;
  title: string;                // "从截图识别到 6 门课"
  createdAt: number;
  ops: ChangeOp[];
  /** AI 生成时的原始输入摘要，用于审计 */
  provenance?: { provider?: string; model?: string; inputHash?: string };
}

export type ChangeOp =
  | { op: "createCourse"; value: Omit<Course, keyof Entity> }
  | { op: "updateCourse"; id: ID; patch: Partial<Course> }
  | { op: "deleteCourse"; id: ID }
  | { op: "createSession"; value: Omit<Session, keyof Entity> }
  | { op: "updateSession"; id: ID; patch: Partial<Session> }
  | { op: "deleteSession"; id: ID }
  | { op: "createOverride"; value: Omit<Override, keyof Entity> };

/** 应用变更集的结果，用于预览 diff 与回滚 */
export interface ChangePreview {
  added: { courses: number; sessions: number; overrides: number };
  modified: number;
  removed: number;
  /** 人类可读的逐条说明，直接渲染成确认清单 */
  items: { level: "info" | "warn" | "error"; text: string }[];
  conflicts: ScheduleConflict[];
}

export interface ScheduleConflict {
  kind: "timeOverlap" | "locationJump" | "noTimeToEat" | "tooEarly";
  date: ISODate;
  eventKeys: string[];
  message: string;              // "第 3-4 节在 A301，第 5-6 节在 5 公里外的西校区"
}

// ============================ 时间引擎接口（纯函数） ============================

export interface EngineInput {
  term: Term;
  schemes: PeriodScheme[];
  courses: Course[];
  sessions: Session[];
  overrides: Override[];
}

export interface TimeEngine {
  /** 展开某一教学周的全部事件，按时间排序 */
  expandWeek(input: EngineInput, week: WeekIndex): ConcreteEvent[];
  /** 展开某一天 */
  expandDay(input: EngineInput, date: ISODate): ConcreteEvent[];
  /** 计算"下一节课"，用于今日页与小组件 */
  nextEvent(input: EngineInput, now: Date): { event: ConcreteEvent; startsInMinutes: number } | null;
  /** 计算某一天的冲突 */
  conflicts(input: EngineInput, date: ISODate): ScheduleConflict[];
  /** 计算空闲时段，供"我明天几点有空"使用 */
  freeSlots(input: EngineInput, date: ISODate): { start: ClockTime; end: ClockTime }[];
}

// ============================ AI 契约（现在就预留，暂不实现） ============================

export interface AIProvider {
  id: string;
  name: string;
  capabilities: ("text" | "vision" | "json" | "tools" | "streaming")[];
  chat(req: AIChatRequest): Promise<AIChatResponse>;
  /** 可选：流式输出，用于实时展示识别过程 */
  stream?(req: AIChatRequest): AsyncIterable<string>;
  /** 可选：成本估算，用于 token 预算控制 */
  estimateCost?(req: AIChatRequest): { inputTokens: number; outputTokens: number };
}

export interface AIChatRequest {
  messages: { role: "system" | "user" | "assistant" | "tool"; content: string }[];
  images?: { mimeType: string; base64: string }[];
  /** 结构化输出模式：模型必须返回符合该 Schema 的 JSON */
  responseSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  /** 受控工具集合，AI 只能通过这些工具访问核心数据 */
  tools?: AITool[];
}

export interface AITool {
  name: string;                 // "query_schedule" / "propose_create_session"
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema
  /** 执行方是宿主核心，不是模型 */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AIChatResponse {
  text: string;
  json?: unknown;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  usage?: { inputTokens: number; outputTokens: number };
}

/** AI 任务契约：任何 AI 能力都必须走这条流水线 */
export interface AITask<TInput, TOutput> {
  id: string;
  /** 构造提示词；把课表序列化成模型友好的紧凑文本 */
  buildPrompt: (input: TInput) => AIChatRequest;
  /** 输出必须通过的 JSON Schema */
  schema: Record<string, unknown>;
  /** 校验后的语义检查（如"周次必须在 1-20 之间"） */
  validate: (raw: unknown) => { ok: true; value: TOutput } | { ok: false; errors: string[] };
  /** 转成可预览、可回滚的变更集，而不是直接落库 */
  toChangeSet: (value: TOutput) => ChangeSet;
}

// ============================ 插件契约 ============================

export type PluginPermission =
  | "schedule:read"
  | "schedule:write"      // 仍须经 ChangeSet 与用户确认
  | "notify"
  | "network"
  | "calendar"
  | "files"
  | "ai";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  author?: string;
  description?: string;
  icon?: string;
  permissions: PluginPermission[];
  contributes: {
    importers?: { id: string; name: string; accepts: string[] }[];      // "ics" / "xlsx" / "image" / "text"
    widgets?: { id: string; name: string; size: "small" | "medium" | "large" }[];
    channels?: { id: string; name: string }[];
    themes?: { id: string; name: string }[];
    aiProviders?: { id: string; name: string }[];
    commands?: { id: string; title: string }[];
  };
  settingsSchema?: Record<string, unknown>;
}

/** 宿主暴露给插件的 API（能力令牌式，只能做被授权的事） */
export interface PluginHostAPI {
  schedule: {
    getTerm(): Promise<Term | undefined>;
    queryEvents(range: { from: ISODate; to: ISODate }): Promise<ConcreteEvent[]>;
    proposeChange(set: ChangeSet): Promise<ChangePreview>;
  };
  notify: { send(message: { title: string; body: string }): Promise<void> };
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  log: (level: "info" | "warn" | "error", message: string) => void;
}

export interface Plugin {
  manifest: PluginManifest;
  activate(host: PluginHostAPI): Promise<void>;
  deactivate?(): Promise<void>;
  /** 事件钩子：可观察、部分可修改 */
  hooks?: {
    onScheduleChanged?(set: ChangeSet): void;
    beforeNotify?(payload: { title: string; body: string }): { title: string; body: string } | void;
    resolveNextEvent?(fallback: ConcreteEvent | null): ConcreteEvent | null | void;
  };
}
