import { CloudError, cloudRequest } from './client';
import { getAsset } from '../storage';
import { assetKey, isAssetRef } from '../storage/assetRef';
import {
  collectMascotKeys, hydrateMascot, mascotFileText, parseMascotFileText, validateMascotPack,
  type ValidateMascotResult,
} from '../mascot/pack';
import { MASCOT_STATES, type MascotPack } from '../mascot/types';

/**
 * 云端角色。
 *
 * ## 为什么不放在数据库行里
 *
 * 角色包是「素材 + 描述」的一坨 JSON，一张图就能上 MB，而 PostgREST 的单次请求
 * 约 1 MB —— 塞进行里必然失败（课表备份那边已经因为这个丢过图片）。所以：
 *
 *   元信息（名字、是否公开、大小）→ public.mascots 表
 *   角色包本身                    → Storage 的 mascots 桶（私有桶，路径第一段是 user_id）
 *
 * ## 配额
 *
 * 每人 2 个，额度不设限的账号除外。**判定在数据库的触发器里**，
 * 客户端这里只做"提前告诉你会超"，不是安全边界 ——
 * 客户端的限制永远是提示，服务端的才算数。
 */

export const MASCOTS_BUCKET = 'mascots';

/**
 * 单个角色包的上限：8 MB。
 *
 * 为什么不是"不限"：素材是 base64 塞在 JSON 里的（比原图大 1/3），
 * 8 MB 的包已经相当于 6 MB 图片 —— 一个手做的角色通常几十到几百 KB，做视频抽帧的也就 1–3 MB。
 * 而 Storage 的额度是整个项目**共用**的（免费版 1 GB 存储、每月 5 GB 流量）：
 * 放开单个文件的大小，等于允许一个人把共用额度占满，之后**所有人**都传不上来。
 * 所以这里按"够用 + 不伤人"取 8 MB；Storage 那个桶也设了同样的限制，两边一致。
 */
export const MAX_MASCOT_BYTES = 8 * 1024 * 1024;

export interface CloudMascot {
  id: string;
  user_id: string;
  name: string;
  is_public: boolean;
  path: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  /** 分享码：有值表示"拿到码的人可以用它"；为空表示未分享 */
  share_code?: string | null;
}

/**
 * 分享码：6–12 位大写字母与数字，**去掉了容易看错的 0 / O / 1 / I / L**。
 *
 * 为什么是分享码而不是"公开"：公开等于把角色挂到一个谁都能翻的广场上，
 * 而实际需求几乎都是"发给某个同学"。码只有拿到的人能用，也没法枚举 ——
 * 数据库那边只开了一个"凭精确的码换一条记录"的函数（见 schema-mascot-share.sql）。
 */
const SHARE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newShareCode(rng?: () => number): string {
  const r = rng || Math.random;
  let out = '';
  for (let i = 0; i < 8; i++) {
    const idx = Math.min(SHARE_ALPHABET.length - 1, Math.floor(Math.max(0, Math.min(0.999999, r())) * SHARE_ALPHABET.length));
    out += SHARE_ALPHABET[idx];
  }
  return out;
}

/** 用户输入清洗：大写、去空格与容易混淆的分隔符 */
export function normalizeShareCode(raw: string): string {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

/** 码看起来对不对（客户端只做提示，真正的判定是"能不能查到"） */
export function looksLikeShareCode(code: string): boolean {
  return /^[A-Z0-9]{6,12}$/.test(normalizeShareCode(code));
}

export interface MascotQuota {
  used: number;
  unlimited: boolean;
  limit: number;
}

export function isMine(m: CloudMascot, userId: string | null): boolean {
  return !!userId && m.user_id === userId;
}

/** 本地这份角色包能不能上传：能的话返回正文与大小 */
export function prepareMascotUpload(pack: MascotPack): { text: string; bytes: number; missingAssets: boolean } {
  /*
   * 先看素材齐不齐，再还原成自包含的包。
   *
   * 顺序很重要：hydrateMascot 会把**找不到的引用降级成空串**（渲染路径需要这个行为，
   * 否则页面上会去请求一个坏 URL），但上传时"悄悄变成空图"是最坏的结果 ——
   * 本机看起来正常、别人下载到的是空白角色。所以这里在还原之前先数一遍 key。
   */
  const keys = collectMascotKeys(pack);
  let missing = false;
  for (const k of keys) { if (!getAsset(k)) { missing = true; break; } }
  const hydrated = hydrateMascot(pack, function (key) { return getAsset(key); });
  const out = mascotFileText(hydrated);
  return { text: out.text, bytes: out.bytes, missingAssets: missing || out.hasRefs };
}

/**
 * 估算这个角色包上传后有多大 —— **不序列化，只做加法**。
 *
 * 为什么不用 `prepareMascotUpload` 去量：那一步会把整包还原成自包含 JSON
 * 再转成一个大字符串，几 MB 的活儿；而它以前是**打开云端面板时同步跑的** ——
 * 面板一打开就顿一下，正是"加载云端角色很卡"的一部分。
 *
 * 口径要和真值对齐：`mascotFileText` 报的 bytes 其实是**字符数**（正文以 base64 为主，
 * 全是 ASCII，字符数与字节数几乎相等），这里就照同一个口径累加，
 * 于是"面板上显示的体积"和"上传时判定的体积"是同一个数。
 *
 * 真正的上限判定仍在 `uploadMascot` 里用精确值做 —— 这里只负责"提前告诉你大概多大"。
 */
export function estimateMascotBytes(pack: MascotPack): { bytes: number; missingAssets: boolean } {
  let bytes = 0;
  let missing = false;
  for (const key of MASCOT_STATES) {
    const a = pack.states[key];
    if (!a || !a.src) continue;
    if (isAssetRef(a.src)) {
      const uri = getAsset(assetKey(a.src));
      if (uri === null) { missing = true; continue; }
      bytes += uri.length;
    } else if (a.src.indexOf('data:') === 0) {
      bytes += a.src.length;
    }
  }
  /* JSON 外壳（格式头、字段名、缩进）固定几十到几百字节，按 512 算足够准 */
  return { bytes: bytes + 512, missingAssets: missing };
}

export async function listMascots(token: string | null): Promise<CloudMascot[]> {
  /*
   * share_code 这一列**只在登录后请求**。
   *
   * 服务端已经收回了 anon 对这一列的读权限（见 supabase/schema-mascot-share-lock.sql）：
   * 分享码是凭据，不能被"没登录的人列出所有公开角色"顺手捎走 ——
   * 未登录的人本来也不需要看别人的码，他是来**用**码的。
   */
  const cols = 'id,user_id,name,is_public,path,size_bytes,created_at,updated_at' + (token ? ',share_code' : '');
  const q = '/rest/v1/mascots?select=' + cols + '&order=created_at.desc&limit=60';
  const json = await cloudRequest('GET', q, token ? { token: token } : {});
  return Array.isArray(json) ? (json as CloudMascot[]) : [];
}

/**
 * 配额：有没有"不限量"、已经用了几个。
 *
 * 两条查询**并行发**（以前是一条等一条，白白多一个来回）——
 * 这个函数是"打开云端面板"这条路上的一环，一个来回就是几百毫秒。
 */
export async function myQuota(token: string): Promise<MascotQuota> {
  const both = await Promise.all([
    cloudRequest('GET', '/rest/v1/profiles?select=unlimited_mascots&limit=1', { token: token }),
    cloudRequest('GET', '/rest/v1/mascots?select=id&limit=100', { token: token }),
  ]);
  const rows = Array.isArray(both[0]) ? (both[0] as { unlimited_mascots?: boolean }[]) : [];
  const unlimited = !!(rows[0] && rows[0].unlimited_mascots);
  const used = Array.isArray(both[1]) ? both[1].length : 0;
  return { used: used, unlimited: unlimited, limit: 2 };
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* 退化到下面的拼法 */ }
  return 'm' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
}

/**
 * 上传一个角色。
 *
 * 顺序是"先传文件、再写元信息"，中途失败要把文件删掉 ——
 * 否则配额算在元信息上、空间却真的占着，用户删了角色也拿不回空间（孤儿对象）。
 */
export async function uploadMascot(
  token: string, userId: string, pack: MascotPack, name: string, isPublic: boolean
): Promise<CloudMascot> {
  const prepared = prepareMascotUpload(pack);
  if (prepared.missingAssets) {
    throw new CloudError('这个角色的素材在本机缺了一部分（多半是上次导入没存全），先重新导入一次再传', 0, 'missing_assets');
  }
  if (prepared.bytes > MAX_MASCOT_BYTES) {
    throw new CloudError(
      '这个角色包 ' + formatMb(prepared.bytes) + '，超过 ' + formatMb(MAX_MASCOT_BYTES) + ' 上限。'
      + '把素材压小一点再传：图片长边压到 1024 以内、视频抽帧别超过 24 帧，通常能降到 1 MB 以下',
      0, 'too_large'
    );
  }
  const id = newId();
  const path = userId + '/' + id + '.json';
  await cloudRequest('POST', '/storage/v1/object/' + MASCOTS_BUCKET + '/' + encodeURIComponent(path).replace(/%2F/g, '/'), {
    token: token,
    rawBody: prepared.text,
    contentType: 'application/json',
    headers: { 'x-upsert': 'false' },
    /* 8 MB 在手机流量上传可能要一分多钟，超时要给足 */
    timeoutMs: 180000,
  });
  try {
    const json = await cloudRequest('POST', '/rest/v1/mascots', {
      token: token,
      prefer: 'return=representation',
      body: [{ id: id, user_id: userId, name: name.slice(0, 40), is_public: isPublic, path: path, size_bytes: prepared.bytes }],
      timeoutMs: 30000,
    });
    const rows = Array.isArray(json) ? (json as CloudMascot[]) : [];
    if (!rows.length) throw new CloudError('服务器没有确认这次上传', 0, 'bad_response');
    return rows[0];
  } catch (e) {
    /* 元信息没写进去，把刚传的文件删掉，别留孤儿 */
    try {
      await cloudRequest('DELETE', '/storage/v1/object/' + MASCOTS_BUCKET + '/' + encodeURIComponent(path).replace(/%2F/g, '/'), { token: token });
    } catch (e2) { /* 删不掉也不该盖住原始错误 */ }
    throw e;
  }
}

/**
 * 取回一个角色包（自己的或公开的都能取；权限由 Storage 的策略判定）。
 *
 * 注意这里**不再把响应序列化一遍**：客户端已经把正文解析成对象了，
 * 以前无论哪种情况都走 "JSON.stringify → 再 JSON.parse" ——
 * 一个 8 MB 的包白转两趟（还有一份几十 MB 的中间字符串），
 * 手机上一眼就能看出那两下卡顿。对象就直接校验，只有真回了一段文本才解析。
 */
export async function fetchMascot(token: string | null, path: string): Promise<ValidateMascotResult> {
  const json = await cloudRequest('GET', '/storage/v1/object/' + MASCOTS_BUCKET + '/' + encodeURIComponent(path).replace(/%2F/g, '/'), {
    token: token || undefined,
    timeoutMs: 180000,
  });
  if (typeof json === 'string') return parseMascotFileText(json);
  return validateMascotPack(json);
}

/**
 * 是不是"码撞了"。
 *
 * 判断要看两处：错误码（客户端会把 PostgREST 的 code 带进 CloudError.code）与原文 ——
 * 只认一种写法的话，换个网络层实现就又变成"分享失败"了。
 */
function isDuplicateKey(e: unknown): boolean {
  const code = e instanceof CloudError ? e.code : '';
  const msg = e instanceof Error ? e.message : String(e);
  return code === '23505' || msg.indexOf('23505') >= 0 || /duplicate key/i.test(msg);
}

/**
 * 打开 / 关闭一个角色的分享码。
 *
 * 打开时生成一个新的随机码；**撞码**（数据库那边是唯一索引）会重试几次 ——
 * 8 位 × 31 个字母数字，撞的概率极低，但"极低"不等于"不会"，而失败一次
 * 用户看到的就是"分享失败"，不如自己重试。
 */
export async function setMascotShare(
  token: string, id: string, on: boolean, rng?: () => number
): Promise<string | null> {
  if (!on) {
    await cloudRequest('PATCH', '/rest/v1/mascots?id=eq.' + encodeURIComponent(id), {
      token: token, prefer: 'return=minimal', body: { share_code: null },
    });
    return null;
  }
  let lastErr: unknown = null;
  for (let i = 0; i < 4; i++) {
    const code = newShareCode(rng);
    try {
      await cloudRequest('PATCH', '/rest/v1/mascots?id=eq.' + encodeURIComponent(id), {
        token: token, prefer: 'return=minimal', body: { share_code: code },
      });
      return code;
    } catch (e) {
      lastErr = e;
      /* 23505 = 唯一约束冲突：换一个码再来；其它错误直接抛 */
      if (!isDuplicateKey(e)) throw e;
    }
  }
  throw new CloudError('分享码生成失败，稍后再试一次', 0, 'code_conflict');
}

/**
 * 凭分享码换一条记录（数据库里的 SECURITY DEFINER 函数）。
 *
 * 只有**精确匹配**才有结果：不知道码就查不出任何东西，也没法把"所有分享过的角色"列出来。
 * 未登录也能用 —— 拿到码的人未必有账号。
 */
export async function resolveShare(token: string | null, code: string): Promise<CloudMascot | null> {
  const clean = normalizeShareCode(code);
  if (!looksLikeShareCode(clean)) return null;
  const json = await cloudRequest('POST', '/rest/v1/rpc/resolve_mascot_share', {
    token: token || undefined,
    body: { code: clean },
    timeoutMs: 20000,
  });
  const rows = Array.isArray(json) ? (json as CloudMascot[]) : [];
  return rows.length ? rows[0] : null;
}

export async function setMascotPublic(token: string, id: string, isPublic: boolean): Promise<void> {
  await cloudRequest('PATCH', '/rest/v1/mascots?id=eq.' + encodeURIComponent(id), {
    token: token,
    prefer: 'return=minimal',
    body: { is_public: isPublic },
  });
}

export async function deleteMascot(token: string, m: CloudMascot): Promise<void> {
  await cloudRequest('DELETE', '/rest/v1/mascots?id=eq.' + encodeURIComponent(m.id), { token: token, prefer: 'return=minimal' });
  try {
    await cloudRequest('DELETE', '/storage/v1/object/' + MASCOTS_BUCKET + '/' + encodeURIComponent(m.path).replace(/%2F/g, '/'), { token: token });
  } catch (e) { /* 对象没删掉不影响"这个角色已经不在列表里" */ }
}

/** 把字节数说成 MB（界面直接用） */
export function formatMb(bytes: number): string {
  return (Math.round(bytes / 1024 / 1024 * 10) / 10) + ' MB';
}

/** 配额提示文案（界面直接用） */
export function quotaLine(q: MascotQuota | null): string {
  if (!q) return '';
  if (q.unlimited) return '这个账号不限制云端角色数量（已存 ' + q.used + ' 个）';
  return '云端角色 ' + q.used + ' / ' + q.limit + '（每个账号最多 ' + q.limit + ' 个）';
}
