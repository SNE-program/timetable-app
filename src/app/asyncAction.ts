/**
 * 一个把「可能永远不返回的异步操作」变得一定能结束的小工具。
 *
 * 之前的教训：界面上的忙碌状态直接 await 原生插件，
 * 插件一旦不返回，按钮就永远停在「发送中」。这里用 Promise.race 兜底，
 * 调用方只要写在 finally 里就一定能把按钮恢复。
 */
import { APP_VERSION, BUILD_TIME } from './version';

export type ActionOutcome<T> =
  | { ok: true; value: T; ms: number }
  | { ok: false; error: string; ms: number };

export function withDeadline<T>(task: Promise<T>, ms: number, label: string): Promise<ActionOutcome<T>> {
  const t0 = Date.now();
  let timer: number | null = null;
  const timeout = new Promise<ActionOutcome<T>>(function (resolve) {
    timer = window.setTimeout(function () {
      resolve({ ok: false, error: label + '超过 ' + Math.round(ms / 1000) + ' 秒没有响应', ms: Date.now() - t0 });
    }, ms);
  });
  const wrapped = task.then(
    function (v) { return { ok: true as const, value: v, ms: Date.now() - t0 }; },
    function (e) { return { ok: false as const, error: (e as Error).message || String(e), ms: Date.now() - t0 }; }
  );
  return Promise.race([wrapped, timeout]).then(function (r) {
    if (timer !== null) window.clearTimeout(timer);
    return r;
  });
}

/** 收集一份可以发给开发者看的运行信息 */
export function collectDiagnostics(extra: Record<string, string>): string {
  const lines: string[] = [];
  lines.push('版本: ' + (APP_VERSION || '未知') + '  构建时间: ' + (BUILD_TIME || '未知'));
  lines.push('UA: ' + navigator.userAgent);
  const cap = (window as any).Capacitor;
  lines.push('Capacitor: ' + (cap ? '存在' : '缺失'));
  if (cap) {
    try { lines.push('  platform: ' + (cap.getPlatform ? cap.getPlatform() : '?')); } catch (e) { lines.push('  platform: 读取失败'); }
    try { lines.push('  isNative: ' + (cap.isNativePlatform ? cap.isNativePlatform() : '?')); } catch (e) { lines.push('  isNative: 读取失败'); }
    try { lines.push('  plugins: ' + Object.keys(cap.Plugins || {}).join(', ')); } catch (e) { lines.push('  plugins: 读取失败'); }
  }
  lines.push('视口: ' + window.innerWidth + 'x' + window.innerHeight + ' dpr=' + (window.devicePixelRatio || 1));
  for (const k in extra) lines.push(k + ': ' + extra[k]);
  return lines.join('\n');
}

/** 把文本复制到剪贴板（老 WebView 用 execCommand 兜底） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 继续用兜底方案 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

