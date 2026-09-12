import { isNativePlatform, nativeCall } from './nativeBridge';

export interface ReliabilityInfo {
  /** 是否已把本应用排除在电池优化之外 */
  batteryUnrestricted: boolean;
  manufacturer: string;
  sdk: number;
}

export interface ReschedulePending {
  /** 系统时间 / 时区变过、应用更新过，提醒需要重排 */
  pending: boolean;
  /** 给用户看的原因（"时区变化"这种） */
  reason: string;
  at: number;
}

export interface ReliabilityPluginApi {
  check(): Promise<ReliabilityInfo>;
  /** 读"待重排"标记；由原生侧的 SystemChangeReceiver 写下 */
  pendingReschedule(): Promise<ReschedulePending>;
  clearReschedule(): Promise<void>;
  /** 直接清空通知排程记录，绕过插件（记录累积过多时插件调用会变得极慢） */
  resetNotifications(): Promise<{ cleared: boolean }>;
  openBatterySettings(): Promise<void>;
  openAutoStartSettings(): Promise<void>;
  openAppDetails(): Promise<void>;
}

const PLUGIN = 'Reliability';

/**
 * 同样走原生桥而不是 registerPlugin —— 理由见 nativeBridge.ts。
 * 这么写还有个额外好处：整个 `@capacitor/core` 都不再进产物，
 * 启动时少解析一百多 KB。
 */
export const Reliability: ReliabilityPluginApi = {
  check: function () { return nativeCall<ReliabilityInfo>(PLUGIN, 'check', {}); },
  pendingReschedule: function () { return nativeCall<ReschedulePending>(PLUGIN, 'pendingReschedule', {}); },
  clearReschedule: function () { return nativeCall<void>(PLUGIN, 'clearReschedule', {}); },
  resetNotifications: function () { return nativeCall<{ cleared: boolean }>(PLUGIN, 'resetNotifications', {}); },
  openBatterySettings: function () { return nativeCall<void>(PLUGIN, 'openBatterySettings', {}); },
  openAutoStartSettings: function () { return nativeCall<void>(PLUGIN, 'openAutoStartSettings', {}); },
  openAppDetails: function () { return nativeCall<void>(PLUGIN, 'openAppDetails', {}); },
};

/** Web 上没有这个插件，调用会抛错，这里统一兜底 */
export function isReliabilitySupported(): boolean {
  return isNativePlatform();
}
