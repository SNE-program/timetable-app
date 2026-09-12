import {
  FPS_MAX, FPS_MIN, HEIGHT_MAX, HEIGHT_MIN, MASCOT_STATES, SHEET_MAX, clampHeight, defaultInteractive,
  defaultMotion, frameCount, type MascotAsset, type MascotAssetKind, type MascotPack, type MascotState,
} from './types';
import { ASSET_PREFIX, assetKey, contentHash, isAssetRef, isInlineImage, toAssetRef } from '../storage/assetRef';

/**
 * 角色包：格式定义、校验与资产外置。
 *
 * 这几件事全部照搬主题包那一套（`src/theme/themeFile.ts` + `src/storage/assetRef.ts`），
 * 因为它们踩过的坑是一样的：
 *
 *   - 图片动辄几 MB，直接写进 localStorage 会顶满配额 → 外置成 `asset:<key>` 存进 SQLite；
 *   - 冷启动是"先同步读盘、再异步还原图片"，所以**校验必须放行 `asset:` 引用**，
 *     否则每次重启都会在还原之前把素材判成无效清掉（这个 bug 主题包上出过一次）；
 *   - 主题包必须是自包含的，角色包同理 —— 里面出现本机引用就明确拒绝，
 *     而不是留一个渲染不出来的空角色。
 */

export const MASCOT_FORMAT = 'timetable-mascot';
export const MASCOT_VERSION = 1;
export const MASCOT_EXT = '.mascot';

export interface MascotFile {
  format: string;
  version: number;
  exportedAt: string;
  /** 素材清单，便于人打开包看一眼里面有什么 */
  assets: { state: MascotState; kind: MascotAssetKind; mime: string; bytes: number }[];
  mascot: MascotPack;
}

export interface ValidateMascotResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  pack?: MascotPack;
}

/* ------------------------------ 小工具 ------------------------------ */

function isImageDataUri(s: string): boolean {
  return typeof s === 'string' && s.indexOf('data:image/') === 0 && s.length > 32;
}

function mimeOf(src: string): string {
  const m = /^data:([^;,]+)/.exec(src);
  return m ? m[1] : 'application/octet-stream';
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

const KINDS: MascotAssetKind[] = ['still', 'animated', 'sheet'];

/** 素材可用 = 内嵌图片，或（本机存盘后）的 asset 引用 */
function usableSrc(src: string): boolean {
  return isImageDataUri(src) || isAssetRef(src);
}

/**
 * 把用户直接拖进来的一张图包成一个最小角色包。
 *
 * "只放一张图"必须是能走通的路径：大多数人不会去手写 JSON，
 * 拖一张图进来就应该有个能用的角色。
 */
export function packFromImage(dataUri: string, name: string): MascotPack {
  return {
    format: MASCOT_FORMAT,
    version: MASCOT_VERSION,
    id: 'local-' + contentHash(dataUri).slice(0, 12),
    name: name || '我的角色',
    createdAt: new Date().toISOString(),
    height: 140,
    states: { idle: { kind: 'still', src: dataUri } },
    motion: defaultMotion(),
    interactive: defaultInteractive(),
    shadow: true,
    anchor: { x: 0.5, y: 1 },
  };
}

/**
 * 从一段视频抽出来的雪碧图建角色。
 *
 * 和 `packFromImage` 只差素材形态：视频只能变成逐帧图（四格以上的网格），
 * 所以这里必须带上格数与帧率，不能像单张图那样"剩下的交给程序化动画"。
 */
export function packFromSheet(
  dataUri: string, name: string, cols: number, rows: number, fps: number, frames?: number
): MascotPack {
  return {
    format: MASCOT_FORMAT,
    version: MASCOT_VERSION,
    id: 'local-' + contentHash(dataUri).slice(0, 12),
    name: name || '我的角色',
    createdAt: new Date().toISOString(),
    height: 140,
    /*
     * frames 必须带过来：网格格数常常大于真实帧数（最后一排排不满），
     * 不带的话播放会走到全透明的空格子上 —— 就是"角色一闪一闪"那个 bug。
     */
    states: { idle: sheetAsset(dataUri, cols, rows, fps, frames) },
    /* 逐帧图自己会动，程序化动画幅度给小一点，免得两种动效打架 */
    motion: { breathe: 0, bob: 0, sway: 0 },
    interactive: defaultInteractive(),
    shadow: true,
    anchor: { x: 0.5, y: 1 },
  };
}

/**
 * 拼一个逐帧图素材，顺手把 **真实帧数** 收进合法范围。
 *
 * `frames` 缺省时按"网格排满"处理（老包的行为）；只有真的少了几帧才写进对象里，
 * 这样排满的包存盘后和以前一模一样，不会平白多出一个字段。
 */
export function sheetAsset(
  src: string, cols: number, rows: number, fps: number, frames?: number
): MascotAsset {
  const c = Math.min(SHEET_MAX, Math.max(1, Math.round(cols || 1)));
  const r = Math.min(SHEET_MAX, Math.max(1, Math.round(rows || 1)));
  const cells = c * r;
  const asset: MascotAsset = {
    kind: 'sheet',
    src: src,
    cols: c,
    rows: r,
    fps: Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(fps || 8))),
  };
  const f = frames === undefined || frames === null ? cells : Math.round(Number(frames));
  if (isFinite(f) && f >= 2 && f < cells) asset.frames = f;
  return asset;
}

/* ------------------------------ 校验 ------------------------------ */

export function validateMascotPack(raw: unknown): ValidateMascotResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['不是有效的角色包'], warnings: warnings };
  }
  const obj = raw as Record<string, unknown>;

  /*
   * 区分"包文件"和"裸包"：**看有没有 mascot 字段**，不是看 format ——
   * 手写的裸包同样会写 format。用户想手搓一个最小角色包时，
   * 不该被迫多套一层壳。
   */
  if (typeof obj.format === 'string' && obj.format !== MASCOT_FORMAT) {
    return { ok: false, errors: ['文件格式不是课表角色包（format 应为 ' + MASCOT_FORMAT + '）'], warnings: warnings };
  }

  let src = obj;
  if (obj.mascot && typeof obj.mascot === 'object') {
    const ver = num(obj.version, 0, 0, 999);
    if (ver > MASCOT_VERSION) warnings.push('角色包版本（' + ver + '）高于当前应用支持的版本（' + MASCOT_VERSION + '），部分设置可能被忽略');
    src = obj.mascot as Record<string, unknown>;
  }

  /* 素材 */
  const statesRaw = (src.states && typeof src.states === 'object' ? src.states : {}) as Record<string, unknown>;
  const states: Partial<Record<MascotState, MascotAsset>> = {};
  for (const key of MASCOT_STATES) {
    const a = statesRaw[key];
    if (!a || typeof a !== 'object') continue;
    const ao = a as Record<string, unknown>;
    const kind = (KINDS.indexOf(ao.kind as MascotAssetKind) >= 0 ? ao.kind : 'still') as MascotAssetKind;
    const uri = typeof ao.src === 'string' ? ao.src : '';
    if (!usableSrc(uri)) {
      warnings.push('「' + key + '」的图片缺失或不是内嵌图片，已跳过这个状态');
      continue;
    }
    const asset: MascotAsset = { kind: kind, src: uri };
    if (kind === 'sheet') {
      asset.cols = num(ao.cols, 1, 1, SHEET_MAX);
      asset.rows = num(ao.rows, 1, 1, SHEET_MAX);
      asset.fps = num(ao.fps, 8, FPS_MIN, FPS_MAX);
      if (asset.cols * asset.rows < 2) {
        warnings.push('「' + key + '」标成了逐帧图但只有一格，已按静态图处理');
        asset.kind = 'still';
        asset.cols = undefined;
        asset.rows = undefined;
        asset.frames = undefined;
      } else {
        /*
         * 真实帧数。缺省 = 网格格数（老角色包就是这个语义）。
         * 写多了会播到空格子上（角色会闪），所以夹到格数以内；
         * 写少了只是少播几帧，属于用户自己的选择，照收。
         */
        const cells = asset.cols * asset.rows;
        const raw = ao.frames === undefined || ao.frames === null ? NaN : Math.round(Number(ao.frames));
        if (isFinite(raw)) {
          if (raw > cells) {
            warnings.push('「' + key + '」的帧数（' + raw + '）超过了格数（' + cells + '），已按格数处理');
          } else if (raw >= 2) {
            asset.frames = raw;
          }
          /* raw < 2 属于"没填对"：不写字段，退回"按网格格数播"，与旧版一致 */
        }
      }
    }
    states[key] = asset;
  }

  if (!states.idle) {
    errors.push('角色包缺少「待机」状态的图片（states.idle）；这是唯一必须有的素材');
  }

  const mRaw = (src.motion && typeof src.motion === 'object' ? src.motion : {}) as Record<string, unknown>;
  const iRaw = (src.interactive && typeof src.interactive === 'object' ? src.interactive : {}) as Record<string, unknown>;
  const aRaw = (src.anchor && typeof src.anchor === 'object' ? src.anchor : {}) as Record<string, unknown>;

  const pack: MascotPack = {
    format: MASCOT_FORMAT,
    version: MASCOT_VERSION,
    id: str(src.id, 'mascot-' + Date.now()),
    name: str(src.name, '未命名角色'),
    author: typeof src.author === 'string' ? src.author : undefined,
    description: typeof src.description === 'string' ? src.description : undefined,
    createdAt: str(src.createdAt, new Date().toISOString()),
    height: clampHeight(num(src.height, 140, HEIGHT_MIN, HEIGHT_MAX)),
    states: states,
    motion: {
      breathe: num(mRaw.breathe, 0.02, 0, 0.08),
      bob: num(mRaw.bob, 0.01, 0, 0.06),
      sway: num(mRaw.sway, 0, 0, 8),
    },
    interactive: {
      click: iRaw.click === undefined ? true : !!iRaw.click,
      drag: iRaw.drag === undefined ? true : !!iRaw.drag,
    },
    shadow: src.shadow === undefined ? true : !!src.shadow,
    anchor: { x: num(aRaw.x, 0.5, 0, 1), y: num(aRaw.y, 1, 0, 1) },
  };

  if (errors.length) return { ok: false, errors: errors, warnings: warnings };
  return { ok: true, errors: [], warnings: warnings, pack: pack };
}

/* ------------------------------ 打包与解析 ------------------------------ */

export function mascotFileName(pack: MascotPack): string {
  const safe = (pack.name || 'mascot').replace(/[\\/:*?"<>|\s]+/g, '-');
  return safe + MASCOT_EXT + '.json';
}

export function buildMascotFile(pack: MascotPack): MascotFile {
  const assets: MascotFile['assets'] = [];
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (!a || !isImageDataUri(a.src)) continue;
    assets.push({ state: key, kind: a.kind, mime: mimeOf(a.src), bytes: Math.round(a.src.length * 0.75) });
  }
  return { format: MASCOT_FORMAT, version: MASCOT_VERSION, exportedAt: new Date().toISOString(), assets: assets, mascot: pack };
}

/**
 * 生成可写盘的角色包文本。
 *
 * 和主题包一样，这里明确拦一道：内存里如果还是 `asset:<key>` 引用，
 * 写出去的包里就是一张空图 —— 宁可报错也不导出坏包。
 */
export function mascotFileText(pack: MascotPack): { fileName: string; text: string; bytes: number; hasRefs: boolean } {
  let hasRefs = false;
  const states: Partial<Record<MascotState, MascotAsset>> = {};
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (!a) continue;
    if (isAssetRef(a.src)) { hasRefs = true; continue; }
    states[key] = a;
  }
  const packable: MascotPack = Object.assign({}, pack, { states: states });
  const text = JSON.stringify(buildMascotFile(packable), null, 2);
  return { fileName: mascotFileName(pack), text: text, bytes: text.length, hasRefs: hasRefs };
}

export function parseMascotFileText(text: string): ValidateMascotResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: ['文件不是合法的 JSON，可能不是角色包'], warnings: [] };
  }
  return validateMascotPack(json);
}

/* ------------------------------ 图片外置与还原 ------------------------------ */

export interface MascotExtractResult {
  pack: MascotPack;
  assets: { key: string; uri: string }[];
}

/**
 * 把角色的大图抽出来，原位换成 `asset:<key>` 引用。
 * 纯函数，不改动入参；什么都没抽出来时返回原对象（调用方常常拿引用做比较）。
 */
export function extractMascotAssets(pack: MascotPack): MascotExtractResult {
  const assets: { key: string; uri: string }[] = [];
  const seen: Record<string, string> = {};
  let touched = false;

  const take = function (uri: string): string {
    if (!isInlineImage(uri)) return uri;
    const key = contentHash(uri);
    if (!seen[key]) { seen[key] = key; assets.push({ key: key, uri: uri }); }
    touched = true;
    return toAssetRef(key);
  };

  const states: Partial<Record<MascotState, MascotAsset>> = {};
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (!a) continue;
    states[key] = Object.assign({}, a, { src: take(a.src) });
  }

  if (!touched) return { pack: pack, assets: [] };
  return { pack: Object.assign({}, pack, { states: states }), assets: assets };
}

/** 还原成 data URI；查不到的引用降级成空串，由调用方判断整包是否还可用 */
export function hydrateMascot(pack: MascotPack, lookup: (key: string) => string | null): MascotPack {
  let touched = false;
  const states: Partial<Record<MascotState, MascotAsset>> = {};

  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (!a) continue;
    if (!isAssetRef(a.src)) { states[key] = a; continue; }
    touched = true;
    const got = lookup(assetKey(a.src));
    if (got === null) continue;   /* 素材真丢了：直接去掉这个状态 */
    states[key] = Object.assign({}, a, { src: got });
  }

  if (!touched) return pack;
  return Object.assign({}, pack, { states: states });
}

/** 收集角色包用到的所有资产 key，用于占用统计与孤儿清理 */
export function collectMascotKeys(pack: MascotPack | null): string[] {
  if (!pack) return [];
  const out: string[] = [];
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (a && isAssetRef(a.src)) out.push(assetKey(a.src));
  }
  return out;
}

/** 界面上给用户看的素材摘要，例如「逐帧图 4×6 · 12 fps」 */
export function describeAsset(a: MascotAsset | undefined): string {
  if (!a) return '未提供';
  if (a.kind === 'still') return '静态图（靠呼吸/浮动动画让它动）';
  if (a.kind === 'animated') return '动图（浏览器原生播放）';
  const cells = (a.cols || 1) * (a.rows || 1);
  const n = frameCount(a);
  /* 格数和真实帧数不一样时两个都写出来 —— "为什么它会闪"看这一行就够了 */
  const frameText = n < cells ? '共 ' + n + ' 帧（网格 ' + cells + ' 格）' : '共 ' + n + ' 帧';
  return '逐帧图 ' + (a.cols || 1) + '×' + (a.rows || 1) + ' · ' + frameText + ' · ' + (a.fps || 8) + ' fps';
}

/** 包里带了哪些状态，界面上的"能力清单"用 */
export function providedStates(pack: MascotPack): MascotState[] {
  return MASCOT_STATES.filter(function (k) { return !!pack.states[k]; });
}
