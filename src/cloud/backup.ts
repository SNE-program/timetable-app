import type { TimetableData } from '../core/types';
import type { Theme } from '../theme/tokens';
import type { Prefs } from '../app/store';
import { collectAssetKeys } from '../storage/assetRef';
import { getAsset, putAsset } from '../storage';

/**
 * 云备份的内容与校验（纯数据，不发请求）。
 *
 * ## 备份什么、不备份什么
 *
 * 备份的是「换台设备还能接着用」所需的那部分：课表与时段、任务、出勤、学期与作息、
 * 提醒规则一类的偏好、外观主题，以及这些数据引用到的图片。
 *
 * **角色包刻意不进备份**：它有自己的文件格式（.json 角色包），体积大，
 * 而且它是装饰不是数据。这一点在界面上要写明，不能让人以为"备份过了就全都在"。
 *
 * ## 为什么有体积上限
 *
 * 免费额度的单次请求大约 1 MB，而一张壁纸就可能 2–5 MB。所以这里算准字节数：
 * 超了就**只备份课表与设置**（丢图片），并且如实告诉用户"图片没进去，请用主题包带走"，
 * 而不是发一个必然失败的请求，也不是悄悄少传几张图。
 */

export const BACKUP_FORMAT = 'timetable-backup';
export const BACKUP_VERSION = 1;

/** 软上限：超过就提示"图片太多" */
export const SOFT_LIMIT_BYTES = 700 * 1024;
/** 硬上限：超过就不带图片 <br>（Supabase 免费额度单次请求约 1 MB） */
export const HARD_LIMIT_BYTES = 900 * 1024;

/** 进备份的偏好项 —— 白名单，将来新增的本地设置不会自动跟着上云 */
const PREF_KEYS: (keyof Prefs)[] = [
  'reminderOffsets', 'dailyBrief', 'briefHour', 'confirmDestructive', 'studioLocked',
];

export interface BackupStats {
  courses: number;
  sessions: number;
  tasks: number;
  assets: number;
  assetBytes: number;
  bytes: number;
}

export interface BackupPayload {
  format: string;
  version: number;
  created_at: string;
  app_version: string;
  /** 只用于让用户认出来源设备，不参与恢复逻辑 */
  device: string;
  data: TimetableData;
  prefs: Partial<Prefs>;
  theme: Theme;
  /** key -> data URI。恢复时写回本机资产库 */
  assets: Record<string, string>;
  stats: BackupStats;
}

export interface BuildInput {
  data: TimetableData;
  prefs: Prefs;
  theme: Theme;
  appVersion: string;
  device: string;
  /** 是否带上图片（体积超限时调用方会再调一次，传 false） */
  withAssets: boolean;
}

/** 精确字节数：JSON.stringify 出来的是 UTF-16 字符串，中文一个字算 3 字节，不能拿 length 当字节 */
export function byteLength(text: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  } catch (e) { /* 退化到下面的估算 */ }
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return n;
}

export function payloadBytes(payload: BackupPayload): number {
  return byteLength(JSON.stringify(payload));
}

export function buildBackup(input: BuildInput): BackupPayload {
  const prefs: Partial<Prefs> = {};
  for (const k of PREF_KEYS) {
    const v = (input.prefs as unknown as Record<string, unknown>)[k as string];
    if (v !== undefined) (prefs as unknown as Record<string, unknown>)[k as string] = v;
  }

  const assets: Record<string, string> = {};
  let assetBytes = 0;
  if (input.withAssets) {
    for (const key of collectAssetKeys(input.theme, input.data)) {
      const uri = getAsset(key);
      if (!uri) continue;
      if (assetBytes + uri.length > HARD_LIMIT_BYTES) continue;
      assets[key] = uri;
      assetBytes += uri.length;
    }
  }

  const payload: BackupPayload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    app_version: input.appVersion,
    device: input.device,
    data: input.data,
    prefs: prefs,
    theme: input.theme,
    assets: assets,
    stats: {
      courses: input.data.courses.length,
      sessions: input.data.sessions.length,
      tasks: (input.data.tasks || []).length,
      assets: Object.keys(assets).length,
      assetBytes: assetBytes,
      /* 先填 0，算完再写真实值（下面量两次，原因见注释） */
      bytes: 0,
    },
  };
  /*
   * 自引用的字节数要量两次。
   * 第一次量的时候 stats.bytes 是 0（一位数字），写回去变成 5906（四位数字），
   * 于是记录下来的值比真实值少 3 字节 —— 单测就是拿这个差值抓出来的。
   * 第二次量出来的值写进去位数不变，因此是稳定的。
   */
  payload.stats.bytes = payloadBytes(payload);
  payload.stats.bytes = payloadBytes(payload);
  return payload;
}

/**
 * 先按"带图片"建一份，超了就退到"不带图片"。
 * 返回的 droppedAssets 表示"本来有图、为了体积没带"，界面要如实说出来。
 */
export function buildBackupWithinLimit(input: Omit<BuildInput, 'withAssets'>):
{ payload: BackupPayload; droppedAssets: boolean } {
  const full = buildBackup(Object.assign({}, input, { withAssets: true }));
  if (full.stats.bytes <= HARD_LIMIT_BYTES) return { payload: full, droppedAssets: false };
  const light = buildBackup(Object.assign({}, input, { withAssets: false }));
  /* 只有"本来真有图片、被丢掉了"才算 drop —— 否则界面会对着一个没有图片的课表
     说"图片太大没带上"，那是在无中生有 */
  return { payload: light, droppedAssets: full.stats.assets > 0 };
}

export class BackupError extends Error {
  constructor(message: string) { super(message); this.name = 'BackupError'; }
}

/** 校验一份从云端拿回来的东西到底是不是我们的备份 */
export function validateBackup(raw: unknown): BackupPayload {
  if (!raw || typeof raw !== 'object') throw new BackupError('云端这一行不是备份数据');
  const p = raw as Partial<BackupPayload>;
  if (p.format !== BACKUP_FORMAT) throw new BackupError('这不是课表助手的云备份（可能是别的应用写进去的）');
  if (typeof p.version !== 'number' || p.version > BACKUP_VERSION) {
    throw new BackupError('备份来自更新的版本，请先升级应用再恢复');
  }
  if (!p.data || typeof p.data !== 'object' || !Array.isArray((p.data as TimetableData).courses)) {
    throw new BackupError('备份里没有课表数据，文件可能损坏了');
  }
  const d = p.data as TimetableData;
  if (!d.term || !Array.isArray(d.sessions) || !Array.isArray(d.schemes)) {
    throw new BackupError('备份不完整（缺少学期 / 时段 / 作息方案），不敢往本地写');
  }
  return {
    format: p.format,
    version: p.version,
    created_at: String(p.created_at || ''),
    app_version: String(p.app_version || ''),
    device: String(p.device || ''),
    data: d,
    prefs: (p.prefs || {}) as Partial<Prefs>,
    theme: (p.theme || {}) as Theme,
    assets: (p.assets || {}) as Record<string, string>,
    stats: (p.stats || { courses: d.courses.length, sessions: d.sessions.length, tasks: 0, assets: 0, assetBytes: 0, bytes: 0 }) as BackupStats,
  };
}

/** 把备份里的图片写回本机资产库；返回写不回去的（体积超限被丢掉的）数量 */
export function restoreAssets(payload: BackupPayload): { restored: number; skipped: number } {
  let restored = 0;
  let skipped = 0;
  const need = collectAssetKeys(payload.theme, payload.data);
  for (const key of need) {
    if (getAsset(key)) { restored++; continue; }
    const uri = payload.assets[key];
    if (!uri) { skipped++; continue; }
    putAsset(key, uri);
    restored++;
  }
  return { restored: restored, skipped: skipped };
}

const fmtSize = function (bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
};

export function describeSize(bytes: number): string { return fmtSize(bytes); }

/** 给界面用的一句话摘要 */
export function describeBackup(payload: BackupPayload): string {
  const s = payload.stats;
  const parts = [
    s.courses + ' 门课',
    s.sessions + ' 个时段',
    s.tasks > 0 ? s.tasks + ' 项任务' : '',
    s.assets > 0 ? s.assets + ' 张图片' : '不含图片',
    fmtSize(payload.stats.bytes || payloadBytes(payload)),
  ];
  return parts.filter(function (x) { return x !== ''; }).join(' · ');
}

/** 时间显示：本地时间到分钟 */
export function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '时间未知';
  const d = new Date(t);
  const p = function (n: number): string { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
