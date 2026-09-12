import type { ExactAlarm, Notifier, NotifierStatus, NotifyItem, Permission, ProbeStep } from './types';
import { CALL_TIMEOUT, withTimeout } from './timeout';
import { bridgeInfo, hasBridge, isNativePlatform, nativeCall, pluginPresence, platformName } from './nativeBridge';
import { APP_VERSION, BUILD_TIME } from '../app/version';

/** 通知渠道：Android 8+ 必须先建渠道，往不存在的渠道发通知会被系统静默丢弃 */
/**
 * 通知渠道。计划书 6.3 节定了四个，用户可以在系统设置里按渠道分别静音。
 * Android 8+ 必须先建渠道，往不存在的渠道发通知会被系统静默丢弃。
 */
export const CHANNELS = [
  { id: 'class-reminder', name: '上课提醒', description: '每节课开始前的提醒', importance: 5, vibration: true },
  { id: 'schedule-change', name: '课表变动', description: '调课、停课、换教室时的即时通知', importance: 4, vibration: true },
  { id: 'ddl', name: '作业与截止', description: '作业、DDL 到期提醒', importance: 4, vibration: true },
  { id: 'daily-brief', name: '明日课表', description: '每天晚上推送第二天的课', importance: 3, vibration: false },
  { id: 'silent-info', name: '其他提示', description: '低频信息，不打扰', importance: 2, vibration: false },
];

const PLUGIN = 'LocalNotifications';

/**
 * Android 实现（Capacitor + LocalNotifications）。
 *
 * 这里**不使用** `@capacitor/local-notifications` 导出的那个插件对象，
 * 而是直接用 `nativeCall` 调原生方法。原因写在 nativeBridge.ts 里，
 * 一句话：插件代理层会在取方法时按 platform 决定要不要 `import()` 网页兜底，
 * 而那条动态 import 在 Capacitor 的 WebView 里有永远不返回的风险 ——
 * 表现就是每个插件调用齐刷刷卡满 12 秒。绕开它，就再也没有可以挂住的地方。
 *
 * 每一次原生调用仍然套超时：桥真的卡住时，我们要的是"看到错误"，
 * 而不是界面永远停在"正在检测"。
 */
export class CapacitorNotifier implements Notifier {
  readonly platform = 'android';
  readonly displayName = '系统通知';
  private loadError: string | null = null;
  private items: NotifyItem[] = [];
  private channelsReady = false;
  private lastError: string | null = null;
  /** 缓存精确闹钟是否可用；null 表示还没查过 */
  private exactGranted: boolean | null = null;
  /** 上次成功读到的权限状态，查询失败时用它兜底 */
  private lastPermission: Permission | null = null;

  /**
   * 确认原生桥可用。
   *
   * 这一步是**同步**的 —— 它只读 `window.Capacitor`，不加载任何模块。
   * 之前这里是 `await import('@capacitor/local-notifications')`，
   * 那个动态 import 就是整场超时的元凶。
   */
  private ensureBridge(): void {
    if (this.loadError) throw new Error(this.loadError);
    if (!isNativePlatform()) throw new Error('不在原生环境（platform=' + platformName() + '）');
    if (!hasBridge()) throw new Error('原生桥不可用：window.Capacitor 没有 nativePromise');
  }

  isSupported(): boolean {
    return isNativePlatform();
  }

  /** 呼一次原生方法，带超时 */
  private call<T>(label: string, method: string, options?: unknown, ms?: number): Promise<T> {
    return withTimeout(
      nativeCall<T>(PLUGIN, method, options),
      ms || CALL_TIMEOUT,
      label
    );
  }

  private async ensureChannels(): Promise<void> {
    if (this.channelsReady) return;
    this.ensureBridge();
    for (const c of CHANNELS) {
      try {
        await this.call('createChannel(' + c.id + ')', 'createChannel', {
          id: c.id, name: c.name, description: c.description,
          importance: c.importance, visibility: 1, vibration: c.vibration,
        }, 4000);
      } catch (e) {
        /* 渠道已存在会被拒绝，忽略；超时也不该拦住后面的流程 */
      }
    }
    this.channelsReady = true;
  }

  /** 让「加载插件失败」可以被手动清掉，方便重试 */
  resetLoad(): void {
    this.loadError = null;
    this.channelsReady = false;
    this.exactGranted = null;
  }

  /**
   * 精确闹钟能不能用。
   *
   * 这个判断必须先做。插件在「要精确闹钟但没授权」时既不解锁也不报错，
   * 而是弹出系统设置页然后让 promise 一直挂着（LocalNotificationsPlugin.kt:126）。
   * 先查清楚，没授权就直接排非精确闹钟，绝不进那个分支。
   */
  private async ensureExactState(): Promise<boolean> {
    if (this.exactGranted !== null) return this.exactGranted;
    const st = await this.exactAlarmState();
    this.exactGranted = st === 'granted';
    return this.exactGranted;
  }

  private async exactAlarmState(): Promise<ExactAlarm> {
    try {
      const r: any = await this.call('checkExactNotificationSetting', 'checkExactNotificationSetting', {});
      return r && r.exact_alarm === 'granted' ? 'granted' : 'denied';
    } catch (e) {
      return 'unknown';
    }
  }

  /** 逐步检查：每跑完一步就立刻回调，不用等全部结束 —— 卡住也能看到卡在哪 */
  async probe(onStep?: (s: ProbeStep) => void): Promise<ProbeStep[]> {
    this.resetLoad();   /* 每次检查都从干净状态开始 */
    const steps: ProbeStep[] = [];
    /* run 里的回调是不带接收者调用的，严格模式下 this 是 undefined —— 必须先存下来 */
    const self = this;
    /* 每个步骤自己也有硬超时，不管里面发生什么都不会超过 ms */
    const run = async function (name: string, fn: () => Promise<string>, ms?: number) {
      const t0 = Date.now();
      const slot = steps.length;
      const running: ProbeStep = { name: name, ok: false, ms: 0, detail: '进行中…', running: true };
      steps.push(running);
      if (onStep) { try { onStep(running); } catch (e) { /* 忽略 */ } }

      let step: ProbeStep;
      try {
        const detail = await withTimeout(fn(), ms || 12000, name);
        step = { name: name, ok: true, ms: Date.now() - t0, detail: detail };
      } catch (e) {
        step = { name: name, ok: false, ms: Date.now() - t0, detail: (e as Error).message };
      }
      steps[slot] = step;
      if (onStep) { try { onStep(step); } catch (e) { /* 忽略 */ } }
    };

    /* 第一步先报版本号：以后任何一张截图都能立刻看出装的是哪一版 */
    await run('确认运行版本', async function () {
      return '版本 ' + (APP_VERSION || '(未知)') + '，构建于 ' + (BUILD_TIME || '(未知)');
    });
    await run('读取原生桥', async function () {
      return bridgeInfo();
    });
    await run('确认插件已注册', async function () {
      const p = pluginPresence(PLUGIN);
      if (p === 'yes') return PLUGIN + ' 已在原生侧注册';
      if (p === 'no') throw new Error('原生插件清单里没有 ' + PLUGIN + '（检查 android 侧的 capacitor.plugins.json）');
      return '拿不到原生插件清单，这一步跳过判断';
    });
    await run('加载通知插件', async function () {
      self.ensureBridge();
      return '原生桥可用，无需加载模块（同步返回）';
    });
    await run('查询通知权限', async function () {
      const p: any = await self.call('checkPermissions', 'checkPermissions', {});
      return JSON.stringify(p);
    });
    await run('创建通知渠道', async function () {
      self.channelsReady = false;
      await self.ensureChannels();
      return CHANNELS.map(function (c) { return c.id; }).join(', ');
    });
    await run('查询已排程', async function () {
      const pending: any = await self.call('getPending', 'getPending', {});
      return (pending && pending.notifications ? pending.notifications.length : 0) + ' 条';
    });
    await run('精确闹钟授权', async function () {
      return await self.exactAlarmState();
    });
    return steps;
  }

  async status(): Promise<NotifierStatus> {
    const base: NotifierStatus = {
      platform: this.platform,
      displayName: this.displayName,
      permission: 'unsupported',
      scheduled: 0,
      survivesAppClose: true,
      exactAlarm: 'unsupported',
      channels: [],
      lastError: this.lastError,
      note: '当前不在 Android 环境。',
    };
    if (!this.isSupported()) return base;

    try {
      this.ensureBridge();

      /* 三个查询并行跑，总耗时取最慢的那个，而不是三者相加 */
      const results = await Promise.all([
        this.call<any>('checkPermissions', 'checkPermissions', {}, 5000).catch(function () { return null; }),
        this.call<any>('getPending', 'getPending', {}, 5000).catch(function () { return null; }),
        this.exactAlarmState(),
      ]);
      const p: any = results[0];
      const pending: any = results[1];
      const exact = results[2] as ExactAlarm;

      /* 查不到 ≠ 被拒绝。查不到就用上次读到的值，再没有就是 unknown */
      let perm: Permission;
      if (!p) {
        perm = this.lastPermission || 'unknown';
      } else {
        perm = p.display === 'granted' ? 'granted' : (p.display === 'denied' ? 'denied' : 'default');
        this.lastPermission = perm;
      }

      this.exactGranted = exact === 'granted';
      let note = '已交给系统闹钟，息屏和关闭 App 后都会照常提醒。';
      if (perm === 'unknown') note = '通知权限暂时读不到（系统没有响应）。可以点「逐步检查」看看卡在哪一步。';
      else if (perm !== 'granted') note = '还没有通知权限，提醒不会出现。点右边的「申请」开启。';
      else if (exact === 'denied') note = '通知权限已开，但精确闹钟没授权。现在改用非精确闹钟 —— 提醒仍会出现，只是系统可能往后挪几分钟。点「授权」可恢复准点。';

      return {
        platform: this.platform,
        displayName: this.displayName,
        permission: perm,
        scheduled: pending && pending.notifications ? pending.notifications.length : 0,
        survivesAppClose: true,
        exactAlarm: exact,
        channels: this.channelsReady ? CHANNELS.map(function (c) { return c.id; }) : [],
        lastError: this.lastError,
        probing: false,
        note: note,
      };
    } catch (e) {
      this.lastError = (e as Error).message;
      return Object.assign({}, base, {
        permission: 'unknown' as Permission,
        lastError: this.lastError,
        note: '读取通知状态失败：' + this.lastError + '（可以点下面的「逐步检查」看卡在哪一步）',
      });
    }
  }

  async requestPermission(): Promise<Permission> {
    if (!this.isSupported()) return 'unsupported';
    try {
      this.ensureBridge();
      await this.ensureChannels();
      const r: any = await this.call('requestPermissions', 'requestPermissions', {});
      const p: Permission = r.display === 'granted' ? 'granted' : 'denied';
      this.lastPermission = p;
      return p;
    } catch (e) {
      this.lastError = (e as Error).message;
      return 'denied';
    }
  }

  async requestExactAlarm(): Promise<ExactAlarm> {
    if (!this.isSupported()) return 'unsupported';
    try {
      this.ensureBridge();
      await this.call('changeExactNotificationSetting', 'changeExactNotificationSetting', {}, 60000);
      this.exactGranted = null;
      return await this.exactAlarmState();
    } catch (e) {
      this.lastError = (e as Error).message;
      return 'unknown';
    }
  }

  async replaceAll(items: NotifyItem[]): Promise<void> {
    if (!this.isSupported()) return;
    this.ensureBridge();
    await this.ensureChannels();
    await this.cancelAll();
    if (items.length === 0) return;
    const sorted = items.slice().sort(function (a, b) { return a.at - b.at; });
    const exact = await this.ensureExactState();
    const notifications = sorted.map(function (it, i) {
      return {
        id: i + 1,
        title: it.title,
        body: it.body,
        schedule: { at: new Date(it.at), allowWhileIdle: true },
        channelId: it.channel || 'class-reminder',
        smallIcon: 'ic_stat_timetable',
        /* 没授权就走非精确闹钟：可能晚几分钟，但绝不会卡住调用 */
        isExactNotification: exact,
        extra: { fingerprint: it.fingerprint },
      };
    });
    try {
      await this.call('schedule(' + notifications.length + ')', 'schedule', { notifications: notifications }, 15000);
      this.items = sorted;
      this.lastError = null;
    } catch (e) {
      this.lastError = (e as Error).message;
      throw e;
    }
  }

  async cancelAll(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      this.ensureBridge();
      const pending: any = await this.call('getPending', 'getPending', {});
      const list = pending && pending.notifications ? pending.notifications : [];
      if (list.length > 0) {
        await this.call('cancel', 'cancel', { notifications: list.map(function (n: any) { return { id: n.id }; }) });
      }
      this.items = [];
    } catch (e) { /* 忽略 */ }
  }

  async fireNow(item: NotifyItem, afterMs?: number): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      this.ensureBridge();
      await this.ensureChannels();
      const exactNow = await this.ensureExactState();
      const note: Record<string, unknown> = {
        id: 999999,
        title: item.title,
        body: item.body,
        channelId: item.channel || 'class-reminder',
        smallIcon: 'ic_stat_timetable',
        isExactNotification: exactNow,
        extra: { fingerprint: item.fingerprint },
      };
      /* 提醒可靠性检查要留出锁屏的时间，所以支持延迟 */
      if (afterMs && afterMs > 0) note.schedule = { at: new Date(Date.now() + afterMs), allowWhileIdle: true };
      await this.call('schedule(' + (afterMs ? '延迟' : '立即') + ')', 'schedule', {
        notifications: [note],
      }, 15000);
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = (e as Error).message;
      return false;
    }
  }

  /**
   * 事件型通知。id 只用递增序号占位，不参与排程，所以不会跟课前提醒撞号 ——
   * 排程用的是 1..N，这里从 900000 起。
   */
  private announceSeq = 900000;

  async announce(title: string, body: string, channel?: string): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      this.ensureBridge();
      await this.ensureChannels();
      this.announceSeq = this.announceSeq >= 999000 ? 900000 : this.announceSeq + 1;
      await this.call('announce', 'schedule', {
        notifications: [{
          id: this.announceSeq,
          title: title,
          body: body,
          channelId: channel || 'schedule-change',
          smallIcon: 'ic_stat_timetable',
          /* 事件通知要立刻出现，用不上精确闹钟 */
          isExactNotification: false,
        }],
      }, 15000);
      return true;
    } catch (e) {
      this.lastError = (e as Error).message;
      return false;
    }
  }

  pending(): NotifyItem[] { return this.items.slice(); }
}
