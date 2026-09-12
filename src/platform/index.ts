import { CapacitorNotifier } from './capacitorNotifier';
import { WebNotifier } from './webNotifier';
import type { Notifier, NotifyItem } from './types';

export * from './types';

let instance: Notifier | null = null;

/** 有 Android 环境就用系统通知，否则退回浏览器通知 */
export function getNotifier(onFire?: (item: NotifyItem) => void): Notifier {
  if (instance) return instance;
  const native = new CapacitorNotifier();
  instance = native.isSupported() ? native : new WebNotifier(onFire);
  return instance;
}
