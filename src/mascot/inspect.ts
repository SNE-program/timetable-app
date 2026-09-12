import { MASCOT_STATES, STATE_LABEL, frameCount, type MascotPack } from './types';
import { scanSheetCells } from '../theme/videoSheet';
import { imageSize } from '../theme/image';

/**
 * 角色检查。
 *
 * ## 为什么要有这个
 *
 * "角色显示不对"这一类问题（闪、糊、不动、干脆不显示）**全都可以量出来**：
 * 每帧多大像素、网格几格、真实几帧、屏幕上要多少物理像素、空格子占多少。
 * 量得出来就不该让用户对着屏幕猜，也不该靠来回描述来定位。
 *
 * 这里把量到的事实一条条列出来，并且**说清后果**（"会被放大 1.5 倍，看着发虚"），
 * 而不是丢一堆数字。判断用的规则抽成纯函数，能单测。
 */

export type FindingLevel = 'ok' | 'warn' | 'bad';

export interface MascotFinding {
  /** 哪一部分（待机 / 被点一下 / …） */
  label: string;
  text: string;
  level: FindingLevel;
}

export interface InspectOpts {
  /** 当前的显示高度（px） */
  displayHeight: number;
  /** 屏幕倍率 */
  dpr: number;
}

/**
 * 素材的像素够不够 —— **纯函数**。
 *
 * 判据只有一条：显示高度 × 屏幕倍率 = 需要的物理像素；
 * 素材的像素比这个少，就是被放大，就是虚。
 * 差得越多越明显，所以 1.4 倍以上直接标成 bad。
 */
export function describeResolution(cellH: number, displayHeight: number, dpr: number): { level: FindingLevel; text: string } {
  const ratio = isFinite(dpr) && dpr > 0 ? dpr : 1;
  const need = Math.round(Math.max(1, displayHeight) * ratio);
  if (!(cellH > 0)) return { level: 'warn', text: '量不到这张图的像素尺寸，没法判断清不清楚' };
  const maxClean = Math.max(1, Math.floor(cellH / ratio));
  if (cellH >= need) {
    return {
      level: 'ok',
      text: '每帧 ' + cellH + ' 像素高，显示高度 ' + Math.round(displayHeight) + 'px 在这块屏上要 '
        + need + ' 物理像素，够清楚（再放大到 ' + maxClean + 'px 也不会虚）',
    };
  }
  const factor = need / cellH;
  return {
    level: factor > 1.4 ? 'bad' : 'warn',
    text: '每帧只有 ' + cellH + ' 像素高，显示高度 ' + Math.round(displayHeight) + 'px 需要 '
      + need + ' 物理像素，会被放大 ' + factor.toFixed(2) + ' 倍，看着发虚（显示高度调到 '
      + maxClean + 'px 以内就正好了）',
  };
}

/** 逐帧图的空格子怎么说 */
export function describeBlankCells(cells: number, playing: number, emptyCells: number, measured: number): MascotFinding | null {
  if (measured >= 2 && measured < playing) {
    return {
      label: '',
      level: 'bad',
      text: '实测这张图只有 ' + measured + ' 帧（网格 ' + cells + ' 格），而当前按 ' + playing
        + ' 帧播放 —— 后面那 ' + (playing - measured) + ' 帧是空白，角色会一闪一闪。点下面的「按实测帧数修正」就好',
    };
  }
  if (emptyCells > 0) {
    return {
      label: '',
      level: playing === cells && emptyCells >= cells / 2 ? 'bad' : 'ok',
      text: '网格里有 ' + emptyCells + ' 格是空的' + (measured < cells ? '（在末尾，播放不会走到）' : ''),
    };
  }
  return null;
}

/**
 * 跑一遍检查。
 *
 * 尽量往"还能给结论"的方向降级：素材读不出来就直说读不出来，
 * 而不是抛异常让整个面板崩掉。
 */
export async function inspectMascot(pack: MascotPack, opts: InspectOpts): Promise<MascotFinding[]> {
  const out: MascotFinding[] = [];
  const dpr = isFinite(opts.dpr) && opts.dpr > 0 ? opts.dpr : 1;

  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (!a) continue;
    const label = STATE_LABEL[key];

    let size: { w: number; h: number } | null = null;
    try {
      size = await imageSize(a.src);
    } catch (e) {
      size = null;
    }
    if (!size || !size.w || !size.h) {
      out.push({ label: label, level: 'bad', text: '这张图读不出来。素材可能没有从资产库还原出来，重新导入一次角色包可以修好。' });
      continue;
    }

    if (a.kind !== 'sheet') {
      out.push({
        label: label,
        level: 'ok',
        text: (a.kind === 'animated' ? '动图' : '静态图') + ' ' + size.w + '×' + size.h
          + '（' + (a.kind === 'animated' ? '由系统播放，循环和帧率跟着文件走' : '靠呼吸/浮动动画活着') + '）',
      });
      const res = describeResolution(size.h, opts.displayHeight, dpr);
      out.push({ label: label, level: res.level, text: res.text });
      continue;
    }

    const cols = Math.max(1, Math.round(a.cols || 1));
    const rows = Math.max(1, Math.round(a.rows || 1));
    const cells = cols * rows;
    const cellW = Math.floor(size.w / cols);
    const cellH = Math.floor(size.h / rows);
    const playing = frameCount(a);

    out.push({
      label: label,
      level: 'ok',
      text: '逐帧图 ' + cols + '×' + rows + '（' + cells + ' 格）· 整图 ' + size.w + '×' + size.h
        + ' · 每帧 ' + cellW + '×' + cellH + ' 像素 · ' + (a.fps || 8) + ' fps · 当前按 ' + playing + ' 帧播放',
    });

    let measured = 0;
    let emptyCells = 0;
    let scanned = false;
    try {
      const scan = await scanSheetCells(a.src, cols, rows);
      measured = scan.frames;
      emptyCells = scan.emptyCells;
      scanned = true;
    } catch (e) {
      scanned = false;
    }
    if (scanned) {
      const blank = describeBlankCells(cells, playing, emptyCells, measured);
      if (blank) out.push({ label: label, level: blank.level, text: blank.text });
    } else {
      out.push({ label: label, level: 'warn', text: '这次量不出真实帧数（画布读不到像素）。如果它显示时一闪一闪，用编辑器里的「自动数帧」再试一次。' });
    }

    const res = describeResolution(cellH, opts.displayHeight, dpr);
    out.push({ label: label, level: res.level, text: res.text });
  }

  if (out.length === 0) out.push({ label: '角色', level: 'warn', text: '这个角色包里没有任何素材' });
  return out;
}

/** 检查结果里有没有需要动手修的（界面据此决定要不要亮出「修正」按钮） */
export function needsFix(findings: MascotFinding[]): boolean {
  return findings.some(function (f) { return f.level === 'bad'; });
}
