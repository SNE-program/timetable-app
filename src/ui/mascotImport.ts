import { importMascotImage, importMascotPack, importMascotSheet, mascotExportText, showToast } from '../app/store';
import { prepareMascotImage } from '../theme/image';
import { describeVideoSheet, isVideoFile, videoToSpriteSheet } from '../theme/videoSheet';
import { saveTextFile } from '../platform/saveFile';

/**
 * 角色的导入 / 导出动作，抽出来两边共用。
 *
 * ## 为什么要抽出来
 *
 * 这些逻辑原来长在「角色」面板里，靠面板里的两个隐藏 input 完成；
 * 而角色中心（选 / 做 / 分享）也需要同一批动作 —— 如果各写一遍，
 * 迟早会出现"从面板导入支持视频、从中心导入不支持"这类不一致。
 * 所以文件和解析这一层只留一份，界面只负责调用与展示结果。
 *
 * 每个函数的返回：导入成功给出摘要（面板会把它们摆成一张卡片），
 * 失败给 null 并**已经弹过提示** —— 调用方不必重复报错。
 */

/** 打开系统文件选择器；用户取消时给出 null（不会一直挂着） */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise(function (resolve) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = function (f: File | null): void {
      if (done) return;
      done = true;
      try { input.remove(); } catch (e) { /* 忽略 */ }
      resolve(f);
    };
    input.addEventListener('change', function () {
      finish(input.files && input.files[0] ? input.files[0] : null);
    });
    /*
     * 取消选择时有些浏览器不派 change —— 用窗口重新获得焦点当兜底。
     * 不这么做的话，Promise 永远不 settle，界面上的"导入中"再也不会消失。
     */
    window.addEventListener('focus', function () {
      window.setTimeout(function () { if (!done && !input.files?.length) finish(null); }, 800);
    }, { once: true });
    input.click();
  });
}

/** 选一个 .json 角色包并装上 */
export async function importMascotPackFile(file: File): Promise<boolean> {
  try {
    const text = await file.text();
    const r = importMascotPack(text, file.name);
    if (!r.ok) {
      showToast('角色包导入失败：' + r.error, 'error');
      return false;
    }
    showToast('角色已就位' + (r.warnings.length ? '（' + r.warnings.length + ' 条提示）' : '') + '，按住它可以拖到别的位置', 'ok');
    if (r.warnings.length) console.warn('角色包提示：', r.warnings);
    return true;
  } catch (e) {
    showToast('这个文件读不出来：' + (e as Error).message, 'error');
    return false;
  }
}

/**
 * 用一张图或一段视频做角色。
 *
 * 视频（webm / mp4 …）走另一条管线：抽帧拼成逐帧雪碧图。
 * 二游的动图素材大量是 webm，而 webm 是视频不是图片 —— 当成图片处理只会得到"这个文件用不了"。
 */
export async function importMascotMedia(file: File, displayHeight: number): Promise<{ summary: string; notes: string[] } | null> {
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const dpr = window.devicePixelRatio || 1;
  try {
    if (isVideoFile(file)) {
      showToast('正在从视频里抽帧，可能要几秒…', 'info', undefined);
      const v = await videoToSpriteSheet(file);
      /*
       * plan.frames 一定要传下去：网格的最后一排常常排不满，
       * 那几格是全透明的，当成帧播就是"角色一闪一闪"（见 MascotArt 里的说明）。
       */
      importMascotSheet(v.src, baseName, v.plan.cols, v.plan.rows, v.plan.fps, v.plan.frames);
      const d = describeVideoSheet(v, displayHeight, dpr);
      showToast(d.summary, d.notes.length ? 'warn' : 'ok');
      return d;
    }
    /*
     * 图片：**能原样保留就原样保留**（见 prepareMascotImage）。
     * 重新压一遍是有损的二次编码，而且会把动图拍成静态图。
     * 真要压时压到 1536 长边 —— 显示高度上限 320px 在 3.5 倍屏上是 1120 物理像素。
     */
    const img = await prepareMascotImage(file, 1536, 0.94);
    importMascotImage(img.src, baseName);
    if (img.lostAnimation) {
      showToast('这张动图太大了（超过 3MB 或 150 万像素），已经压成静态图；想保留动效可以先用工具压一下再导入', 'warn');
    } else {
      showToast(img.original
        ? '已把这张图原样设为角色（没有二次压缩），按住它可以拖到别的位置'
        : '已把这张图压到 ' + img.width + '×' + img.height + ' 设为角色', 'ok');
    }
    return { summary: '已设为角色：' + baseName + '（' + img.width + '×' + img.height + '）', notes: [] };
  } catch (e) {
    showToast('这个文件用不了：' + (e as Error).message, 'error');
    return null;
  }
}

/** 导出当前角色包（安卓走系统分享面板，网页走下载） */
export async function exportMascotPackFile(): Promise<void> {
  const out = mascotExportText();
  if (!out) { showToast('本机还没有角色', 'warn'); return; }
  if (out.hasRefs) { showToast('素材还没从资产库读出来，稍后再试', 'warn'); return; }
  const r = await saveTextFile({
    fileName: out.fileName,
    text: out.text,
    mime: 'application/json',
    title: '课表助手角色包 · ' + out.fileName,
    dialogTitle: '导出角色包',
  });
  if (r === 'shared') showToast('已打开分享面板', 'ok');
  else if (r === 'saved') showToast('已保存到「文档」目录', 'ok');
  else if (r === 'cancelled') showToast('已取消', 'info');
  else showToast('导出失败', 'error');
}