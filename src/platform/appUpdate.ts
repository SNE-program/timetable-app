import { nativeCall } from './nativeBridge';

/**
 * 应用内更新（原生那一半）。
 *
 * 规矩和别的原生调用一样：**只有这个文件碰原生**，而且一律走 nativeCall，
 * 不 import 任何 @capacitor/* —— 安卓 WebView 里动态 import 插件会挂死（踩过）。
 *
 * 这个文件只做三件事：问能不能装、把他送到授权页、下载并调起安装器。
 * "装不装"永远由用户在系统弹窗里决定 —— 安卓不给普通应用静默安装的权力。
 */

export interface CanInstallResult {
  allowed: boolean;
  sdk: number;
}

export async function canInstallApk(): Promise<CanInstallResult | null> {
  try {
    const r = await nativeCall<CanInstallResult>('AppUpdate', 'canInstall', {});
    return r && typeof r.allowed === 'boolean' ? r : null;
  } catch (e) {
    return null;
  }
}

export async function openInstallSettings(): Promise<boolean> {
  try {
    await nativeCall('AppUpdate', 'openInstallSettings', {});
    return true;
  } catch (e) {
    return false;
  }
}

export async function clearDownloadedApk(): Promise<void> {
  try { await nativeCall('AppUpdate', 'clearDownloaded', {}); } catch (e) { /* 清理失败无所谓 */ }
}

/**
 * 下载安装包并调起系统安装器。
 *
 * onProgress 会收到 0–100 的百分比；事件名是 progress。
 * 监听器用完要摘掉 —— 更新这种低频动作留下的监听会一直挂在浏览器里。
 */
export async function downloadAndInstallApk(
  urls: string[], fileName: string, onProgress?: (percent: number) => void
): Promise<{ ok: boolean; error?: string }> {
  const cap = typeof window !== 'undefined' ? (window as unknown as { Capacitor?: any }).Capacitor : null;
  const plugin = cap && cap.Plugins ? cap.Plugins.AppUpdate : null;
  let handle: { remove?: () => void } | null = null;
  if (plugin && plugin.addListener && onProgress) {
    try {
      handle = plugin.addListener('progress', function (data: { percent?: number }) {
        const p = typeof data.percent === 'number' ? data.percent : 0;
        onProgress(Math.max(0, Math.min(100, p)));
      });
    } catch (e) { handle = null; }
  }
  try {
    await nativeCall('AppUpdate', 'downloadAndInstall', { urls: urls, fileName: fileName });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || '下载失败' };
  } finally {
    if (handle && handle.remove) { try { handle.remove(); } catch (e) { /* 忽略 */ } }
  }
}
