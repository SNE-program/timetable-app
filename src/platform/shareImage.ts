import type { TimetableData } from '../core/types';
import { canvasToBase64, canvasToBlob, renderTimetableImage, type ImageOptions } from '../ui/timetableImage';
import { isNativePlatform, nativeCall } from './nativeBridge';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/* 目录常量直接写字面量，避免为了一个枚举把整个插件包引进产物 */
const DIR_CACHE = 'CACHE';
const DIR_DOCUMENTS = 'DOCUMENTS';

function isNative(): boolean {
  return isNativePlatform();
}

/**
 * 把课表图片交给用户：Android 上写进缓存目录再调系统分享面板（可以直接发微信/QQ），
 * 浏览器里优先用 Web Share，不支持就退化成下载。
 */
export async function shareTimetable(
  data: TimetableData, opts: ImageOptions, fileName: string, title: string
): Promise<ShareOutcome> {
  const canvas = renderTimetableImage(data, opts);

  if (isNative()) {
    try {
      const written: any = await nativeCall('Filesystem', 'writeFile', {
        path: fileName,
        data: canvasToBase64(canvas),
        directory: DIR_CACHE,
      });
      const canShare: any = await nativeCall('Share', 'canShare', {});
      if (canShare && canShare.value) {
        await nativeCall('Share', 'share', { title: title, text: title, url: written.uri, dialogTitle: '分享课表' });
        return 'shared';
      }
      /* 不能分享就退回到保存到文档目录 */
      await nativeCall('Filesystem', 'writeFile', {
        path: fileName,
        data: canvasToBase64(canvas),
        directory: DIR_DOCUMENTS,
      });
      return 'downloaded';
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.toLowerCase().indexOf('cancel') >= 0) return 'cancelled';
      return 'failed';
    }
  }

  /* 浏览器 */
  try {
    const blob = await canvasToBlob(canvas);
    const file = new File([blob], fileName, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title });
      return 'shared';
    }
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.toLowerCase().indexOf('cancel') >= 0 || msg.toLowerCase().indexOf('abort') >= 0) return 'cancelled';
  }

  try {
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    return 'downloaded';
  } catch (e) {
    return 'failed';
  }
}
