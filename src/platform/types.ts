/** 通知平台层的公共契约：Web 与 Android 各有实现，上层只认这个接口 */

export interface NotifyItem {
  fingerprint: string;
  title: string;
  body: string;
  /** 计划发出时间（epoch ms） */
  at: number;
  /** 通知渠道（Android 上必须事先创建，否则会被静默丢弃） */
  channel?: string;
}

/** unknown = 查询本身失败了，不能当成「被拒绝」 */
export type Permission = 'granted' | 'denied' | 'default' | 'unsupported' | 'unknown';

/** 精确闹钟授权状态（Android 12+ 需要单独授权，否则提醒会被系统延迟） */
export type ExactAlarm = 'granted' | 'denied' | 'unknown' | 'unsupported';

export interface ProbeStep { name: string; ok: boolean; ms: number; detail: string; running?: boolean; }

export interface NotifierStatus {
  platform: string;
  displayName: string;
  permission: Permission;
  /** 当前已排入系统的通知条数 */
  scheduled: number;
  /** 能否在 App 关闭后仍然准时提醒 */
  survivesAppClose: boolean;
  exactAlarm: ExactAlarm;
  /** 已创建的渠道 id 列表 */
  channels: string[];
  /** 最近一次失败原因，便于排查 */
  lastError: string | null;
  /** 还在检测中（避免界面误显示成「未申请」） */
  probing?: boolean;
  /** 给用户看的一句实话 */
  note: string;
}

export interface Notifier {
  readonly platform: string;
  readonly displayName: string;
  isSupported(): boolean;
  status(): Promise<NotifierStatus>;
  requestPermission(): Promise<Permission>;
  /** 打开系统的精确闹钟授权页（Android 12+） */
  requestExactAlarm(): Promise<ExactAlarm>;
  /** 用一份完整计划替换当前排程（内部负责清掉旧的） */
  replaceAll(items: NotifyItem[]): Promise<void>;
  cancelAll(): Promise<void>;
  /**
   * 发一条，用于错过补偿与"测试通知"。
   * afterMs 给定时延迟这么久再响 —— 真机测试要留出锁屏的时间。
   */
  fireNow(item: NotifyItem, afterMs?: number): Promise<boolean>;
  /**
   * 发一条**事件型**通知：立刻显示，不进排程、不参与指纹去重。
   * 用于「课表变动」这类由用户操作触发、需要留个记录在通知栏的场景。
   */
  announce(title: string, body: string, channel?: string): Promise<boolean>;
  /** 当前排程快照，供 UI 展示 */
  pending(): NotifyItem[];
  /** 可选：逐步检查，把卡住的那一步暴露出来 */
  probe?(onStep?: (s: ProbeStep) => void): Promise<ProbeStep[]>;
}
