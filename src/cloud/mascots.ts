import { CloudError, cloudRequest } from './client';
import { getAsset } from '../storage';
import { collectMascotKeys, hydrateMascot, mascotFileText, parseMascotFileText, type ValidateMascotResult } from '../mascot/pack';
import type { MascotPack } from '../mascot/types';

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

export async function listMascots(token: string | null): Promise<CloudMascot[]> {
  const q = '/rest/v1/mascots?select=id,user_id,name,is_public,path,size_bytes,created_at,updated_at&order=created_at.desc&limit=60';
  const json = await cloudRequest('GET', q, token ? { token: token } : {});
  return Array.isArray(json) ? (json as CloudMascot[]) : [];
}

export async function myQuota(token: string): Promise<MascotQuota> {
  const json = await cloudRequest('GET', '/rest/v1/profiles?select=unlimited_mascots&limit=1', { token: token });
  const rows = Array.isArray(json) ? (json as { unlimited_mascots?: boolean }[]) : [];
  const unlimited = !!(rows[0] && rows[0].unlimited_mascots);
  const mine = await cloudRequest('GET', '/rest/v1/mascots?select=id&limit=100', { token: token });
  const used = Array.isArray(mine) ? mine.length : 0;
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

/** 取回一个角色包（自己的或公开的都能取；权限由 Storage 的策略判定） */
export async function fetchMascot(token: string | null, path: string): Promise<ValidateMascotResult> {
  const json = await cloudRequest('GET', '/storage/v1/object/' + MASCOTS_BUCKET + '/' + encodeURIComponent(path).replace(/%2F/g, '/'), {
    token: token || undefined,
    timeoutMs: 180000,
  });
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return parseMascotFileText(text);
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
