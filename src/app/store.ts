import { useSyncExternalStore } from 'react';
import type {
  AttendanceRecord, AttendanceStatus, Override, OverrideAction, Period, PeriodScheme,
  ReminderRule, ReminderScope, Task, Term, TimetableData,
} from '../core/types';
import { MAX_WEEK } from '../core/types';
import { buildDemoData, buildEmptyData } from '../core/demo';
import { parseTimetable } from '../core/transfer';
import { buildImportedData, type ParsedSession } from '../core/courseImport';
import {
  collectMascotKeys, extractMascotAssets, hydrateMascot, mascotFileText, packFromImage, packFromSheet,
  parseMascotFileText, validateMascotPack,
} from '../mascot/pack';
import { MASCOT_STATES, clampHeight, type MascotPack } from '../mascot/types';
import { scanSheetCells } from '../theme/videoSheet';
import { migrateData } from '../core/migrate';
import { exportIcs, importIcs } from '../core/ics';
import { shareTimetable } from '../platform/shareImage';
import { lastSaveError, saveTextFile, type SaveOutcome } from '../platform/saveFile';
import { todayISO, weekOfDate } from '../core/engine';
import { parseISODate } from '../core/engine';
import { defaultTheme, type Theme } from '../theme/tokens';
import { presetById } from '../theme/presets';
import { parseThemeFile, themeFileText, validateTheme } from '../theme/themeFile';
import { announceChange } from './reminderRuntime';
import { deleteAsset, getAsset, kvDelete, kvGetSync, kvSet, putAsset } from '../storage';
import { extractAssets, hydrateAssets } from '../storage/assetRef';
import { activeExports, type ActiveExport } from '../plugins/host';
import {
  courseRows, currentWeek, exportFileName, termRows, toCsv, toGroupedMarkdown, toMarkdown, weekRows,
  type ExportColumn,
} from '../core/exporters';
import {
  popRedo, popUndo, pushRedo, pushUndo, recordChange, redoSize, resetHistory, undoSize, type ChangeSource,
} from './history';
import {
  CloudError, callFunction, deleteBackup, fetchBackup, fetchMe, saveBackup, sendRecover,
  signIn as cloudSignInApi, signOut as cloudSignOutApi, signUp as cloudSignUpApi, updatePassword,
  type CloudSession,
} from '../cloud/client';
import { parseAuthLink } from '../cloud/link';
import { buildBackupWithinLimit, describeBackup, formatTime, restoreAssets, validateBackup } from '../cloud/backup';
import {
  deleteMascot as deleteCloudMascot, fetchMascot, listMascots, myQuota, quotaLine, setMascotPublic,
  uploadMascot, type CloudMascot, type MascotQuota,
} from '../cloud/mascots';
import { loadSession, saveSession, freshToken } from '../cloud/session';
import { cloudConfigured, cloudHost } from '../cloud/config';
import { checkForUpdate, updateSummary, type CheckResult } from './update';
import { syncPromptFor } from '../cloud/syncAsk';
import { updateManifestUrls } from './meta';
import { canInstallApk, downloadAndInstallApk, openInstallSettings } from '../platform/appUpdate';
import { emailRedirectUrl } from './meta';
import { isNativePlatform } from '../platform/nativeBridge';
import { APP_VERSION } from './version';

export type TabKey = 'week' | 'today' | 'tasks' | 'studio' | 'settings';
export interface Toast { text: string; kind: 'info' | 'ok' | 'warn' | 'error'; undo?: () => void; }

/** 应用内确认框。用 Promise 暴露，调用处的写法和原来的 window.confirm 一样顺 */
export interface ConfirmRequest {
  message: string;
  okText: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export interface Prefs {
  reminderOffsets: number[];
  dailyBrief: boolean;
  briefHour: number;
  /** 外观锁定：默认锁上，防误触改坏主题 */
  studioLocked: boolean;
  /** 危险操作是否需要二次确认 */
  confirmDestructive: boolean;
  /** 是否已经自动申请过一次通知权限 */
  permissionAsked: boolean;
  /** 是否已经看过首次启动的隐私说明 */
  privacySeen: boolean;
  /** 启动时自动检查更新（默认开；只是读一个静态文件，可在设置里关掉） */
  autoCheckUpdate: boolean;
  /**
   * 打开应用时自动登录（默认开）。
   * 关掉之后：本次仍然登录着，**下次打开需要重新输入密码** —— 登录状态不会被恢复。
   */
  autoLogin: boolean;
  /**
   * 排查工具。开启后才显示诊断、检查、排程明细、存储占用这些排查用面板 ——
   * 它们对日常使用没有价值，却占了设置页一大半篇幅。
   */
  debug: boolean;
  /** 角色的显示偏好（角色包本身另存，见 mascot） */
  mascot: MascotPrefs;
}

/**
 * 角色的显示偏好。
 *
 * 位置存**归一化坐标**（0..1 的视口比例）而不是像素：
 * 换设备、转屏、分屏之后像素坐标可能刚好落在屏幕外，
 * 归一化坐标配合渲染时的钳制，最坏情况也只是挪个位置，不会"消失"。
 */
export interface MascotPrefs {
  /** 显示高度 px，用户可调 */
  size: number;
  x: number;
  y: number;
  /**
   * 素材本身朝哪边。
   *
   * 约定：**默认朝右**。走动时如果朝左走，界面上会把它水平镜像一下，
   * 让它始终朝着前进方向 —— 所以素材本身的朝向必须能告诉应用，
   * 否则"朝左的素材"会看起来在倒着走。
   */
  facing: 'right' | 'left';
  /**
   * 播放帧率；0 = 跟随素材自己的 fps。
   *
   * 单独做一个偏好、而不是直接改角色包里的 fps：**素材是怎么抽的就该记什么**，
   * 用户想让它动快一点是他的观看偏好，不该污染素材本身（导出的包还是原样）。
   */
  fps: number;
  /** 暂时收起来；再点一下外观页的开关就回来 */
  hidden: boolean;
}

export function defaultMascotPrefs(): MascotPrefs {
  /*
   * x 取 0.86，让钳制把它贴到"安全区最右"。
   *
   * 原来的 0.78 在 360px 屏上会让角色正好压住「今日」页出勤按钮的最后一个
   * （到/迟/缺/假 那一行排到 x249，角色盒从 x228 开始）——
   * 一个默认位置挡住每天都要点的按钮，是"宠物很碍事"的第一印象来源。
   * 贴右之后它仍在可点区域以外，而且看起来像是"蹲在边上"。
   */
  return { size: 140, x: 0.82, y: 0.62, fps: 0, facing: 'right', hidden: false };
}

export interface AppState {
  data: TimetableData;
  theme: Theme;
  prefs: Prefs;
  systemDark: boolean;
  tab: TabKey;
  week: number;
  courseSheet: string | null;
  editSheet: string | null;
  overrideSheet: string | null;
  schemeSheet: boolean;
  taskEditor: boolean;
  taskSheet: string | null;
  searchSheet: boolean;
  addSheet: boolean;
  /** 分享码弹层：导出或导入 */
  shareSheet: 'export' | 'import' | null;
  /** 导出格式选择弹层（由插件提供格式） */
  exportSheet: boolean;
  /** 角色（内存里的素材是 data URI；null = 没有导入过，界面上什么都不显示） */
  mascot: MascotPack | null;
  /** 角色编辑器：'new' 从空白开始，'edit' 载入当前角色 */
  mascotEditor: 'new' | 'edit' | null;
  /** 从 Excel / CSV 导入课表 */
  importSheet: boolean;
  /** 使用说明书（应用内文档） */
  manualSheet: boolean;
  /** 说明书要跳到哪一章（打开时用一次） */
  manualSection: string | null;
  /** 更新日志（版本改动记录） */
  changelogSheet: boolean;
  toast: Toast | null;
  confirm: ConfirmRequest | null;
  /** 撤销/重做栈的摘要，供界面显示按钮可用状态 */
  history: { undo: number; redo: number; lastLabel: string | null };
  notify: import('../platform/types').NotifierStatus | null;
  upcoming: import('../platform/types').NotifyItem[];
  /** 云备份（可选功能）：没配置或没登录时，界面整块不出现 */
  cloud: CloudState;
  /** 检查更新 */
  update: UpdateState;
}

/* v2：默认不再内置占位课程，旧版本的演示数据通过换 key 自然作废 */
const KEY_THEME = 'timetable.theme.v1';
const KEY_DATA = 'timetable.data.v2';
const KEY_PREFS = 'timetable.prefs.v1';
const KEY_MASCOT = 'timetable.mascot.v1';

function loadTheme(): Theme {
  let theme: Theme = defaultTheme();
  try {
    const raw = localStorage.getItem(KEY_THEME);
    if (raw) {
      const r = validateTheme(JSON.parse(raw));
      if (r.ok && r.theme) theme = r.theme;
      else { const p = presetById('workbench'); if (p) theme = p.build(); }
    } else {
      const p = presetById('workbench');
      if (p) theme = p.build();
    }
  } catch (e) { /* 忽略损坏的本地主题 */ }

  /* 开发用：?wp=aurora 指定预设壁纸；?wp=custom 塞一张自定义图验证通路 */
  try {
    const q = new URLSearchParams(window.location.search);
    const wp = q.get('wp');
    if (wp === 'custom') {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#00D4FF"/></linearGradient></defs>' +
        '<rect width="600" height="900" fill="url(#g)"/></svg>';
      theme = Object.assign({}, theme, {
        wallpaper: Object.assign({}, theme.wallpaper, {
          kind: 'custom',
          custom: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
        }),
      });
    } else if (wp) {
      theme = Object.assign({}, theme, {
        wallpaper: Object.assign({}, theme.wallpaper, { kind: 'preset', presetId: wp }),
      });
    }

    /*
     * ?fs=1.6 直接把字号放大到界面上限之外，用来验证"大字号不破版"。
     * 外观页最多只能调到 1.3，光是那个值验不出边界 —— 布局真正会裂的地方
     * 在更靠外的地方，而这个检查要能提前把它找出来。
     */
    const fs = Number(q.get('fs'));
    if (isFinite(fs) && fs > 0.5 && fs <= 2.5) {
      theme = Object.assign({}, theme, { fontScale: fs });
    }
  } catch (e) { /* 无 query 参数 */ }

  return theme;
}

function wantDemo(): boolean {
  try { return new URLSearchParams(window.location.search).get('demo') === '1'; } catch (e) { return false; }
}

/** 迁移提示：由 loadData 写入，界面挂载后取走一次 */
let migrateNotes: string[] = [];

/** 取走迁移提示（取出即清空），供界面挂载后弹一次 */
export function takeMigrateNotes(): string[] {
  const notes = migrateNotes;
  migrateNotes = [];
  return notes;
}

function loadData(): TimetableData {
  /* 开发用：?demo=1 强制载入示例课表，方便预览主题效果 */
  if (wantDemo()) return buildDemoData();
  try {
    const raw = localStorage.getItem(KEY_DATA);
    if (raw) {
      const parsed = JSON.parse(raw) as TimetableData;
      if (parsed && parsed.term && Array.isArray(parsed.courses) && Array.isArray(parsed.sessions)) {
        const r = migrateData(parsed);
        migrateNotes = r.notes;
        /* 迁移结果立刻写回，避免每次启动都重算 */
        if (r.notes.length > 0) {
          try { localStorage.setItem(KEY_DATA, JSON.stringify(r.data)); } catch (e) { /* 忽略 */ }
        }
        return r.data;
      }
    }
  } catch (e) { /* 数据损坏则重来 */ }
  return buildEmptyData();
}

/**
 * 挂载后是否已经发生过用户写入。
 *
 * 资产库/SQLite 的初始化是异步的，读完可能比用户第一次点击还晚。
 * 那种情况下绝不能用库里的旧数据把用户刚做的改动静默覆盖掉 ——
 * 所以只要发生过写入就跳过补正。
 */
let touchedByUser = false;

/** 开发用：?debug=1 直接进排查工具 */
function wantDebug(): boolean {
  try { return new URLSearchParams(window.location.search).get('debug') === '1'; } catch (e) { return false; }
}

/** 本地已经有课表或偏好数据 = 不是首次启动 */
function hasAnyLocalData(): boolean {
  try {
    return !!(localStorage.getItem(KEY_DATA) || localStorage.getItem(KEY_PREFS) || localStorage.getItem(KEY_THEME));
  } catch (e) {
    return true;   /* 读不到就当老用户，宁可少弹一屏 */
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY_PREFS);
    if (raw) {
      const p = JSON.parse(raw) as Prefs;
      return {
        reminderOffsets: Array.isArray(p.reminderOffsets) ? p.reminderOffsets : [15, 5],
        dailyBrief: p.dailyBrief === undefined ? true : !!p.dailyBrief,
        briefHour: typeof p.briefHour === 'number' ? p.briefHour : 21,
        studioLocked: p.studioLocked === undefined ? true : !!p.studioLocked,
        confirmDestructive: p.confirmDestructive === undefined ? true : !!p.confirmDestructive,
        permissionAsked: !!p.permissionAsked,
        privacySeen: !!p.privacySeen,
        autoCheckUpdate: p.autoCheckUpdate === undefined ? true : !!p.autoCheckUpdate,
        autoLogin: p.autoLogin === undefined ? true : !!p.autoLogin,
        debug: !!p.debug,
        mascot: loadMascotPrefs(p.mascot),
      };
    }
  } catch (e) { /* 忽略 */ }
  return {
    reminderOffsets: [15, 5], dailyBrief: true, briefHour: 21,
    studioLocked: true, confirmDestructive: true, permissionAsked: false,
    /* 老用户升级上来不该被拦一屏 —— 只有真正的首次启动才弹。
       ?demo=1 是开发预览入口，也不该被这屏挡住。 */
    privacySeen: hasAnyLocalData() || wantDemo(),
    autoCheckUpdate: true,
    autoLogin: true,
    /* ?debug=1 直接进排查工具，省得每次手点开关 */
    debug: wantDebug(),
    mascot: defaultMascotPrefs(),
  };
}

/** 角色偏好的读取：越界值一律收回来，旧的/坏的数据不该让角色飞到屏幕外 */
function loadMascotPrefs(raw: unknown): MascotPrefs {
  const d = defaultMascotPrefs();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const clamp01 = function (v: unknown, fb: number): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!isFinite(n)) return fb;
    return Math.min(1, Math.max(0, n));
  };
  return {
    size: clampHeight(typeof o.size === 'number' ? o.size : d.size),
    x: clamp01(o.x, d.x),
    y: clamp01(o.y, d.y),
    fps: clampMascotFps(typeof o.fps === 'number' ? o.fps : d.fps),
    facing: o.facing === 'left' ? 'left' : 'right',
    hidden: !!o.hidden,
  };
}

/**
 * 播放帧率的合法范围：0（跟随素材）或 4..24。
 * 上限取 24：再高也只是让人眼看到"快进"，帧本身不会变多。
 */
export function clampMascotFps(n: number): number {
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(24, Math.max(4, Math.round(n)));
}

function systemPrefersDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
}

function initialTab(): TabKey {
  try {
    const p = new URLSearchParams(window.location.search).get('tab');
    if (p === 'today' || p === 'tasks' || p === 'studio' || p === 'settings' || p === 'week') return p;
  } catch (e) { /* 无 query 参数 */ }
  return 'week';
}

function initialWeek(data: TimetableData): number {
  try {
    const p = new URLSearchParams(window.location.search).get('week');
    if (p) return clampWeek(Number(p));
  } catch (e) { /* 无 query 参数 */ }
  return clampWeek(weekOfDate(data.term, todayISO()));
}

/** 开发用：?open=scheme|search|override|course 直接打开对应弹层 */
function openParam(): string | null {
  try { return new URLSearchParams(window.location.search).get('open'); } catch (e) { return null; }
}

function initialSheets(data: TimetableData): { courseSheet: string | null; overrideSheet: string | null } {
  const none = { courseSheet: null, overrideSheet: null };
  const p = openParam();
  if (!p) return none;
  if (p.indexOf('override') === 0) {
    const id = p.indexOf(':') > 0 ? p.slice(p.indexOf(':') + 1) : (data.sessions[0] ? data.sessions[0].id : null);
    return { courseSheet: null, overrideSheet: id };
  }
  if (p.indexOf('course') === 0) {
    const id = p.indexOf(':') > 0 ? p.slice(p.indexOf(':') + 1) : (data.courses[0] ? data.courses[0].id : null);
    return { courseSheet: id, overrideSheet: null };
  }
  return none;
}

function initialScheme(data: TimetableData): string {
  try {
    const s = new URLSearchParams(window.location.search).get('scheme');
    if (s && data.schemes.some(function (x) { return x.id === s; })) return s;
  } catch (e) { /* 无参数 */ }
  return data.term.periodSchemeId;
}

/** 同步给一个「正在检测」的占位状态，界面立刻有东西可显示 */
function initialNotify(): AppState['notify'] {
  let native = false;
  try {
    const cap = (window as any).Capacitor;
    native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  } catch (e) { /* 忽略 */ }
  return {
    platform: native ? 'android' : 'web',
    displayName: native ? '系统通知' : '浏览器通知',
    permission: 'default',
    scheduled: 0,
    survivesAppClose: native,
    exactAlarm: 'unknown',
    channels: [],
    lastError: null,
    probing: true,
    note: '正在检测通知通道…',
  };
}

/**
 * `?mascot=1`：塞一个程序化生成的检查角色。
 *
 * 无头浏览器里点不了"导入角色包"，没有这条路径就**没法验证渲染** ——
 * 而"构建通过 ≠ 运行正常"这个坑我们踩过。生成的 SVG 只有几百字节，
 * 顺带也证明了"一张极小的图也能当角色"。
 */
function devMascot(): MascotPack | null {
  let mode = '';
  try { mode = new URLSearchParams(window.location.search).get('mascot') || ''; } catch (e) { return null; }
  if (mode !== '1' && mode !== '2' && mode !== '3' && mode !== '4' && mode !== '5' && mode !== '6') return null;

  const svgUri = function (svg: string): string {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  const face = '<rect x="10" y="20" width="100" height="120" rx="26" fill="#2F3237"/>' +
    '<circle cx="44" cy="74" r="9" fill="#fff"/><circle cx="76" cy="74" r="9" fill="#fff"/>' +
    '<rect x="46" y="106" width="28" height="6" rx="3" fill="#fff" opacity=".75"/>';
  const still = svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">' + face + '</svg>');

  /*
   * 三条渲染路径都要能被检查覆盖：
   *   1 = 静态图（程序化动画）
   *   2 = 逐帧雪碧图（4×2 网格，验证缩放与偏移算法）
   *   3 = 动图（用动画 SVG 走 <img> 原生播放这条路）
   * 无头浏览器里点不了"导入角色包"，没有这三条就永远验不到 sprite / animated。
   */
  let asset: { kind: 'still' | 'animated' | 'sheet'; src: string; cols?: number; rows?: number; fps?: number; frames?: number };
  if (mode === '4' || mode === '5') {
    /*
     * 专门做出来的**半满网格**：8×2 有 16 格，只画前 9 格。
     *
     * 这就是"角色一闪一闪"那个 bug 的最小复现体：
     *   ?mascot=5 —— 包里没有 frames 字段（= v0.15.1 的行为），播放按 16 格循环，
     *                会走到 7 个全透明的空格子上，角色每圈闪 7 帧；
     *   ?mascot=4 —— 同一个素材，但带上 frames=9，一格都不会走错。
     * 两个参数一对比，问题有没有真的修掉就一目了然（配 ?framecheck=1 自动判定）。
     */
    const cols = 8;
    const rows = 2;
    const real = 9;
    let cells = '';
    for (let i = 0; i < real; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      cells += '<rect x="' + (c * 120 + 10) + '" y="' + (r * 160 + 20) + '" width="100" height="120" rx="26" fill="#2F3237"/>' +
        '<circle cx="' + (c * 120 + 44) + '" cy="' + (r * 160 + 74 + i * 2) + '" r="9" fill="#fff"/>' +
        '<circle cx="' + (c * 120 + 76) + '" cy="' + (r * 160 + 74 + i * 2) + '" r="9" fill="#fff"/>';
    }
    asset = {
      kind: 'sheet',
      src: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="' + (cols * 120) + '" height="' + (rows * 160) + '">' + cells + '</svg>'),
      cols: cols,
      rows: rows,
      fps: 8,
    };
    if (mode === '4') asset.frames = real;
  } else if (mode === '2') {
    const cols = 4;
    const rows = 2;
    let cells = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        cells += '<rect x="' + (c * 120 + 10) + '" y="' + (r * 160 + 20) + '" width="100" height="120" rx="26" fill="#2F3237"/>' +
          '<circle cx="' + (c * 120 + 44) + '" cy="' + (r * 160 + 74 + i * 2) + '" r="9" fill="#fff"/>' +
          '<circle cx="' + (c * 120 + 76) + '" cy="' + (r * 160 + 74 + i * 2) + '" r="9" fill="#fff"/>';
      }
    }
    asset = {
      kind: 'sheet',
      src: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="' + (cols * 120) + '" height="' + (rows * 160) + '">' + cells + '</svg>'),
      cols: cols,
      rows: rows,
      fps: 8,
    };
  } else if (mode === '6') {
    /*
     * 专门做出来的**五官不同**的一组素材：待机是深灰、走动是橙色、睡着更暗。
     *
     * 用途是"走动用的是不是另一张素材"这件事能被**按像素读出来**：
     * 光看代码或看 DOM 属性都不够 —— 颜色一读就知道它在用哪一张。
     */
    const figure = function (fill: string, legs: boolean): string {
      return '<rect x="10" y="20" width="100" height="120" rx="26" fill="' + fill + '"/>' +
        '<circle cx="44" cy="74" r="9" fill="#fff"/><circle cx="76" cy="74" r="9" fill="#fff"/>' +
        (legs
          ? '<rect x="30" y="140" width="16" height="18" rx="6" fill="' + fill + '"/>' +
            '<rect x="74" y="140" width="16" height="18" rx="6" fill="' + fill + '"/>'
          : '<rect x="46" y="106" width="28" height="6" rx="3" fill="#fff" opacity=".75"/>');
    };
    const idleAsset = { kind: 'still' as const, src: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">' + figure('#2F3237', false) + '</svg>') };
    const walkAsset = { kind: 'still' as const, src: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">' + figure('#E07B1E', true) + '</svg>') };
    const sleepAsset = { kind: 'still' as const, src: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">' + figure('#6E7278', false) + '</svg>') };
    return {
      format: 'timetable-mascot',
      version: 1,
      id: 'dev-mascot-6',
      name: '示例角色 6',
      description: '待机 / 走动 / 睡着 三张不同素材，用来检查"走动用的是哪一张"',
      height: 140,
      states: { idle: idleAsset, walk: walkAsset, sleep: sleepAsset },
      motion: { breathe: 0.03, bob: 0.02, sway: 2 },
      interactive: { click: true, drag: true },
      shadow: true,
      anchor: { x: 0.5, y: 1 },
    };
  } else if (mode === '3') {
    asset = {
      kind: 'animated',
      src: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">' + face +
        '<animateTransform attributeName="transform" type="translate" values="0 0; 0 -6; 0 0" dur="1.6s" repeatCount="indefinite"/></svg>'),
    };
  } else {
    asset = { kind: 'still', src: still };
  }

  return {
    format: 'timetable-mascot',
    version: 1,
    id: 'dev-mascot-' + mode,
    name: '示例角色 ' + mode,
    description: '由 ?mascot=' + mode + ' 生成的示例素材，用于检查渲染',
    height: 140,
    states: {
      idle: asset,
      react: { kind: 'still', src: still },
    },
    motion: { breathe: 0.03, bob: 0.02, sway: 2 },
    interactive: { click: true, drag: true },
    shadow: true,
    anchor: { x: 0.5, y: 1 },
  };
}

/**
 * 读角色包。
 *
 * 和主题一样是**同步**读的：启动时先把 `asset:<key>` 引用读进来，
 * 图片等 `initStorage()` 之后再补（见 hydrateMascotIntoState）。
 * 素材还没补上的那一瞬间，角色不显示 —— 这比"闪一下再消失"好。
 *
 * 校验不通过就当作没有角色，并且**不**自动删掉本地那份：
 * 万一是新版应用暂时读不懂旧包，直接删就把用户的东西弄丢了。
 */
function loadMascot(): MascotPack | null {
  const dev = devMascot();
  if (dev) return dev;
  try {
    const raw = localStorage.getItem(KEY_MASCOT);
    if (!raw) return null;
    const r = validateMascotPack(JSON.parse(raw));
    if (!r.ok || !r.pack) {
      console.warn('本地角色包没读进来：', r.errors.join('；'));
      return null;
    }
    return r.pack;
  } catch (e) {
    return null;
  }
}

function initialState(): AppState {
  const data = Object.assign({}, loadData());
  data.term = Object.assign({}, data.term, { periodSchemeId: initialScheme(data) });
  return {
    data: data,
    theme: loadTheme(),
    prefs: loadPrefs(),
    systemDark: systemPrefersDark(),
    tab: initialTab(),
    week: initialWeek(data),
    courseSheet: initialSheets(data).courseSheet,
    editSheet: null,
    overrideSheet: initialSheets(data).overrideSheet,
    schemeSheet: openParam() === 'scheme',
    /* ?open=task 打开任务编辑面板（开发用，方便直接看选择器等控件） */
    taskEditor: openParam() === 'task',
    taskSheet: null,
    searchSheet: openParam() === 'search',
    addSheet: false,
    /* ?open=share 生成分享码，?open=share-import 打开导入框（开发用） */
    shareSheet: openParam() === 'share' ? 'export' : (openParam() === 'share-import' ? 'import' : null),
    exportSheet: openParam() === 'export',
    importSheet: openParam() === 'import-sheet',
    manualSheet: openParam() === 'manual',
    manualSection: null,
    changelogSheet: openParam() === 'changelog',
    mascot: loadMascot(),
    /*
     * ?open=mascot-editor 进"做一个角色"（空表单）；
     * ?open=mascot-edit 进"编辑这个角色"（把当前角色倒进表单）。
     * 两个都要有：空表单量不到那些"选了素材才会出现"的控件（格数、帧数、建议条），
     * 而窄屏上真正容易破版的恰恰是它们。
     */
    mascotEditor: openParam() === 'mascot-editor' ? 'new' : (openParam() === 'mascot-edit' ? 'edit' : null),
    toast: null,
    confirm: null,
    history: { undo: 0, redo: 0, lastLabel: null },
    notify: initialNotify(),
    upcoming: [],
    cloud: initialCloud(loadPrefs().autoLogin !== false),
    update: { checking: false, result: null, progress: null, error: '', sheet: false },
  };
}

type Listener = () => void;
let state: AppState = initialState();
const listeners = new Set<Listener>();
let toastTimer: number | null = null;

function emit(): void { listeners.forEach(function (l) { l(); }); }

export function getState(): AppState { return state; }

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return function () { listeners.delete(l); };
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = Object.assign({}, state, p);
  emit();
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/**
 * 持久化主题。
 *
 * 大图先抽出来存进资产库（SQLite），localStorage 里只留 `asset:<key>` 引用 ——
 * 一张自定义壁纸的成品加原图能吃掉 localStorage 全部 5 MB 配额，
 * 只留引用之后这个键就只剩几 KB。
 */
function persistTheme(theme: Theme): void {
  try {
    const r = extractAssets(theme, state.data);
    for (const a of r.assets) putAsset(a.key, a.uri);
    const json = JSON.stringify(r.theme);
    localStorage.setItem(KEY_THEME, json);
    kvSet(KEY_THEME, json);
    touchedByUser = true;
  } catch (e) {
    showToast('主题没能完整保存：' + (e as Error).message + '。可以先导出主题包保存', 'warn');
  }
}

/**
 * 挂载后把资产引用还原回 data URI。
 *
 * 必须等 initStorage() 读完资产库再调。在此之前界面上是"没有自定义壁纸"，
 * 之后补上 —— 宁可晚一拍，也不要为了同步而把整个 store 改成异步。
 */
export function hydrateAssetsIntoState(): void {
  const r = hydrateAssets(state.theme, state.data, getAsset);

  /*
   * 资产库里找不到那张图（换机恢复、清过应用数据、库损坏）时，
   * 不能把 kind 留在 'custom' —— 否则外观页显示"已选自定义壁纸"，
   * 屏幕上却什么都没有，用户只会以为又坏了。
   * 降级成"无壁纸"并写回一次，让下一次启动就是个干净状态。
   */
  const wp = r.theme.wallpaper;
  const degraded = wp.kind === 'custom' && !wp.custom;
  const theme = degraded
    ? Object.assign({}, r.theme, { wallpaper: Object.assign({}, wp, { kind: 'none' as const }) })
    : r.theme;

  if (theme === state.theme && r.data === state.data) return;
  setState({ theme: theme, data: r.data });
  if (degraded) {
    try { persistTheme(theme); } catch (err) { /* 自愈失败不影响本次启动 */ }
  }
}

/**
 * 一次性迁移：把 localStorage 里**已经存着的**内联大图搬进资产库。
 *
 * 只做 hydrate 是不够的 —— 老用户升级上来时，图片本来就以 data URI 存在
 * localStorage 里，不主动搬一次的话，配额还是被占着，直到他碰一次主题才释放。
 * 搬完立刻把精简后的版本写回去。
 */
/**
 * 用 SQLite 里的数据补正内存状态。
 *
 * 正常情况下两边一致，什么都不做。真正有用的场景是：
 * localStorage 曾经写失败过（配额满），而 SQLite 写成功了 ——
 * 这时库里的才是最新的，要让它赢。
 *
 * 只有"用户还没动过任何东西"时才补正，避免覆盖刚做的改动。
 */
export function hydrateStorageIntoState(): boolean {
  if (touchedByUser) return false;
  const raw = kvGetSync(KEY_DATA);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as TimetableData;
    if (!parsed || !parsed.term || !Array.isArray(parsed.courses)) return false;
    /*
     * 比对时要把内存里那份**先外置**再比：库里存的是 `asset:<key>` 引用形态，
     * 内存里是 data URI 形态，两者本来就不可能相等 —— 直接比会让每次启动
     * 都白做一次替换，还会把刚还原好的图片又打回去。
     */
    const mine = extractAssets(state.theme, state.data).data;
    if (JSON.stringify(parsed) === JSON.stringify(mine)) return false;
    setState({ data: parsed });
    return true;
  } catch (e) {
    return false;
  }
}

export function migrateInlineAssets(): number {
  const r = extractAssets(state.theme, state.data);
  if (r.assets.length === 0) return 0;
  for (const a of r.assets) putAsset(a.key, a.uri);
  const themeJson = JSON.stringify(r.theme);
  const dataJson = JSON.stringify(r.data);
  try { localStorage.setItem(KEY_THEME, themeJson); } catch (e) { /* 忽略 */ }
  try { localStorage.setItem(KEY_DATA, dataJson); } catch (e) { /* 忽略 */ }
  /* 库和本地镜像必须一起更新，否则下次启动会因为两边不一致而白折腾一遍 */
  kvSet(KEY_THEME, themeJson);
  kvSet(KEY_DATA, dataJson);
  return r.assets.length;
}

export function showToast(text: string, kind: Toast['kind'], undo?: () => void): void {
  setState({ toast: { text: text, kind: kind, undo: undo } });
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () { setState({ toast: null }); }, undo ? 6000 : 3200);
}

export function dismissToast(): void {
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  setState({ toast: null });
}

/**
 * 跑一次可撤销的操作。
 *
 * 提示条上的「撤销」只在**这一步仍是最后一步**时才生效 ——
 * 否则用户改完 A 又改了 B，再点 A 的撤销条，撤掉的却是 B，那就成了陷阱。
 * 那种情况下如实告诉他已经撤不了，比悄悄撤错东西强。
 */
function withUndo(toastText: string, label: string, mutate: () => TimetableData): void {
  const id = setData(mutate(), label);
  showToast(toastText, 'ok', function () {
    if (id && undoChangeById(id)) showToast('已撤销', 'info');
    else showToast('这一步之后又有改动，已经撤不回去了', 'warn');
  });
}

/* ------------------------------ 课表数据 ------------------------------ */

/** 只落库、不动历史。撤销/重做内部走它，避免把回退本身又记成一笔 */
function writeData(data: TimetableData, label?: string): void {
  const patch: Partial<AppState> = { data: data };
  if (label !== undefined) {
    patch.history = { undo: undoSize(), redo: redoSize(), lastLabel: label };
  }
  setState(patch);
  try {
    /* 课程配图同样外置，理由见 persistTheme */
    const r = extractAssets(state.theme, data);
    for (const a of r.assets) putAsset(a.key, a.uri);
    const json = JSON.stringify(r.data);
    localStorage.setItem(KEY_DATA, json);
    kvSet(KEY_DATA, json);
    touchedByUser = true;
  } catch (e) {
    /*
     * 以前这里是静默 catch —— 存不下的时候界面一切正常，一重启数据全没了，
     * 用户根本不知道为什么。本地优先的产品，存不下去必须当场说出来。
     */
    showToast('课表没能保存到本机（本地存储已满）。请先导出备份，再删掉一些自定义壁纸或课程图片', 'error');
  }
}

/**
 * 改课表的唯一入口。
 *
 * `label` 给了才记历史 —— 有意义的用户操作都要给，
 * 像考勤打卡、任务勾选这种高频低风险的动作则刻意不记，
 * 免得撤销栈里塞满噪音，真正想撤的那一步反而找不着。
 */
export function setData(data: TimetableData, label?: string, source: ChangeSource = 'user'): string | null {
  let id: string | null = null;
  if (label) id = recordChange(label, source, state.data, data).id;
  writeData(data, label);
  return id;
}

function historySummary(label: string | null): AppState['history'] {
  return { undo: undoSize(), redo: redoSize(), lastLabel: label };
}

/**
 * 清空撤销历史。
 *
 * 用于"换了一份数据"的场景（重置课表、测试夹具），以及需要把历史断开的地方 ——
 * 不清的话，撤销会一路退回上一份数据，那已经不是用户以为的"上一步"了。
 */
export function clearHistory(): void {
  resetHistory();
  setState({ history: historySummary(null) });
}

export function canUndo(): boolean { return state.history.undo > 0; }
export function canRedo(): boolean { return state.history.redo > 0; }

/** 撤销一步 */
export function undo(): boolean {
  const set = popUndo();
  if (!set) return false;
  pushRedo(set);
  writeData(set.before);
  setState({ history: historySummary(set.label) });
  showToast('已撤销：' + set.label, 'info');
  return true;
}

/** 重做一步 */
export function redo(): boolean {
  const set = popRedo();
  if (!set) return false;
  pushUndo(set);
  writeData(set.after);
  setState({ history: historySummary(set.label) });
  showToast('已重做：' + set.label, 'info');
  return true;
}

/** 只在这一笔恰好位于栈顶时撤销它，供提示条上的按钮用 */
function undoChangeById(id: string): boolean {
  const top = popUndo();
  if (!top) return false;
  if (top.id !== id) { pushUndo(top); return false; }
  pushRedo(top);
  writeData(top.before);
  setState({ history: historySummary(top.label) });
  return true;
}

/* ------------------------------ 提醒规则 ------------------------------ */

function ruleMatches(r: ReminderRule, scope: ReminderScope, targetId: string | null): boolean {
  if (r.scope !== scope) return false;
  if (scope === 'course') return r.courseId === targetId;
  if (scope === 'session') return r.sessionId === targetId;
  return true;
}

/** 写入一条提醒规则（越具体的 scope 优先级越高，见 core/reminders.ts） */
export function setReminderRule(
  scope: ReminderScope, targetId: string | null, offsets: number[], enabled: boolean
): void {
  const rules = state.data.reminderRules.slice();
  const i = rules.findIndex(function (r) { return ruleMatches(r, scope, targetId); });
  const rule: ReminderRule = {
    id: i >= 0 ? rules[i].id : 'rr' + Date.now(),
    scope: scope,
    offsetsMinutes: offsets.slice().sort(function (a, b) { return b - a; }),
    enabled: enabled,
  };
  if (scope === 'course') rule.courseId = targetId || undefined;
  if (scope === 'session') rule.sessionId = targetId || undefined;
  if (i >= 0) rules[i] = rule; else rules.push(rule);
  setData(Object.assign({}, state.data, { reminderRules: rules }), '修改提醒');
}

/** 删除规则，回到上一层（课程 -> 全局偏好） */
export function clearReminderRule(scope: ReminderScope, targetId: string | null): void {
  const rules = state.data.reminderRules.filter(function (r) { return !ruleMatches(r, scope, targetId); });
  setData(Object.assign({}, state.data, { reminderRules: rules }), '恢复默认提醒');
}

/** 同一个 (session, date) 只保留一条调整记录，和引擎的语义一致 */
export function upsertOverride(input: {
  sessionId: string; date: string; action: OverrideAction;
  patch?: Override['patch']; reason?: string;
}): void {
  const rest = state.data.overrides.filter(function (o) {
    return !(o.sessionId === input.sessionId && o.date === input.date);
  });
  const ov: Override = {
    id: 'o' + Date.now(),
    sessionId: input.sessionId,
    date: input.date,
    action: input.action,
    patch: input.patch,
    reason: input.reason,
  };
  setData(Object.assign({}, state.data, { overrides: rest.concat([ov]) }), OVERRIDE_LABEL[input.action]);
  showToast('调整已生效，课表与提醒会自动重排', 'ok');

  /*
   * 变动补一条即时通知。调课这类操作常常是在匆忙里做完的，
   * 过一会儿就记不清改成了什么；留在通知栏里滑下来就能确认。
   */
  const course = state.data.courses.filter(function (c) {
    const s2 = state.data.sessions.filter(function (x) { return x.id === input.sessionId; })[0];
    return !!s2 && c.id === s2.courseId;
  })[0];
  announceChange(ACTION_TITLE[input.action], overrideDetail(ov, course ? course.name : '课程'));
}

const ACTION_TITLE: Record<OverrideAction, string> = {
  cancel: '已停课',
  reschedule: '已调课',
  roomChange: '已换教室',
};

/** 撤销栈里的标签用名词，读起来是「已撤销：调课」 */
const OVERRIDE_LABEL: Record<OverrideAction, string> = {
  cancel: '停课',
  reschedule: '调课',
  roomChange: '换教室',
};

/** 把一条调整说成人话，用于通知正文 */
function overrideDetail(o: Override, courseName: string): string {
  const p = o.patch || {};
  const bits: string[] = [];
  if (p.newDate) bits.push('改到 ' + p.newDate);
  if (p.location) bits.push('换到 ' + p.location);
  if (p.periodStart) {
    bits.push('第 ' + p.periodStart + (p.periodEnd && p.periodEnd !== p.periodStart ? '-' + p.periodEnd : '') + ' 节');
  }
  if (o.reason) bits.push(o.reason);
  if (bits.length === 0) bits.push('本次调整已记录');
  return courseName + ' · ' + o.date + '：' + bits.join(' · ');
}

export function deleteOverride(id: string): void {
  const gone = state.data.overrides.filter(function (o) { return o.id === id; })[0];
  withUndo('已移除这次调整', '移除调整', function () { return Object.assign({}, state.data, {
    overrides: state.data.overrides.filter(function (o) { return o.id !== id; }),
  }); });
  if (gone) announceChange('已恢复原课表', gone.date + ' 的调整已撤销');
}

/* ------------------------------ 任务 / DDL ------------------------------ */

export function upsertTask(input: { id?: string; title: string; courseId?: string; due?: string; dueMinutes?: number; note?: string }): void {
  if (input.id) {
    setData(Object.assign({}, state.data, {
      tasks: state.data.tasks.map(function (t) {
        return t.id === input.id ? Object.assign({}, t, input) : t;
      }),
    }), '编辑任务');
    showToast('任务已更新', 'ok');
    return;
  }
  const task: Task = {
    id: 'k' + Date.now(),
    title: input.title,
    courseId: input.courseId,
    due: input.due,
    dueMinutes: input.dueMinutes,
    note: input.note,
    done: false,
  };
  setData(Object.assign({}, state.data, { tasks: state.data.tasks.concat([task]) }), '添加任务');
  showToast('已添加任务', 'ok');
}

export function toggleTask(id: string): void {
  setData(Object.assign({}, state.data, {
    tasks: state.data.tasks.map(function (t) { return t.id === id ? Object.assign({}, t, { done: !t.done }) : t; }),
  }));
}

export function deleteTask(id: string): void {
  setData(Object.assign({}, state.data, {
    tasks: state.data.tasks.filter(function (t) { return t.id !== id; }),
  }), '删除任务');
  showToast('已删除任务', 'ok');
}

/* ------------------------------ 考勤 ------------------------------ */

/** 同一个 (时段, 日期) 只留一条考勤记录；再点一次同一个状态就取消 */
export function markAttendance(sessionId: string, date: string, status: AttendanceStatus): void {
  const list = state.data.attendance || [];
  const existing = list.find(function (a) { return a.sessionId === sessionId && a.date === date; });
  let next: AttendanceRecord[];
  if (existing && existing.status === status) {
    next = list.filter(function (a) { return a.id !== existing.id; });
  } else if (existing) {
    next = list.map(function (a) { return a.id === existing.id ? Object.assign({}, a, { status: status }) : a; });
  } else {
    next = list.concat([{ id: 'at' + Date.now(), sessionId: sessionId, date: date, status: status }]);
  }
  setData(Object.assign({}, state.data, { attendance: next }));
}

export function attendanceFor(sessionId: string, date: string): AttendanceStatus | null {
  const a = (state.data.attendance || []).find(function (x) { return x.sessionId === sessionId && x.date === date; });
  return a ? a.status : null;
}

export function openTask(id: string | null): void { setState({ taskSheet: id, taskEditor: id === null }); }

/* ------------------------------ 作息方案 ------------------------------ */

export function setActiveScheme(schemeId: string): void {
  setTerm({ periodSchemeId: schemeId });
  showToast('已切换作息方案，所有课程的时间会跟着变', 'ok');
}

export function updateSchemePeriods(schemeId: string, periods: Period[]): void {
  setData(Object.assign({}, state.data, {
    schemes: state.data.schemes.map(function (s) {
      return s.id === schemeId ? Object.assign({}, s, { periods: periods }) : s;
    }),
  }), '修改节次时间');
}

export function duplicateScheme(schemeId: string, name: string): void {
  const src = state.data.schemes.find(function (s) { return s.id === schemeId; });
  if (!src) return;
  const copy: PeriodScheme = {
    id: 'scheme-' + Date.now(),
    name: name,
    periods: src.periods.map(function (p) { return Object.assign({}, p); }),
  };
  setData(Object.assign({}, state.data, { schemes: state.data.schemes.concat([copy]) }), '新增作息方案');
  showToast('已新增作息方案「' + name + '」', 'ok');
}

/**
 * 只更新通知通道状态，**保留当前的排程清单**。
 *
 * 这个函数是补出来的，因为它对应一个真实 bug：
 * 权限申请、检查、重置这些流程只需要刷新状态，于是调用处写成
 * `setNotify(st, s.upcoming)` —— 而 `s.upcoming` 是那一刻渲染闭包里的值，
 * 首次启动时还是空数组。它在异步流程结束后才执行，就把主同步刚算好的
 * 几十条提醒**覆盖成了 0 条**，界面上于是显示「未来 7 天没有需要提醒的课」，
 * 而同一页的「已排入通知系统」却写着 37 条 —— 自相矛盾。
 */
export function setNotifyStatus(status: AppState['notify']): void {
  setState({ notify: status });
}

/** 状态与清单一起更新；只有真正重新排程过的地方才该用它 */
export function setNotify(status: AppState['notify'], upcoming: AppState['upcoming']): void {
  if (status) status.probing = false;
  setState({ notify: status, upcoming: upcoming });
}

export function setTerm(patch: Partial<Term>): void {
  const next = Object.assign({}, state.data, { term: Object.assign({}, state.data.term, patch) });
  setData(next, '修改学期设置');
}

/** 删除一门课：连带它的上课时段与调课记录一起清掉 */
export function deleteCourse(courseId: string): void {
  const sessionIds = state.data.sessions.filter(function (x) { return x.courseId === courseId; }).map(function (x) { return x.id; });
  withUndo('已删除该课程', '删除课程', function () { return Object.assign({}, state.data, {
    courses: state.data.courses.filter(function (c) { return c.id !== courseId; }),
    sessions: state.data.sessions.filter(function (x) { return x.courseId !== courseId; }),
    overrides: state.data.overrides.filter(function (o) { return sessionIds.indexOf(o.sessionId) < 0; }),
    reminderRules: state.data.reminderRules.filter(function (r) {
      if (r.scope === 'course' && r.courseId === courseId) return false;
      if (r.scope === 'session' && r.sessionId && sessionIds.indexOf(r.sessionId) >= 0) return false;
      return true;
    }),
  }); });
  setState({ courseSheet: null });
}

export function clearAllCourses(): void {
  const term = state.data.term;
  withUndo('已清空全部课程', '清空课表', function () { return Object.assign({}, buildEmptyData(), { term: term }); });
}

export async function importTimetableFromFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const r = parseTimetable(text);
    if (!r.ok) { showToast('导入失败：' + r.error, 'error'); return; }
    setData(r.data, '导入课表', 'import');
    setWeek(clampWeek(weekOfDate(r.data.term, todayISO())));
    showToast(
      '已导入 ' + r.data.courses.length + ' 门课' + (r.warnings.length ? '（' + r.warnings.length + ' 条提示）' : ''),
      'ok'
    );
    if (r.warnings.length) console.warn('课表导入提示：', r.warnings);
  } catch (e) {
    showToast('导入失败：' + (e as Error).message, 'error');
  }
}


/* ------------------------------ 角色 ------------------------------ */

/**
 * 落盘角色包。
 *
 * 和主题一样：大图先抽进资产库（SQLite），localStorage 里只留 `asset:<key>` 引用。
 * 一张二游立绘动辄一两 MB，直接塞 localStorage 会顶满 5 MB 配额 ——
 * 而配额一满，**课表数据本身**就写不进去了，那才是真的灾难。
 */
function persistMascot(pack: MascotPack | null): string[] {
  try {
    if (!pack) {
      localStorage.removeItem(KEY_MASCOT);
      kvDelete(KEY_MASCOT);
      touchedByUser = true;
      return [];
    }
    const r = extractMascotAssets(pack);
    for (const a of r.assets) putAsset(a.key, a.uri);
    const json = JSON.stringify(r.pack);
    localStorage.setItem(KEY_MASCOT, json);
    kvSet(KEY_MASCOT, json);
    touchedByUser = true;
    /* 返回落盘后真正引用到的 key —— 换角色时用它做差集，精确回收旧素材 */
    return collectMascotKeys(r.pack);
  } catch (e) {
    showToast('角色没能完整保存：' + (e as Error).message, 'warn');
    return [];
  }
}

/**
 * 换掉 / 移除角色，并回收旧素材。
 *
 * 为什么要做这个差集：角色图动不动几百 KB 到几 MB，存进资产库之后
 * 换一个角色就多留一份，换十次就是十几 MB —— 而且**界面上完全看不出来**。
 * 这里按"旧包用到的 key 减去新包用到的 key"精确删除，
 * 不做全局扫描：全局扫描一旦算错 keep 列表，删掉的是还在用的图。
 */
function applyMascot(pack: MascotPack | null, hidden?: boolean): void {
  const oldKeys = collectMascotKeys(state.mascot);
  setState({ mascot: pack });
  const keep = persistMascot(pack);
  for (const k of oldKeys) {
    if (keep.indexOf(k) < 0) deleteAsset(k);
  }
  if (hidden !== undefined) patchMascotPrefs({ hidden: hidden });
}

/**
 * 挂载后把素材引用还原回 data URI（和主题同一时机）。
 *
 * 素材真的找不到了（清过应用数据、换过手机）时**明确清掉并告诉用户**，
 * 而不是留一个空壳 —— 空壳的表现是"设置了角色但屏幕上什么都没有"，
 * 那是最让人困惑的一种失败。
 */
export function hydrateMascotIntoState(): void {
  const cur = state.mascot;
  if (!cur) return;
  const next = hydrateMascot(cur, getAsset);
  if (next === cur) return;

  if (!next.states.idle) {
    setState({ mascot: null });
    persistMascot(null);
    showToast('角色的素材找不到了，请重新导入一次角色包', 'warn');
    return;
  }
  setState({ mascot: next });
}

/** 导入一个角色包（文本形式）。返回结果由界面负责提示 */
export function importMascotPack(text: string, sourceName?: string): { ok: boolean; error?: string; warnings: string[] } {
  const r = parseMascotFileText(text);
  if (!r.ok || !r.pack) return { ok: false, error: r.errors.join('；') || '角色包读不出来', warnings: r.warnings };

  const pack = sourceName && r.pack.name === '未命名角色'
    ? Object.assign({}, r.pack, { name: sourceName })
    : r.pack;

  applyMascot(pack, false);
  return { ok: true, warnings: r.warnings };
}

/** 直接把一张图当角色（用户拖图进来 / 从相册选） */
export function importMascotImage(dataUri: string, name: string): void {
  applyMascot(packFromImage(dataUri, name), false);
}

/**
 * 用一段视频当角色。
 *
 * 视频会被抽帧拼成雪碧图（详见 theme/videoSheet.ts）—— 二游的动图素材大量是 webm，
 * 而 webm 是视频不是图片，图片管线根本走不通。
 */
export function importMascotSheet(
  dataUri: string, name: string, cols: number, rows: number, fps: number, frames?: number
): void {
  applyMascot(packFromSheet(dataUri, name, cols, rows, fps, frames), false);
}

/**
 * 给**已有的**角色补上真实帧数。
 *
 * 为什么必须有这一步：用户在 v0.15.1 之前做出来的角色包里没有 `frames` 字段，
 * 而那时候的播放逻辑按"网格格数"循环 —— 最后一排没排满的格子是全透明的，
 * 所以那些角色会一闪一闪。修好渲染逻辑并不能自动修好**已经存下来的包**
 * （网格格数还是错的），所以启动后量一遍，把真实帧数写回去。
 *
 * 三条自我约束：
 *   1. 只**收紧**（只在量出来比格数少的时候才写），绝不放大；
 *   2. 不碰"已经量过"（有 frames）的素材，也不碰用户可能故意留空的格子；
 *   3. 量不到（素材还没还原、画布不给读像素）就**什么都不做**，
 *      绝不猜一个数字写进去。
 */
export async function repairMascotFrames(force?: boolean): Promise<number> {
  const pack = state.mascot;
  if (!pack) return 0;

  const states = Object.assign({}, pack.states);
  let fixed = 0;
  let extraBlank = 0;
  let missed = 0;

  for (const key of MASCOT_STATES) {
    const a = states[key];
    if (!a || a.kind !== 'sheet') continue;
    const cols = Math.max(1, Math.round(a.cols || 1));
    const rows = Math.max(1, Math.round(a.rows || 1));
    const cells = cols * rows;
    if (cells < 3) continue;
    /* 自动修复只碰"没量过的"；用户手动点「按实测帧数修正」时才重算已有的 */
    if (a.frames !== undefined && !force) continue;
    let scan;
    try {
      scan = await scanSheetCells(a.src, cols, rows);
    } catch (e) {
      continue;
    }
    const playing = a.frames === undefined ? cells : a.frames;
    if (scan.frames < 2 || scan.frames > cells || scan.frames === playing) continue;
    /* 自动模式只收紧（少播几帧绝不放大）；手动模式按实测值改，改大改小都认 */
    if (!force && scan.frames >= cells) continue;
    states[key] = Object.assign({}, a);
    if (scan.frames >= cells) delete (states[key] as { frames?: number }).frames;
    else states[key].frames = scan.frames;
    fixed++;
    if (playing > scan.frames) extraBlank += playing - scan.frames;
    else missed += scan.frames - playing;
  }

  if (fixed === 0) return 0;

  const next = Object.assign({}, pack, { states: states });
  const v = validateMascotPack(JSON.parse(JSON.stringify(next)));
  if (!v.ok || !v.pack) return 0;
  /* 注意这里**不传 hidden**：自动修复不该把用户收起来的角色又放出来 */
  applyMascot(v.pack);
  const parts: string[] = [];
  if (extraBlank > 0) parts.push('原来会多播 ' + extraBlank + ' 个空白格（看着就是一闪一闪）');
  if (missed > 0) parts.push('原来少播了 ' + missed + ' 帧');
  showToast('逐帧图已按实测帧数修正：' + parts.join('，'), 'ok');
  return fixed;
}

export function removeMascot(): void {
  applyMascot(null);
}

/**
 * 保存一个**已经构造好的**角色包（角色编辑器的出口）。
 *
 * 和导入路径只差一步：编辑器里拿到的是对象而不是文件文本，
 * 所以这里不再解析，但仍然过一遍校验 —— 界面上的草稿能填出越界值，
 * 而落盘的必须是合法包。
 */
export function saveMascotPack(pack: MascotPack): { ok: boolean; error?: string; warnings: string[] } {
  const r = validateMascotPack(JSON.parse(JSON.stringify(pack)));
  if (!r.ok || !r.pack) return { ok: false, error: r.errors.join('；') || '这个角色包不完整', warnings: r.warnings };
  applyMascot(r.pack, false);
  return { ok: true, warnings: r.warnings };
}

export function patchMascotPrefs(patch: Partial<MascotPrefs>): void {
  patchPrefs({ mascot: Object.assign({}, state.prefs.mascot, patch) });
}

/** 打开角色编辑器；'edit' 会把当前角色倒进表单里 */
export function openMascotEditor(mode: 'new' | 'edit'): void {
  setState({ mascotEditor: mode });
}

export function closeMascotEditor(): void {
  setState({ mascotEditor: null });
}

/** 把角色放回默认角落 —— 拖到屏幕外之后的自救入口 */
export function resetMascotPosition(): void {
  const d = defaultMascotPrefs();
  patchMascotPrefs({ x: d.x, y: d.y });
}

/** 导出角色包文本（换机、分享给同学用） */
export function mascotExportText(): { fileName: string; text: string; hasRefs: boolean } | null {
  if (!state.mascot) return null;
  const r = mascotFileText(state.mascot);
  return { fileName: r.fileName, text: r.text, hasRefs: r.hasRefs };
}

/** 角色占用的资产 key，清理孤儿素材时要用 */
export function mascotAssetKeys(): string[] {
  return collectMascotKeys(state.mascot);
}

/* ------------------------------ 偏好 ------------------------------ */

export function patchPrefs(patch: Partial<Prefs>): void {
  const next = Object.assign({}, state.prefs, patch);
  setState({ prefs: next });
  try {
    const json = JSON.stringify(next);
    localStorage.setItem(KEY_PREFS, json);
    kvSet(KEY_PREFS, json);
    touchedByUser = true;
  } catch (e) { /* 忽略 */ }
}

/* ------------------------------ 主题动作 ------------------------------ */

export function patchTheme(patch: Partial<Theme>, silent?: boolean): void {
  const next = Object.assign({}, state.theme, patch);
  setState({ theme: next });
  if (!silent) persistTheme(next);
}

export function patchWallpaper(patch: Partial<Theme['wallpaper']>): void {
  const wp = Object.assign({}, state.theme.wallpaper, patch);
  patchTheme({ wallpaper: wp });
}

export function applyPreset(id: string): void {
  const p = presetById(id);
  if (!p) return;
  const theme = p.build();
  setState({ theme: theme });
  persistTheme(theme);
  showToast('已应用「' + p.name + '」', 'ok');
}

export function resetTheme(): void {
  const t = defaultTheme();
  setState({ theme: t });
  persistTheme(t);
  showToast('已恢复默认外观', 'ok');
}

/**
 * 导出结果的统一提示。
 *
 * 三种成功路径的说法必须不一样：分享面板是"你去选存哪儿"，
 * 文档目录是"已经替你存好了"，取消是"什么都没发生"。
 * 一句笼统的"导出成功"会让人找不到文件，然后以为功能坏了。
 */
export function toastSave(r: SaveOutcome, label: string): void {
  if (r === 'shared') showToast(label + '已生成，选「保存到文件」或直接发出去', 'ok');
  else if (r === 'saved') showToast(label + '已保存到「文档」目录', 'ok');
  else if (r === 'cancelled') showToast('已取消导出', 'info');
  else showToast(label + '失败' + (lastSaveError() ? '：' + lastSaveError() : ''), 'error');
}

export async function exportThemeNow(): Promise<void> {
  try {
    const pack = themeFileText(state.theme);
    const r = await saveTextFile({
      fileName: pack.fileName,
      text: pack.text,
      mime: 'application/json',
      title: '课表助手主题包 · ' + state.theme.meta.name,
      dialogTitle: '导出主题包',
    });
    toastSave(r, '主题包（含图片，' + Math.round(pack.bytes / 1024) + ' KB）');
  } catch (e) {
    showToast('导出失败：' + (e as Error).message, 'error');
  }
}

/** 把一个校验过的主题装上去。主题包文件和外观分享码走的是同一条路 */
export function importThemeObject(theme: Theme, warnings?: string[]): void {
  setState({ theme: theme });
  persistTheme(theme);
  setState({ tab: 'studio' });
  const w = warnings || [];
  showToast('已导入外观「' + theme.meta.name + '」' + (w.length ? '（' + w.length + ' 条提示）' : ''), 'ok');
  if (w.length) console.warn('外观导入提示：', w);
}

export async function importThemeFromFile(file: File): Promise<void> {
  try {
    const r = await parseThemeFile(file);
    importThemeObject(r.theme, r.warnings);
  } catch (e) {
    showToast('导入失败：' + (e as Error).message, 'error');
  }
}


/* ============================================================================
   云备份（可选功能，v1.6.0）
   ----------------------------------------------------------------------------
   定位：**默认完全本地**。没配置 Supabase（cloudConfigured() 为假）时，
   这一整块在界面上不存在，应用里也没有任何一处会发起网络请求 ——
   这一点是硬约束，不是"应该不会"。

   配置了之后，也只有"用户主动点按钮"才会联网：
   注册 / 登录 / 忘记密码 / 立即备份 / 从云端恢复 / 删除云端数据。
   打开应用、切页面、改课表都不会偷偷上传。
   ============================================================================ */

export type CloudBusy = '' | 'signin' | 'signup' | 'recover' | 'load' | 'backup' | 'restore' | 'forget' | 'mail';

export interface CloudBackupInfo {
  updatedAt: string;
  appVersion: string;
  device: string;
  summary: string;
}

export interface CloudState {
  session: CloudSession | null;
  busy: CloudBusy;
  /** 上一次操作的错误，展示在面板里（不是一闪而过的提示条） */
  error: string;
  /** 需要用户读一句的话，比如"注册成功，去邮箱确认" */
  notice: string;
  /** 云端那一行的信息；null 表示还没查或云端没有备份 */
  backup: CloudBackupInfo | null;
  /** 登录成功后是否正在询问"要怎么同步" */
  syncAsk: boolean;
  /** 是否正在显示「设置新密码」面板（找回密码的链接进来时自动打开） */
  passwordSheet: boolean;
  /** 从邮件链接回来时的类型：signup / recovery / … */
  linkType: string;
  /** 右上角那个云入口打开的弹层 */
  sheet: boolean;
  /** 云端角色：自己的 + 别人公开的（按 user_id 区分） */
  mascots: CloudMascot[];
  mascotsLoaded: boolean;
  mascotsBusy: boolean;
  mascotsError: string;
  quota: MascotQuota | null;
}

/**
 * 启动时的云状态。
 *
 * 这里要处理**邮件链接回跳**：确认邮箱 / 重置密码的链接会 302 回站点，
 * 并把凭据放在 URL 的 fragment 里。以前完全没看它 —— 用户点了链接回来仍是未登录，
 * 「找回密码」这条路等于断了。所以：
 *
 *   1. 认得出 fragment 里的令牌就当场登录；
 *   2. type=recovery 时直接把「设置新密码」面板打开；
 *   3. 出错（链接过期 / 用过）就把原因写进 error，让面板说人话；
 *   4. **处理完把 fragment 抹掉** —— 否则刷新一次就重新登录一次，而且那串令牌会留在地址栏里。
 */
function initialCloud(autoLogin: boolean): CloudState {
  /*
   * 自动登录关掉时：**不恢复登录状态**，并且把本机存的刷新令牌清掉。
   * 清掉是刻意的 —— 留着它等于"用户以为关了自动登录，实际下次还是自动登录"。
   * 本次会话不受影响（这次的登录状态在内存里），下次打开才需要重新输密码。
   */
  const restored = autoLogin ? loadSession() : null;
  if (!autoLogin) saveSession(null);
  const base: CloudState = {
    session: restored, busy: '', error: '', notice: '', backup: null, syncAsk: false, passwordSheet: false, linkType: '',
    /* ?open=cloud：开发与无头检查用，直接把云弹层打开 */
    sheet: openParam() === 'cloud',
    mascots: [], mascotsLoaded: false, mascotsBusy: false, mascotsError: '', quota: null,
  };
  let link = null;
  try { link = parseAuthLink(window.location.hash, window.location.search); } catch (e) { link = null; }
  if (link && link.kind === 'session' && link.session) {
    const session = link.session;
    saveSession(session);
    base.session = session;
    base.linkType = link.type || '';
    base.passwordSheet = link.type === 'recovery';
    base.notice = link.type === 'recovery'
      ? '邮件里的链接已验证，请在下面设置新密码。'
      : '邮箱已验证，已为你登录。';
  } else if (link && link.kind === 'error') {
    base.error = link.message || '邮件链接不能用，请在应用里重新申请一次';
    base.linkType = link.type || '';
  }
  if (link && link.kind !== 'none') {
    try {
      /* 抹掉 fragment / 邮件链接带的查询参数，不产生新的历史记录 */
      const clean = window.location.pathname + window.location.search.replace(/[?&](code|error|error_code|error_description)=[^&]*/g, '').replace(/^&/, '?');
      window.history.replaceState(null, '', clean);
    } catch (e) { /* 拿不到 history 就算了 */ }
  }
  return base;
}

function setCloud(patch: Partial<CloudState>): void {
  setState({ cloud: Object.assign({}, state.cloud, patch) });
}

/** 界面用：这个构建里有没有云备份能力 */
export function cloudAvailable(): boolean {
  return cloudConfigured();
}

/** 界面用：备份会发到哪台服务器（只显示域名） */
export function cloudServerHost(): string {
  return cloudHost();
}

export function cloudSignedIn(): boolean {
  return !!state.cloud.session;
}

/** 统一的错误出口：既写进面板状态，也弹一次提示条 */
function cloudFail(e: unknown, fallback: string): void {
  const msg = e instanceof CloudError || e instanceof Error ? e.message : String(e);
  const text = msg || fallback;
  setCloud({ busy: '', error: text });
  showToast(text, 'error');
}

/** 拿到当下可用的令牌；顺带处理"刷新失败 → 退出登录" */
async function cloudToken(): Promise<string> {
  const s = state.cloud.session;
  if (!s) throw new CloudError('还没登录', 0, 'no_session');
  try {
    const next = await freshToken(s);
    if (next !== s) { saveSession(next); setCloud({ session: next }); }
    return next.accessToken;
  } catch (e) {
    saveSession(null);
    setCloud({ session: null, backup: null });
    throw e;
  }
}

export async function cloudRegister(email: string, password: string): Promise<void> {
  if (!cloudConfigured()) return;
  setCloud({ busy: 'signup', error: '', notice: '' });
  try {
    const session = await cloudSignUpApi(email.trim(), password);
    if (!session) {
      /* 项目开了邮箱确认：这一步如实说明，别让人以为注册失败了 */
      setCloud({ busy: '', notice: '注册成功。去 ' + email.trim() + ' 的收件箱点一下确认链接，再回来登录。' });
      showToast('注册成功，请去邮箱确认', 'ok');
      return;
    }
    saveSession(session);
    setCloud({ session: session, busy: '', notice: '已登录：' + session.user.email });
    showToast('已登录', 'ok');
    /* 拉完云端备份信息再问"要怎么同步" —— 那一问的内容取决于云端有没有备份 */
    void cloudLoadInfo().then(function () { askSync(); });
  } catch (e) { cloudFail(e, '注册失败'); }
}

export async function cloudLogin(email: string, password: string): Promise<void> {
  if (!cloudConfigured()) return;
  setCloud({ busy: 'signin', error: '', notice: '' });
  try {
    const session = await cloudSignInApi(email.trim(), password);
    saveSession(session);
    setCloud({ session: session, busy: '' });
    showToast('已登录：' + session.user.email, 'ok');
    void cloudLoadInfo().then(function () { askSync(); });
  } catch (e) { cloudFail(e, '登录失败'); }
}

export async function cloudRecover(email: string): Promise<void> {
  if (!cloudConfigured()) return;
  setCloud({ busy: 'recover', error: '', notice: '' });
  try {
    await sendRecover(email.trim(), emailRedirectUrl());
    setCloud({
      busy: '',
      notice: '重置密码的邮件已发出，去 ' + email.trim() + ' 收件箱点链接即可设置新密码。'
        + (isNativePlatform() ? '（手机上会打开浏览器完成，改完回应用里用新密码登录）' : ''),
    });
    showToast('重置密码邮件已发出', 'ok');
  } catch (e) { cloudFail(e, '发送失败'); }
}

export function cloudLogout(): void {
  const s = state.cloud.session;
  saveSession(null);
  setCloud({ session: null, backup: null, error: '', notice: '已退出登录。云端的备份还在，本机数据不受影响。' });
  if (s) void cloudSignOutApi(s.accessToken);
  showToast('已退出登录（本机数据不受影响）', 'ok');
}

/** 查一眼云端备份的信息（登录后自动跑一次，也可以手动刷新） */
export async function cloudLoadInfo(): Promise<void> {
  if (!cloudConfigured() || !state.cloud.session) return;
  setCloud({ busy: 'load', error: '' });
  try {
    const token = await cloudToken();
    const row = await fetchBackup(token);
    if (!row) {
      setCloud({ busy: '', backup: null });
      return;
    }
    const payload = validateBackup(row.payload);
    setCloud({
      busy: '',
      backup: {
        updatedAt: row.updated_at,
        appVersion: row.app_version,
        device: row.device,
        summary: describeBackup(payload),
      },
    });
  } catch (e) { cloudFail(e, '读取云端备份失败'); }
}

/**
 * 立即备份。
 *
 * 体积超限时**丢图片而不是丢请求**：buildBackupWithinLimit 会退到"只备份课表与设置"，
 * 并由调用方如实告诉用户图片没进去、该怎么带走（主题包 / 角色包）。
 * 悄悄少传几张图是这一版最不能犯的错。
 */
export async function cloudBackupNow(): Promise<void> {
  if (!cloudConfigured() || !state.cloud.session) return;
  setCloud({ busy: 'backup', error: '' });
  try {
    const token = await cloudToken();
    const built = buildBackupWithinLimit({
      data: state.data,
      prefs: state.prefs,
      theme: state.theme,
      appVersion: APP_VERSION || '',
      device: deviceLabel(),
    });
    const row = await saveBackup(token, state.cloud.session.user.id, built.payload, APP_VERSION || '', deviceLabel());
    setCloud({
      busy: '',
      backup: {
        updatedAt: row.updated_at,
        appVersion: row.app_version,
        device: row.device,
        summary: describeBackup(built.payload),
      },
    });
    showToast(
      built.droppedAssets
        ? '已备份课表与设置，但图片太大没进去（请用主题包带走图片）'
        : '已备份到云端：' + describeBackup(built.payload),
      built.droppedAssets ? 'warn' : 'ok'
    );
  } catch (e) { cloudFail(e, '备份失败'); }
}

/** 从云端恢复：覆盖本机，走 setData 所以可以撤销 */
export async function cloudRestoreNow(): Promise<void> {
  if (!cloudConfigured() || !state.cloud.session) return;
  setCloud({ busy: 'restore', error: '' });
  try {
    const token = await cloudToken();
    const row = await fetchBackup(token);
    if (!row) { setCloud({ busy: '' }); showToast('云端还没有备份', 'info'); return; }
    const payload = validateBackup(row.payload);
    const before = state.data.courses.length;
    const ok = await confirmDanger(
      '用云端备份覆盖本机？当前的 ' + before + ' 门课会被替换。'
      + '（这是可撤销的一步，之后能点提示条上的「撤销」退回）',
      '覆盖恢复'
    );
    if (!ok) { setCloud({ busy: '' }); return; }

    const a = restoreAssets(payload);
    /* 数据走 setData：记一笔历史，于是"恢复"这一步也能撤销 */
    setData(payload.data, '从云端恢复', 'import');
    /* 外观与偏好跟着一起回来（只覆盖白名单里的那几项） */
    if (payload.theme && payload.theme.meta) {
      const merged = Object.assign({}, state.theme, payload.theme);
      persistTheme(merged);
      setState({ theme: merged });
    }
    if (payload.prefs) patchPrefs(payload.prefs);
    setWeek(clampWeek(weekOfDate(payload.data.term, todayISO())));
    setCloud({
      busy: '',
      backup: {
        updatedAt: row.updated_at,
        appVersion: row.app_version,
        device: row.device,
        summary: describeBackup(payload),
      },
    });
    showToast(
      '已从云端恢复：' + describeBackup(payload) + (a.skipped ? '（' + a.skipped + ' 张图片不在备份里）' : ''),
      a.skipped ? 'warn' : 'ok'
    );
  } catch (e) { cloudFail(e, '恢复失败'); }
}

/** 只删云端的备份，账号留着 */
export async function cloudDeleteBackup(): Promise<void> {
  const s = state.cloud.session;
  if (!cloudConfigured() || !s) return;
  const ok = await confirmDanger('删除云端的这份备份？账号会保留，本机数据也不受影响。', '删除备份');
  if (!ok) return;
  setCloud({ busy: 'forget', error: '' });
  try {
    const token = await cloudToken();
    await deleteBackup(token, s.user.id);
    setCloud({ busy: '', backup: null, notice: '云端备份已删除。' });
    showToast('云端备份已删除', 'ok');
  } catch (e) { cloudFail(e, '删除失败'); }
}

/**
 * 注销账号：走 Edge Function（需要 service_role，客户端做不了）。
 * 说清楚两件事：删的是账号与云端数据；**本机课表不会动**。
 */
export async function cloudDeleteAccount(): Promise<void> {
  const s = state.cloud.session;
  if (!cloudConfigured() || !s) return;
  const ok = await confirmDanger(
    '注销账号并删除云端数据？删掉之后无法恢复（本机课表不受影响，还会留着）。',
    '注销账号'
  );
  if (!ok) return;
  setCloud({ busy: 'forget', error: '' });
  try {
    const token = await cloudToken();
    await callFunction('delete-account', token, {});
    saveSession(null);
    setCloud({ session: null, backup: null, busy: '', notice: '账号与云端数据已删除。本机课表还在。' });
    showToast('账号与云端数据已删除，本机数据保留', 'ok');
  } catch (e) { cloudFail(e, '注销失败'); }
}

/**
 * 把本周课表发到自己的邮箱。
 *
 * 邮件正文由**客户端**算好再交给服务端 —— 服务端只负责发信。
 * 这是刻意的：时间引擎在这个仓库里只有一份实现（src/core/engine.ts），
 * 让 Edge Function 再算一遍"今天第几周、今天上什么课"，等于养第二份引擎，
 * 迟早出现"邮件里和界面上不一样"的那种 bug。
 *
 * 收件人由服务端从 token 里取，客户端连 to 都不传。
 */
export async function cloudMailWeek(): Promise<void> {
  const s = state.cloud.session;
  if (!cloudConfigured() || !s) return;
  const cols: ExportColumn[] = ['date', 'weekday', 'period', 'start', 'end', 'course', 'location', 'teacher'];
  const rows = weekRows(state.data, state.week, cols);
  if (rows.length === 0) { showToast('这一周没有课，就不用发了', 'info'); return; }
  setCloud({ busy: 'mail', error: '', notice: '' });
  try {
    const token = await cloudToken();
    const title = (state.data.term.name || '我的课表') + ' · 第 ' + state.week + ' 周';
    await callFunction('send-mail', token, { subject: '课表助手 · ' + title, text: toMarkdown(rows, cols, title) });
    setCloud({ busy: '', notice: '课表已发到 ' + s.user.email + '。没收到就看一眼垃圾邮件。' });
    showToast('邮件已发出', 'ok');
  } catch (e) { cloudFail(e, '发信失败'); }
}

/**
 * 邮件链接登录后补一次资料。
 *
 * 回跳链接里只有令牌，没有邮箱（Supabase 不保证带 user_id / email），
 * 所以登录状态先落地、再补一次 GET /auth/v1/user 把邮箱填上。
 * 这一步只会在"刚点了邮件链接"之后跑一次，平时不会发请求。
 */
export async function cloudFillProfile(): Promise<void> {
  const s = state.cloud.session;
  if (!cloudConfigured() || !s || s.user.email) return;
  try {
    const me = await fetchMe(await cloudToken());
    if (!me.id && !me.email) return;
    const next: CloudSession = Object.assign({}, s, { user: { id: me.id || s.user.id, email: me.email || s.user.email } });
    saveSession(next);
    setCloud({ session: next });
    /* 从邮件链接进来的人同样要面对"用哪一份"的问题，所以也问一次 */
    void cloudLoadInfo().then(function () { askSync(); });
  } catch (e) { /* 补不到就算了，登录状态本身还在 */ }
}

export function openCloudPassword(): void {
  setCloud({ passwordSheet: true, error: '', notice: '' });
}

export function closeCloudPassword(): void {
  setCloud({ passwordSheet: false });
}

/**
 * 设置 / 修改密码。
 *
 * 两条入口共用：找回密码的链接（凭临时会话）与登录后的「修改密码」。
 * 成功后不清除登录状态 —— 让他接着用就行，这也是 Supabase 的默认行为。
 */
export async function cloudSetPassword(password: string): Promise<boolean> {
  if (!cloudConfigured() || !state.cloud.session) return false;
  setCloud({ busy: 'mail', error: '', notice: '' });
  try {
    await updatePassword(await cloudToken(), password);
    setCloud({ busy: '', passwordSheet: false, notice: '密码已更新，下次用新密码登录。' });
    showToast('密码已更新', 'ok');
    return true;
  } catch (e) {
    cloudFail(e, '设置密码失败');
    return false;
  }
}


/* ------------------------------ 云端角色 ------------------------------ */

export function openCloudSheet(): void {
  setCloud({ sheet: true, error: '', mascotsError: '' });
  void cloudLoadMascots();
}

export function closeCloudSheet(): void {
  setCloud({ sheet: false });
}

/**
 * 拉一次角色列表。
 *
 * 没登录也能拉：公开的角色对所有人可见（"把设计公开给别人用"就是这个意思），
 * 所以这里传的是"当前令牌（可能为空）"。
 */
export async function cloudLoadMascots(): Promise<void> {
  if (!cloudConfigured()) return;
  setCloud({ mascotsBusy: true, mascotsError: '' });
  try {
    let token: string | null = null;
    if (state.cloud.session) {
      try { token = await cloudToken(); } catch (e) { token = null; }
    }
    const list = await listMascots(token);
    const q = token ? await myQuota(token).catch(function () { return null; }) : null;
    setCloud({ mascots: list, mascotsLoaded: true, mascotsBusy: false, quota: q || state.cloud.quota });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setCloud({ mascotsBusy: false, mascotsLoaded: true, mascotsError: msg });
  }
}

/** 把本机当前的角色传到云端 */
export async function cloudUploadMascot(name: string, isPublic: boolean): Promise<boolean> {
  const s = state.cloud.session;
  if (!cloudConfigured() || !s) { setCloud({ mascotsError: '先登录再上传角色' }); return false; }
  const pack = state.mascot;
  if (!pack) { setCloud({ mascotsError: '本机还没有角色：先在外观 → 角色里做一个或导入一个' }); return false; }
  /* 客户端先提醒一次配额 —— 真正的判定在数据库触发器里，那边才是安全边界 */
  const q = state.cloud.quota;
  if (q && !q.unlimited && q.used >= q.limit) {
    setCloud({ mascotsError: '云端角色已经 ' + q.used + ' / ' + q.limit + '：先在列表里删掉一个再传' });
    return false;
  }
  setCloud({ mascotsBusy: true, mascotsError: '' });
  try {
    const token = await cloudToken();
    const row = await uploadMascot(token, s.user.id, pack, name || pack.name || '未命名角色', isPublic);
    await cloudLoadMascots();
    setCloud({ mascotsBusy: false });
    showToast('已上传到云端：' + row.name + (isPublic ? '（已公开）' : ''), 'ok');
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setCloud({ mascotsBusy: false, mascotsError: msg });
    showToast(msg, 'error');
    return false;
  }
}

/** 用云端的某个角色替换本机当前角色（含素材） */
export async function cloudUseMascot(m: CloudMascot): Promise<void> {
  if (!cloudConfigured()) return;
  /*
   * 本机已经有角色时先问一句。
   * 「使用」是不可撤销的替换（旧角色连同它的素材一起被换掉），
   * 在列表里点一下就发生这种事，用户很容易点错 —— 而这类误触正是这个项目一直在防的。
   */
  if (state.mascot) {
    const ok = await confirmDanger(
      '用「' + m.name + '」替换现在的角色「' + state.mascot.name + '」？'
      + '替换之后本机原来那个就没了 —— 除非你把它传过云端或导出过角色包。',
      '替换'
    );
    if (!ok) return;
  }
  setCloud({ mascotsBusy: true, mascotsError: '' });
  try {
    let token: string | null = null;
    if (state.cloud.session) { try { token = await cloudToken(); } catch (e) { token = null; } }
    const r = await fetchMascot(token, m.path);
    if (!r.ok || !r.pack) {
      throw new Error(r.errors.join('；') || '这个角色包读不出来');
    }
    const applied = importMascotPack(JSON.stringify(r.pack), m.name);
    if (!applied.ok) throw new Error(applied.error || '这个角色包用不了');
    setCloud({ mascotsBusy: false, sheet: false });
    showToast('已用上「' + m.name + '」' + (applied.warnings.length ? '（' + applied.warnings.length + ' 条提示）' : ''), 'ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setCloud({ mascotsBusy: false, mascotsError: msg });
    showToast(msg, 'error');
  }
}

export async function cloudSetMascotPublic(m: CloudMascot, isPublic: boolean): Promise<void> {
  const s = state.cloud.session;
  if (!cloudConfigured() || !s) return;
  try {
    const token = await cloudToken();
    await setMascotPublic(token, m.id, isPublic);
    setCloud({
      mascots: state.cloud.mascots.map(function (x) { return x.id === m.id ? Object.assign({}, x, { is_public: isPublic }) : x; }),
    });
    showToast(isPublic ? '已公开，别人可以在「公开角色」里看到并使用' : '已取消公开', 'ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setCloud({ mascotsError: msg });
    showToast(msg, 'error');
  }
}

export async function cloudDeleteMascot(m: CloudMascot): Promise<void> {
  const s = state.cloud.session;
  if (!cloudConfigured() || !s) return;
  const ok = await confirmDanger('删除云端的「' + m.name + '」？删掉之后这个角色在云端就没有了（本机正在用的那个不受影响）。', '删除');
  if (!ok) return;
  setCloud({ mascotsBusy: true, mascotsError: '' });
  try {
    const token = await cloudToken();
    await deleteCloudMascot(token, m);
    setCloud({ mascots: state.cloud.mascots.filter(function (x) { return x.id !== m.id; }), mascotsBusy: false });
    void cloudLoadMascots();
    showToast('已从云端删除', 'ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setCloud({ mascotsBusy: false, mascotsError: msg });
    showToast(msg, 'error');
  }
}

/** 界面用：配额那一行字 */
export function cloudQuotaLine(): string {
  return quotaLine(state.cloud.quota);
}


/* ------------------------------ 登录后的同步询问 ------------------------------ */

/**
 * 登录/注册成功之后问一句"要怎么同步"。
 *
 * 直接问而不是自动合并：这一版刻意只做手动同步，而"往哪边覆盖"猜错就是丢数据。
 * 两边都空时不问（没什么可同步的），免得登录完立刻弹一个没内容的框。
 */
function askSync(): void {
  const local = state.data.courses.length;
  const cloudHasBackup = !!state.cloud.backup;
  const kind = syncPromptFor({ localCourses: local, cloudHasBackup: cloudHasBackup }).kind;
  setCloud({ syncAsk: kind !== 'none' });
}

export function closeSyncAsk(): void {
  setCloud({ syncAsk: false });
}

/** 面板上的两个动作，直接复用备份 / 恢复那两条路 */
export async function syncPromptAct(action: 'restore' | 'backup'): Promise<void> {
  setCloud({ syncAsk: false });
  if (action === 'restore') await cloudRestoreNow();
  else await cloudBackupNow();
}

/**
 * 启动时把登录状态续上（只在用户开着"自动登录"且确实登录过时跑）。
 *
 * 为什么要主动做一次而不是等用户操作：访问令牌只有一小时，隔夜再打开时它早就过期了，
 * 界面却仍然显示"已登录" —— 用户点备份才发现要重新登录，是最让人恼火的一种失望。
 * 这里在启动后安静地续一次期；续不上（被撤销 / 被删号）就如实清掉登录状态并说明。
 *
 * 注意这也是一次"没按按钮就发出的请求"，所以它只在**用户自己登录过**的前提下发生，
 * 而且可以在设置里关掉自动登录，关掉之后启动时不会有这个请求。
 */
export async function cloudResume(): Promise<void> {
  if (!cloudConfigured()) return;
  if (state.prefs.autoLogin === false) return;
  const s = state.cloud.session;
  if (!s) return;
  try {
    await cloudToken();
    /* 顺手把"上次备份是什么时候"刷出来 —— 面板一打开就是对的 */
    await cloudLoadInfo();
  } catch (e) {
    /* cloudToken 失败时已经清掉登录状态，这里只把原因说出来 */
    const msg = e instanceof Error ? e.message : String(e);
    setCloud({ notice: msg, backup: null });
  }
}

/** 设备名只用来在备份信息里区分来源，不参与恢复逻辑 */
function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : (navigator.userAgent || '');
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return '浏览器';
}

/** 备份信息的展示文案（面板里用） */
export function cloudBackupLine(info: CloudBackupInfo | null): string {
  if (!info) return '云端还没有备份';
  return formatTime(info.updatedAt) + ' · ' + info.device + ' · ' + info.summary;
}


/* ============================================================================
   检查更新（v1.8.0）
   ----------------------------------------------------------------------------
   网页版不需要它：每次打开都是服务器上最新的一份。
   安卓版能自动检查、自动下载，但**最后一下「安装」必须用户点** ——
   安卓不给普通应用静默安装自己的权力（那是应用商店 / 设备管理员才有的）。
   能省掉的是"去浏览器下载、再翻文件管理器找安装包"这两步。

   联网性质：只读自己站点上的一个静态文件（latest.json），不带任何标识；
   可以在设置里整个关掉。失败了就说失败，不弹一堆东西骚扰。
   ============================================================================ */

export interface UpdateState {
  checking: boolean;
  result: CheckResult | null;
  /** 下载进度 0–100；null 表示没在下 */
  progress: number | null;
  error: string;
  sheet: boolean;
}

function setUpdate(patch: Partial<UpdateState>): void {
  setState({ update: Object.assign({}, state.update, patch) });
}

/**
 * 查一次。
 * manual = 用户主动点的（失败要说出来、有新版本要打开面板）；
 * 自动的只在新版本存在时轻提示一次 —— 不能每次启动都弹一个"已是最新"。
 */
export async function checkUpdateNow(manual: boolean): Promise<void> {
  setUpdate({ checking: true, error: '' });
  try {
    const r = await checkForUpdate(APP_VERSION || '0.0.0', updateManifestUrls());
    setUpdate({ checking: false, result: r });
    if (r.kind === 'newer') {
      setUpdate({ sheet: true });
      showToast('发现新版本 ' + r.info.version, 'info');
    } else if (manual) {
      showToast(updateSummary(r), r.kind === 'error' ? 'warn' : 'ok');
    }
  } catch (e) {
    const msg = (e as Error).message || '检查更新失败';
    setUpdate({ checking: false, error: msg, result: { kind: 'error', message: msg } });
    if (manual) showToast(msg, 'warn');
  }
}

export function openUpdateSheet(): void { setUpdate({ sheet: true }); }
export function closeUpdateSheet(): void { setUpdate({ sheet: false, progress: null }); }

/** 界面用：一句话状态 */
export function updateLine(): string {
  if (state.update.checking) return '正在检查…';
  const r = state.update.result;
  if (!r) return isNativePlatform() ? '当前 v' + (APP_VERSION || '?') : '网页版每次打开就是最新版';
  return updateSummary(r);
}

/**
 * 下载并交给系统安装器。
 *
 * 两条前置检查都在这里做，而且**都用人话说清楚**：
 *   1. 没有"安装未知应用"授权 → 直接把他送到那个设置页，而不是让他点了之后对着失败弹窗发愣；
 *   2. 清单里没有下载地址（本地构建就是这样）→ 说清楚，不假装在下载。
 */
export async function installUpdate(): Promise<void> {
  const info = state.update.result;
  if (!info || info.kind !== 'newer') return;
  const url = info.info.apkUrl || '';
  if (!url) {
    setUpdate({ error: '这个版本没有拿到安装包地址（多半是开发构建），请到项目主页的 Releases 里下载' });
    return;
  }
  if (!isNativePlatform()) {
    setUpdate({ error: '网页版不用手动更新：刷新一下就是最新版' });
    return;
  }
  const perm = await canInstallApk();
  if (perm && perm.allowed === false) {
    const opened = await openInstallSettings();
    setUpdate({ error: opened
      ? '请先在系统页面里允许「安装未知应用」，然后回来再点一次更新'
      : '请到系统设置 → 应用 → 课表助手 → 安装未知应用中允许' });
    return;
  }
  setUpdate({ progress: 0, error: '' });
  const r = await downloadAndInstallApk(url, 'timetable-app-' + info.info.version + '.apk', function (p) {
    setUpdate({ progress: p });
  });
  if (!r.ok) {
    setUpdate({ progress: null, error: r.error || '下载失败' });
    showToast('下载失败：' + (r.error || '未知原因'), 'error');
    return;
  }
  setUpdate({ progress: null });
  showToast('安装包已下载，请在系统弹窗里点「安装」', 'ok');
}

/* ------------------------------ 其它动作 ------------------------------ */

/** 周次只在 [1, MAX_WEEK] 之间有定义；时间轴本身不再受学期长度限制 */
export function clampWeek(w: number): number {
  if (!isFinite(w)) return 1;
  return Math.min(MAX_WEEK, Math.max(1, Math.round(w)));
}

export function setTab(tab: TabKey): void {
  /* 离开外观页就自动锁上 —— 下次进来又是只读的 */
  if (state.tab === 'studio' && tab !== 'studio' && state.prefs.studioLocked === false) {
    patchPrefs({ studioLocked: true });
  }
  setState({ tab: tab });
}

/** 危险操作是否要二次确认 */
export function needConfirm(): boolean {
  return state.prefs.confirmDestructive !== false;
}

/**
 * 危险操作确认。
 *
 * 原来是 `window.confirm` —— 系统白底弹窗，字体、按钮、配色全是系统的，
 * 在设置页和删除按钮上一出现就把界面调性打断了。现在走应用内的卡片，
 * 返回 Promise，调用处写成 `if (await confirmDanger(...))` 即可。
 */
export function confirmDanger(message: string, okText?: string): Promise<boolean> {
  /* 用户关掉「危险操作二次确认」时直接放行，行为和以前一致 */
  if (!needConfirm()) return Promise.resolve(true);
  return new Promise(function (resolve) {
    setState({ confirm: { message: message, okText: okText || '确定', danger: true, resolve: resolve } });
  });
}

/** 确认框按钮的回调；无论点哪个都会把 Promise 结掉，不会留下悬空的状态 */
export function resolveConfirm(ok: boolean): void {
  const c = state.confirm;
  if (!c) return;
  setState({ confirm: null });
  c.resolve(ok);
}
export function setWeek(week: number): void { setState({ week: clampWeek(week) }); }
export function jumpToDate(dateISO: string): void {
  setState({ week: clampWeek(weekOfDate(state.data.term, dateISO)) });
}
export function openCourse(id: string): void { setState({ courseSheet: id }); }
export function openOverride(sessionId: string): void { setState({ overrideSheet: sessionId }); }
export function openScheme(): void { setState({ schemeSheet: true }); }
export function openSearch(): void { setState({ searchSheet: true }); }

/** 把当前这一周的课表导出成图片，并交给系统分享 */
export async function shareWeekImage(): Promise<void> {
  try {
    const days = state.theme.showDays || (state.theme.showWeekend ? 7 : 5);
    const week = state.week;
    const r = await shareTimetable(
      state.data,
      { week: week, days: days, theme: state.theme, systemDark: state.systemDark },
      '课表-第' + week + '周.png',
      state.data.term.name + ' 第 ' + week + ' 周课表'
    );
    if (r === 'shared') showToast('已打开分享面板', 'ok');
    else if (r === 'downloaded') showToast('课表图片已保存', 'ok');
    else if (r === 'failed') showToast('导出图片失败', 'error');
  } catch (e) {
    showToast('导出图片失败：' + (e as Error).message, 'error');
  }
}

export async function exportIcsNow(): Promise<void> {
  try {
    const text = exportIcs(state.data);
    const events = (text.match(/BEGIN:VEVENT/g) || []).length;
    const r = await saveTextFile({
      fileName: (state.data.term.name || '我的课表') + '.ics',
      text: text,
      mime: 'text/calendar;charset=utf-8',
      title: '课表助手日历 · ' + events + ' 条日程',
      dialogTitle: '导出日历文件',
    });
    toastSave(r, '日历文件（' + events + ' 条日程）');
  } catch (e) {
    showToast('导出失败：' + (e as Error).message, 'error');
  }
}

/**
 * 把从表格里解析出来的时段写进课表。
 *
 * 批量导入最容易出的问题是"导错了要一条条删"，所以这里刻意带上撤销按钮 ——
 * setData 本身就会记一步可撤销的变更，这里只是把入口接到提示条上。
 */
export function applySheetImport(
  sessions: ParsedSession[], mode: 'merge' | 'replace'
): { courses: number; sessions: number; duplicates: number } {
  const r = buildImportedData(state.data, sessions, mode);
  const id = setData(r.data, mode === 'merge' ? '合并导入表格' : '覆盖导入表格', 'import');
  setWeek(clampWeek(weekOfDate(r.data.term, todayISO())));
  setState({ importSheet: false });

  const extra = r.duplicates > 0 ? '，跳过 ' + r.duplicates + ' 个重复时段' : '';
  showToast('已导入 ' + r.courses + ' 门课 / ' + r.sessions + ' 个时段' + extra, 'ok', function () {
    if (id && undoChangeById(id)) showToast('已撤销导入', 'info');
    else showToast('这一步之后又有改动，已经撤不回去了', 'warn');
  });
  return r;
}

export async function importIcsFromFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const r = importIcs(text, state.data);
    if (r.courses === 0 && r.sessions === 0) {
      showToast('没有从文件里读到任何日程' + (r.warnings.length ? '：' + r.warnings[0] : ''), 'warn');
      return;
    }
    setData(r.data, '导入 ICS', 'import');
    setWeek(clampWeek(weekOfDate(r.data.term, todayISO())));
    showToast('已导入 ' + r.courses + ' 门课 / ' + r.sessions + ' 个时段' + (r.warnings.length ? '（' + r.warnings.length + ' 条提示）' : ''), 'ok');
    if (r.warnings.length) console.warn('ICS 导入提示：', r.warnings);
  } catch (e) {
    showToast('导入失败：' + (e as Error).message, 'error');
  }
}
export function openEdit(id: string): void { setState({ editSheet: id, courseSheet: null }); }
export function closeSheets(): void { setState({ courseSheet: null, editSheet: null, overrideSheet: null, schemeSheet: false, taskEditor: false, taskSheet: null, searchSheet: false, addSheet: false, shareSheet: null, exportSheet: false, manualSheet: false, manualSection: null, changelogSheet: false, importSheet: false,
    mascotEditor: null }); }
export function openAdd(): void { setState({ addSheet: true }); }

/** 打开分享码弹层：'export' 生成，'import' 粘贴 */
export function openShare(mode: 'export' | 'import'): void { setState({ shareSheet: mode }); }

/* ------------------------------ 插件提供的导出 ------------------------------ */

/** 交给平台层落地：原生走分享面板，浏览器走下载 */
function saveText(text: string, filename: string, mime: string, title: string): Promise<SaveOutcome> {
  return saveTextFile({ fileName: filename, text: text, mime: mime, title: title });
}

export function openExport(): void { setState({ exportSheet: true }); }
export function openImportSheet(): void { setState({ importSheet: true }); }
/** 打开说明书；给 section 就顺带跳到对应章节（角色面板的「怎么做角色包」用得上） */
export function openManual(section?: string): void {
  setState({ manualSheet: true, manualSection: section || null });
}
export function openChangelog(): void { setState({ changelogSheet: true }); }

/** 当前可用的导出格式（来自已启用且权限齐的插件） */
export function availableExports(): ActiveExport[] {
  try { return activeExports(); } catch (e) { return []; }
}

/**
 * 跑一次插件提供的导出。
 *
 * 插件只负责"选哪些列、导出哪一段"，真正的生成全在 core/exporters.ts 里 ——
 * 所以这里没有任何来自插件的代码被执行，最多是一组列名不合法，而清单校验
 * 已经在安装时挡掉了。
 */
export async function runPluginExport(pluginId: string, capabilityId: string): Promise<void> {
  const hit = availableExports().filter(function (e) {
    return e.pluginId === pluginId && e.capability.id === capabilityId;
  })[0];
  if (!hit) { showToast('这个导出格式已经不可用了', 'warn'); return; }

  const cap = hit.capability;
  try {
    const termName = state.data.term.name || '我的课表';
    let text = '';
    let ext = cap.format === 'csv' ? '.csv' : '.md';
    let base = termName;

    if (cap.scope === 'week') {
      const w = state.week;
      const rows = weekRows(state.data, w, cap.columns);
      text = cap.format === 'csv' ? toCsv(rows, cap.columns) : toMarkdown(rows, cap.columns, termName + ' 第 ' + w + ' 周');
      base = termName + '-第' + w + '周';
      if (rows.length === 0) { showToast('这一周没有课，导出的是空表', 'warn'); }
    } else if (cap.scope === 'term') {
      const rows = termRows(state.data, cap.columns);
      text = cap.format === 'csv' ? toCsv(rows, cap.columns) : toMarkdown(rows, cap.columns, termName);
      base = termName + '-整学期';
      if (rows.length === 0) { showToast('课表还是空的，导出的是空表', 'warn'); }
    } else {
      const rows = courseRows(state.data);
      text = cap.format === 'csv'
        ? toCsv(rows, cap.columns)
        : (cap.grouped ? toGroupedMarkdown(state.data) : toMarkdown(rows, cap.columns, termName + ' 课程清单'));
      base = termName + '-课程清单';
      if (rows.length === 0) { showToast('还没有课程，导出的是空表', 'warn'); }
    }

    setState({ exportSheet: false });
    const r = await saveText(
      text,
      exportFileName(base, ext),
      cap.format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8',
      '课表助手导出 · ' + cap.name
    );
    toastSave(r, '「' + cap.name + '」');
  } catch (e) {
    showToast('导出失败：' + (e as Error).message, 'error');
  }
}

/** 当前周次，导出弹层里显示用 */
export function currentWeekNumber(): number {
  return currentWeek(state.data);
}

/* ------------------------------ 本地存储体检 ------------------------------ */

export interface StorageUsage {
  key: string;
  label: string;
  bytes: number;
}

/**
 * 各存储键的占用。
 *
 * 存在的理由：localStorage 在 Chromium 里大约只有 5MB，而一张自定义壁纸
 * （data URI + 原图）就能吃掉 2-5MB。没有这个数字，用户只会看到
 * 「主题太大，存不下」却不知道该删什么。
 */
export function storageUsage(): { items: StorageUsage[]; total: number; limit: number } {
  const KEYS: [string, string][] = [
    [KEY_DATA, '课表数据'],
    [KEY_THEME, '外观与壁纸'],
    [KEY_PREFS, '偏好设置'],
    ['timetable.notiflog.v1', '提醒发送记录'],
    ['timetable.devicecheck.v1', '检查进度'],
  ];
  const items: StorageUsage[] = [];
  let total = 0;
  for (const [key, label] of KEYS) {
    let bytes = 0;
    try {
      const raw = localStorage.getItem(key);
      /* 按 UTF-16 估算：localStorage 的配额就是按字符数算的 */
      if (raw) bytes = raw.length * 2;
    } catch (e) { /* 读不到就当 0 */ }
    if (bytes > 0) { items.push({ key: key, label: label, bytes: bytes }); total += bytes; }
  }
  return { items: items, total: total, limit: 5 * 1024 * 1024 };
}
export function setSystemDark(v: boolean): void { setState({ systemDark: v }); }
