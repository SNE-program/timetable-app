/**
 * 直接走 Capacitor 原生桥，绕开 @capacitor/* 的 JS 代理层。
 *
 * ## 为什么要绕
 *
 * 代理层每次取方法都会先 `await loadPluginImplementation()`，而它是按 platform
 * 决定要不要 `import()` 网页兜底实现的。插件构造函数里那句
 *
 *     registerPlugin('LocalNotifications', { web: () => import('./web-XXXX.js') })
 *
 * 会把网页兜底打成一个独立 chunk。只要这条 `import()` 走上一次，
 * 而它又恰好在 Capacitor 的 WebView 里不返回，那么**每一次插件调用都会永远挂着**
 * —— 外面套多少层超时都没用，因为连 reject 的机会都没有。
 * 手机上看到的现象就是：纯 JS 的步骤 4ms 过，一碰插件的步骤整整齐齐卡满 12001ms。
 *
 * ## 为什么可以绕
 *
 * 我们只跑安卓，网页兜底对我们没有任何意义。直接调 `cap.nativePromise`
 * 就等于代理层最终要做的那一件事（`toNative` → `androidBridge.postMessage`），
 * 但少了一次模块加载。附带好处：产物里不再有 `web-*.js` 分块，
 * 整个应用**一个动态 import 都没有**，这类故障从此不可能再发生。
 *
 * 桥不存在时（比如在浏览器里开发）会明确 reject，而不是默默挂着。
 */

/** Capacitor 注入的全局对象；拿不到就说明根本不在原生环境 */
export function getCap(): any {
  try {
    return (window as unknown as { Capacitor?: unknown }).Capacitor || null;
  } catch (e) {
    return null;
  }
}

export function isNativePlatform(): boolean {
  const cap = getCap();
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

export function platformName(): string {
  const cap = getCap();
  try {
    return cap && typeof cap.getPlatform === 'function' ? String(cap.getPlatform()) : 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

/** 原生桥是不是真的可用（不是"插件装没装"，而是"能不能发消息"） */
export function hasBridge(): boolean {
  const cap = getCap();
  if (!cap) return false;
  if (typeof cap.nativePromise === 'function') return true;
  return !!(cap.Plugins && typeof cap.Plugins === 'object');
}

/**
 * 插件是否已经在原生侧注册（诊断用）。
 *
 * 刻意做成三态：拿不到清单时返回 'unknown' 而不是 'no' ——
 * 运行信息里报假警比不报更糟，会把人引到完全错误的方向。
 */
export type PluginPresence = 'yes' | 'no' | 'unknown';

export function pluginPresence(name: string): PluginPresence {
  const cap = getCap();
  if (!cap) return 'unknown';
  if (Array.isArray(cap.PluginHeaders)) {
    for (const h of cap.PluginHeaders) { if (h && h.name === name) return 'yes'; }
    /* 原生明确给出了插件清单，没有就是真没有 */
    return 'no';
  }
  return (cap.Plugins && cap.Plugins[name]) ? 'yes' : 'unknown';
}

/** 诊断用：把桥的关键信息一次说清楚 */
export function bridgeInfo(): string {
  const cap = getCap();
  if (!cap) return '没有 window.Capacitor';
  const headers = Array.isArray(cap.PluginHeaders)
    ? cap.PluginHeaders.map(function (h: any) { return h && h.name; }).filter(Boolean)
    : null;
  return 'platform=' + platformName() +
    ' native=' + isNativePlatform() +
    ' androidBridge=' + (typeof (window as any).androidBridge !== 'undefined') +
    ' nativePromise=' + (typeof cap.nativePromise === 'function') +
    ' 原生插件=[' + (headers ? headers.join(', ') : '无 PluginHeaders') + ']';
}

/**
 * 调一个原生方法。**不走插件代理层，因此不会触发任何动态 import。**
 *
 * 只有 `cap.nativePromise` 不可用时才退回代理层 —— 那条路在浏览器里还有意义，
 * 在原生环境里不该走到。
 */
export function nativeCall<T = any>(plugin: string, method: string, options?: unknown): Promise<T> {
  const cap = getCap();
  if (!cap) return Promise.reject(new Error('原生桥不可用：没有 window.Capacitor'));

  if (typeof cap.nativePromise === 'function') {
    return cap.nativePromise(plugin, method, options || {}) as Promise<T>;
  }

  const p = cap.Plugins && cap.Plugins[plugin];
  if (p && typeof p[method] === 'function') {
    return Promise.resolve(p[method](options || {})) as Promise<T>;
  }
  return Promise.reject(new Error('原生桥不可用：拿不到 ' + plugin + '.' + method));
}
