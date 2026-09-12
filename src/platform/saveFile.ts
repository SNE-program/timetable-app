import { isNativePlatform, nativeCall } from './nativeBridge';

/**
 * 把一份文本交给用户（导出/分享）。
 *
 * ## 为什么不能再用 `a.download`
 *
 * 浏览器里给隐藏的 <a> 设 download 再 click() 就能存文件，**WebView 里不行**：
 * Capacitor 的安卓 WebView 没有下载宿主，这个 click 会被直接丢掉 ——
 * 点了"导出主题包"什么都不发生，用户看到的就是"这个功能没做"。
 *
 * ## 所以原生走 Filesystem + Share
 *
 * 先把文件写进应用缓存目录（一定写得进去，不需要任何存储权限），
 * 再调系统分享面板。用户在面板里可以"保存到文件"、发微信、发邮件、
 * 传到自己电脑 —— 比直接扔进某个目录更好找，也不用申请存储权限。
 *
 * 分享不可用时（极少数 ROM）退回到公共「文档」目录，仍然不需要权限：
 * 那是应用自己创建的目录，安卓 11+ 允许应用访问。
 *
 * 目录与编码常量直接写字面量：为了一个枚举把整个插件包引进产物不值得，
 * 而且这些值就是协议的一部分，不会变。
 */

export type SaveOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

const DIR_CACHE = 'CACHE';
const DIR_DOCUMENTS = 'DOCUMENTS';
const ENC_UTF8 = 'utf8';

/*
 * 原生调用一律加时限。
 *
 * @capacitor/share 安卓端有一个真实的坑：`Share.share` 开头是
 * `if (!isPresenting)` —— 分享面板已经开着时，第二次调用**既不 resolve 也不 reject**。
 * 没有时限的话，导出按钮会静默卡死，连一句失败提示都给不出来，
 * 而"点了没反应"正是这次要修的那类问题。
 */
const T_WRITE = 20000;
const T_PROBE = 5000;
const T_SHARE = 300000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>(function (resolve, reject) {
    let done = false;
    const timer = window.setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error(what + '没有响应（超过 ' + Math.round(ms / 1000) + ' 秒）'));
    }, ms);
    p.then(
      function (v) { if (done) return; done = true; window.clearTimeout(timer); resolve(v); },
      function (e) { if (done) return; done = true; window.clearTimeout(timer); reject(e); }
    );
  });
}

/** 上一次保存失败的原因，调用方拼提示用 */
let lastError = '';
export function lastSaveError(): string { return lastError; }

function setError(e: unknown): void {
  const msg = (e as Error)?.message || String(e);
  lastError = msg;
}

/** 浏览器里的退路：这一步在真正的浏览器中是可以用的 */
function webDownload(fileName: string, text: string, mime: string): boolean {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return true;
  } catch (e) {
    setError(e);
    return false;
  }
}

function isCancel(e: unknown): boolean {
  const m = ((e as Error)?.message || '').toLowerCase();
  return m.indexOf('cancel') >= 0 || m.indexOf('abort') >= 0 || m.indexOf('dismiss') >= 0;
}

export interface SaveTextOptions {
  fileName: string;
  text: string;
  mime: string;
  /** 分享面板的标题，也是系统里预览时显示的名字 */
  title: string;
  /** 一次写入的内容超过这个体积就提醒用户（分享面板对大文件不友好） */
  dialogTitle?: string;
}

/**
 * 保存或分享一份文本文件。
 *
 * 永不抛异常：失败通过返回值 + lastSaveError() 表达 —— 导出是"顺手一做"的动作，
 * 不该把一个未捕获的 Promise 拒绝丢进控制台。
 */
export async function saveTextFile(opts: SaveTextOptions): Promise<SaveOutcome> {
  lastError = '';

  if (!isNativePlatform()) {
    return webDownload(opts.fileName, opts.text, opts.mime) ? 'saved' : 'failed';
  }

  let cacheUri = '';

  try {
    const written: any = await withTimeout(nativeCall('Filesystem', 'writeFile', {
      path: opts.fileName,
      data: opts.text,
      directory: DIR_CACHE,
      encoding: ENC_UTF8,
      recursive: true,
    }), T_WRITE, '写入文件');
    cacheUri = written && written.uri ? String(written.uri) : '';
  } catch (e) {
    if (isCancel(e)) return 'cancelled';
    setError(e);
    return 'failed';
  }

  /* 先问一句能不能分享；探测接口本身出问题就直接试分享，别把整条路堵死 */
  let canShare = true;
  try {
    const r: any = await withTimeout(nativeCall('Share', 'canShare', {}), T_PROBE, '查询分享能力');
    canShare = !!(r && r.value);
  } catch (e) {
    canShare = true;
  }

  if (canShare) {
    try {
      await withTimeout(nativeCall('Share', 'share', {
        title: opts.title,
        text: opts.title,
        url: cacheUri || opts.fileName,
        dialogTitle: opts.dialogTitle || opts.title,
      }), T_SHARE, '分享面板');
      return 'shared';
    } catch (e) {
      if (isCancel(e)) return 'cancelled';
      /* 分享这一步失败不等于导出失败：文件已经在缓存里，落到「文档」目录一样能拿到 */
    }
  }

  try {
    await withTimeout(nativeCall('Filesystem', 'writeFile', {
      path: opts.fileName,
      data: opts.text,
      directory: DIR_DOCUMENTS,
      encoding: ENC_UTF8,
      recursive: true,
    }), T_WRITE, '写入文档目录');
    return 'saved';
  } catch (e) {
    if (isCancel(e)) return 'cancelled';
    setError(e);
    return 'failed';
  }
}
