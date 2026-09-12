import {
  FPS_MAX, FPS_MIN, MASCOT_STATES, SHEET_MAX, STATE_LABEL, clampHeight, defaultInteractive, defaultMotion,
  type MascotAsset, type MascotAssetKind, type MascotMotion, type MascotPack, type MascotState,
} from './types';
import { validateMascotPack } from './pack';

/**
 * 角色编辑器里的"草稿"模型。
 *
 * ## 为什么要单独一层
 *
 * 编辑器里用户会填到一半、会来回改、会留空。而**角色包必须是完整合法的** ——
 * 半个包写进 localStorage 就是"设置了角色但界面上什么都没有"。
 * 所以中间隔一层草稿：界面只改草稿，草稿经 `buildPack` 变成包时再统一收敛。
 *
 * 好处不只是安全：`buildPack` / `draftFromPack` 是纯函数，
 * **能直接单测** —— 表单这种东西最难测，把语义抽出来就都测得到了。
 *
 * ## 草稿里多出来的两个字段
 *
 * `width` / `height` 只用于界面提示（"每帧 128×160"这种），**不写进角色包**：
 * 包里的尺寸由 `height` 和图片自身的比例决定，多存一份就会有两个真相。
 */

export interface DraftAsset {
  /** data URI（编辑器里永远是内嵌形态，导出时才可能被外置） */
  src: string;
  kind: MascotAssetKind;
  cols: number;
  rows: number;
  fps: number;
  /**
   * 逐帧图的**真实帧数**；0 = 还没填，按网格格数算。
   *
   * 网格排不满时（9 帧放进 8×2）后面几格是全透明的，播放时走到那里角色就没了
   * —— 这就是"角色一闪一闪"的来源。所以它必须能填、能被自动数出来。
   */
  frames: number;
  /** 原始像素尺寸，只用于界面提示 */
  width: number;
  height: number;
}

export interface MascotDraft {
  name: string;
  author: string;
  description: string;
  height: number;
  shadow: boolean;
  click: boolean;
  drag: boolean;
  motion: MascotMotion;
  assets: Partial<Record<MascotState, DraftAsset>>;
}

export function emptyDraft(): MascotDraft {
  return {
    name: '',
    author: '',
    description: '',
    height: 140,
    shadow: true,
    click: true,
    drag: true,
    motion: defaultMotion(),
    assets: {},
  };
}

/** 把一个已有的角色包倒进草稿里 —— "编辑当前角色"要的就是这个 */
export function draftFromPack(pack: MascotPack): MascotDraft {
  const assets: Partial<Record<MascotState, DraftAsset>> = {};
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (!a) continue;
    assets[key] = {
      src: a.src,
      kind: a.kind,
      cols: a.cols || 1,
      rows: a.rows || 1,
      fps: a.fps || 8,
      frames: a.frames || 0,
      /* 包里不存像素尺寸，倒回来时留 0，界面据此显示"未知"而不是编一个数 */
      width: 0,
      height: 0,
    };
  }
  return {
    name: pack.name,
    author: pack.author || '',
    description: pack.description || '',
    height: pack.height,
    shadow: pack.shadow,
    click: pack.interactive.click,
    drag: pack.interactive.drag,
    motion: Object.assign({}, pack.motion),
    assets: assets,
  };
}

/** 缺什么才算"还不能保存" */
export function draftIssues(draft: MascotDraft): string[] {
  const out: string[] = [];
  if (!draft.assets.idle || !draft.assets.idle.src) out.push('至少要给「待机」选一张图');
  for (const key of MASCOT_STATES) {
    const a = draft.assets[key];
    if (a && a.kind === 'sheet' && a.cols * a.rows < 2) {
      out.push('「' + key + '」标成了逐帧图，但格数是 ' + a.cols + '×' + a.rows + '，至少要有两格');
    }
  }
  return out;
}

export function toAsset(a: DraftAsset): MascotAsset {
  const asset: MascotAsset = { kind: a.kind, src: a.src };
  if (a.kind === 'sheet') {
    asset.cols = Math.min(SHEET_MAX, Math.max(1, Math.round(a.cols || 1)));
    asset.rows = Math.min(SHEET_MAX, Math.max(1, Math.round(a.rows || 1)));
    asset.fps = Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(a.fps || 8)));
    const cells = asset.cols * asset.rows;
    /* 只有一格就不算逐帧图 —— 和导入校验保持同一套判断 */
    if (cells < 2) {
      asset.kind = 'still';
      asset.cols = undefined;
      asset.rows = undefined;
      asset.fps = undefined;
      asset.frames = undefined;
    } else {
      const f = Math.round(a.frames || 0);
      /* 0（没填）或排满时都不写这个字段 —— 存盘形态和以前完全一样 */
      if (f >= 2 && f < cells) asset.frames = f;
    }
  }
  return asset;
}

/**
 * 草稿 → 可用的角色包。
 *
 * 和导入路径共用同一套收敛规则（越界夹住、缺状态跳过、只有一格的逐帧图降级成静态图），
 * 所以"编辑器里做出来的包"和"导入的包"在运行时是同一种东西，
 * 不会出现"自己做的能跑、别人给的报错"。
 */
export function buildPack(draft: MascotDraft): { pack: MascotPack; issues: string[] } {
  const issues = draftIssues(draft);
  const states: Partial<Record<MascotState, MascotAsset>> = {};
  for (const key of MASCOT_STATES) {
    const a = draft.assets[key];
    if (a && a.src) states[key] = toAsset(a);
  }

  const raw: MascotPack = {
    format: 'timetable-mascot',
    version: 1,
    id: 'local-' + Math.abs(hash(draft.name + '|' + draft.height + '|' + Object.keys(states).join(','))).toString(36),
    name: draft.name.trim() || '未命名角色',
    author: draft.author.trim() || undefined,
    description: draft.description.trim() || undefined,
    createdAt: new Date().toISOString(),
    height: clampHeight(draft.height),
    states: states,
    motion: Object.assign({}, draft.motion),
    interactive: { click: !!draft.click, drag: !!draft.drag },
    shadow: !!draft.shadow,
    anchor: { x: 0.5, y: 1 },
  };

  /*
   * 最后过一遍**导入用的那套校验**，而不是在这里再写一遍夹取规则。
   *
   * 这样"编辑器做出来的包"和"从文件导入的包"走的是同一条收敛路径 ——
   * 否则两边迟早分叉：一边修了边界、另一边没修，表现就是
   * "自己做的角色能跑，别人给的报错"，或者反过来。
   * 过一遍 JSON 是为了连"存盘再读回来"的形态都一致。
   */
  const v = validateMascotPack(JSON.parse(JSON.stringify(raw)));
  return { pack: v.ok && v.pack ? v.pack : raw, issues: issues };
}

/** 用来生成稳定的 id：同一个草稿存两次应当得到同一个 id，便于覆盖而不是堆积 */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/** 逐帧图的单格尺寸提示。没量到原始尺寸时返回 null，界面就不显示这一行 */
export function cellSize(a: DraftAsset | undefined): { w: number; h: number } | null {
  if (!a || a.kind !== 'sheet' || !a.width || !a.height) return null;
  const cols = Math.max(1, Math.round(a.cols || 1));
  const rows = Math.max(1, Math.round(a.rows || 1));
  return { w: Math.round(a.width / cols), h: Math.round(a.height / rows) };
}

export function defaultDraftAsset(src: string, width: number, height: number): DraftAsset {
  return { src: src, kind: 'still', cols: 1, rows: 1, fps: 8, frames: 0, width: width, height: height };
}

export function emptyMotion(): MascotMotion {
  return defaultMotion();
}

export function emptyInteractive() {
  return defaultInteractive();
}

/* ------------------------------ 给用户看的建议 ------------------------------ */

/**
 * 这张素材够不够清楚。
 *
 * 为什么要有这一段：一张图糊不糊，取决于"像素够不够铺满要显示的那块地方"，
 * 而这件事**可以算出来** —— 显示高度 × 屏幕倍率 = 需要的物理像素。
 * 算得出来就该告诉用户，而不是让他自己怀疑"是不是这个应用做得糙"。
 *
 * 返回的是**建议**而不是错误：糊也能用，只是不好看，所以它不拦保存。
 */
export function draftAdvice(draft: MascotDraft, dpr: number): string[] {
  const out: string[] = [];
  const ratio = isFinite(dpr) && dpr > 0 ? dpr : 1;
  const need = Math.round(draft.height * ratio);

  for (const key of MASCOT_STATES) {
    const a = draft.assets[key];
    if (!a || !a.src) continue;
    const label = STATE_LABEL[key];

    if (a.kind === 'sheet') {
      const cell = cellSize(a);
      if (cell && cell.h < need * 0.9) {
        out.push(label + '：每帧只有 ' + cell.w + '×' + cell.h
          + ' 像素，而显示高度 ' + draft.height + 'px 在这块屏上要 ' + need
          + ' 物理像素，看着会发虚。把显示高度调小一点，或者换一张更大的逐帧图。');
      }
      const cells = Math.max(1, a.cols || 1) * Math.max(1, a.rows || 1);
      if (cells > 2 && (!a.frames || a.frames < 2)) {
        out.push(label + '：还没量过真实帧数。如果这张图的最后一排没排满，'
          + '播放时会走到全透明的空格子上，看起来就是角色一闪一闪 —— 点「自动数帧」量一下最稳。');
      }
      continue;
    }

    if (a.height > 0 && a.height < need * 0.9) {
      out.push(label + '：这张图只有 ' + a.width + '×' + a.height
        + ' 像素，显示高度 ' + draft.height + 'px 在这块屏上要 ' + need
        + ' 物理像素，放大之后会发虚。换一张更大的图，或者把显示高度调小。');
    }
  }
  return out;
}
