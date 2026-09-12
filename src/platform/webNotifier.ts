import type { ExactAlarm, Notifier, NotifierStatus, NotifyItem, Permission } from './types';

/**
 * 浏览器实现。
 * 诚实说明：页面关掉之后 setTimeout 不会继续跑，所以它只在标签页开着时可靠。
 * 真正的"关掉 App 也能提醒"由 Android 实现负责。
 */
export class WebNotifier implements Notifier {
  readonly platform = 'web';
  readonly displayName = '浏览器通知';
  private timers: Record<string, number> = {};
  private items: NotifyItem[] = [];
  private onFire: (item: NotifyItem) => void;
  private lastError: string | null = null;

  constructor(onFire?: (item: NotifyItem) => void) {
    this.onFire = onFire || function () { /* 无回调 */ };
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  permission(): Permission {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission as Permission;
  }

  async status(): Promise<NotifierStatus> {
    return {
      platform: this.platform,
      displayName: this.displayName,
      permission: this.permission(),
      scheduled: this.items.length,
      survivesAppClose: false,
      exactAlarm: 'unsupported',
      channels: [],
      lastError: this.lastError,
      note: this.isSupported()
        ? '页面开着时准时提醒；关掉页面就不会响。装上 Android 版才能在 App 关闭后照常提醒。'
        : '当前浏览器不支持系统通知。',
    };
  }

  async requestPermission(): Promise<Permission> {
    if (!this.isSupported()) return 'unsupported';
    try {
      const r = await Notification.requestPermission();
      return r as Permission;
    } catch (e) {
      this.lastError = (e as Error).message;
      return 'denied';
    }
  }

  async requestExactAlarm(): Promise<ExactAlarm> { return 'unsupported'; }

  private clearTimers(): void {
    for (const k in this.timers) window.clearTimeout(this.timers[k]);
    this.timers = {};
  }

  async replaceAll(items: NotifyItem[]): Promise<void> {
    this.clearTimers();
    const now = Date.now();
    this.items = items.slice().sort(function (a, b) { return a.at - b.at; });
    const self = this;
    for (const it of this.items) {
      const delay = it.at - now;
      if (delay <= 0) continue;
      /* setTimeout 上限约 24.8 天，滚动窗口是 7 天，安全 */
      this.timers[it.fingerprint] = window.setTimeout(function () {
        void self.deliver(it);
      }, delay);
    }
  }

  /** 事件型通知：立刻弹一条，不进排程 */
  async announce(title: string, body: string): Promise<boolean> {
    if (this.permission() !== 'granted') { this.lastError = '没有通知权限'; return false; }
    try {
      new Notification(title, { body: body, tag: 'announce-' + Date.now() });
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = (e as Error).message;
      return false;
    }
  }

  private async deliver(item: NotifyItem): Promise<void> {
    delete this.timers[item.fingerprint];
    if (this.permission() === 'granted') {
      try {
        new Notification(item.title, { body: item.body, tag: item.fingerprint });
        this.lastError = null;
      } catch (e) {
        this.lastError = (e as Error).message;
      }
    } else {
      this.lastError = '没有通知权限';
    }
    this.onFire(item);
  }

  async cancelAll(): Promise<void> {
    this.clearTimers();
    this.items = [];
  }

  async fireNow(item: NotifyItem, afterMs?: number): Promise<boolean> {
    if (this.permission() !== 'granted') { this.lastError = '没有通知权限'; return false; }
    if (afterMs && afterMs > 0) {
      /* 浏览器里页面得一直开着才有效 —— 设置页对此有如实说明 */
      const self = this;
      window.setTimeout(function () { void self.announce(item.title, item.body); }, afterMs);
      return true;
    }
    try {
      new Notification(item.title, { body: item.body, tag: item.fingerprint });
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = (e as Error).message;
      return false;
    }
  }

  pending(): NotifyItem[] { return this.items.slice(); }
}
