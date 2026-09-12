import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { isNativePlatform } from '../platform/nativeBridge';

/**
 * 碎图存储（壁纸原图、课程配图）。
 *
 * ## 后端选择
 *
 * 首选 SQLite（`@capacitor-community/sqlite`，peer 依赖 `@capacitor/core >= 8.0.0`，
 * 与本项目的 Capacitor 8.5 兼容）。它解决了 localStorage 约 5 MB 的配额 ——
 * 一张自定义壁纸的成品加原图就能吃掉 2–5 MB。
 *
 * 初始化失败时**退回 localStorage**：宁可占配额，也不能让用户打开应用看到空白。
 * 退回时会在设置页如实标出来。
 *
 * ## 为什么读是同步的
 *
 * 挂载前把所有资产读进内存 Map，之后 `getAsset` 就是同步的。
 * 这样启动路径完全不用改成异步 —— 资产本来就只有几张，读进内存是几百毫秒级的事，
 * 而把整个 store 改成异步要动的面大得多，风险也大得多。
 */

const DB_NAME = 'timetable';
const DB_VERSION = 1;
const LS_KEY = 'timetable.assets.v1';

const DDL = [
  'CREATE TABLE IF NOT EXISTS assets (',
  '  key TEXT PRIMARY KEY NOT NULL,',
  '  mime TEXT,',
  '  bytes INTEGER NOT NULL DEFAULT 0,',
  '  data TEXT NOT NULL,',
  '  created_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS kv (',
  '  key TEXT PRIMARY KEY NOT NULL,',
  '  value TEXT NOT NULL,',
  '  updated_at INTEGER NOT NULL',
  ');',
].join('\n');

export type AssetBackend = 'sqlite' | 'localStorage' | 'none';

let db: SQLiteDBConnection | null = null;
let sqlite: SQLiteConnection | null = null;
let backend: AssetBackend = 'none';
let ready = false;
let lastError: string | null = null;

const cache = new Map<string, string>();

/**
 * 结构化数据（课表 / 主题 / 偏好）的缓存。
 *
 * 和资产一样，启动时一次性读进内存，之后读是同步的 —— 这样 store 的
 * 启动路径不用改成异步。写的时候先更新内存，再异步落库。
 *
 * localStorage 同时保留一份作为**快速路径镜像**：SQLite 万一初始化失败，
 * 应用仍然能立刻拿到数据。这也让"两个都写失败"才等于丢数据，
 * 比只依赖其中一个稳。
 */
const kvCache = new Map<string, string>();

/* ------------------------------ localStorage 后备 ------------------------------ */

interface LsShape { [key: string]: string }

function lsLoad(): LsShape {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o as LsShape : {};
  } catch (e) {
    return {};
  }
}

function lsSave(): void {
  const o: LsShape = {};
  cache.forEach(function (v, k) { o[k] = v; });
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch (e) {
    lastError = '本地存储写不下（配额已满）：' + (e as Error).message;
    throw e;
  }
}

/*
 * 后备（localStorage）路径上的写入合并。
 *
 * 为什么必须有这个：`lsSave` 是**整表**重写 —— 把内存里所有图片拼成一个 JSON
 * 再塞进 localStorage。而"导入一个角色"是连着 putAsset 四次（四个状态素材），
 * 于是同一份几 MB 的字符串被拼了四遍、写了四遍。网页版上这一步就是肉眼可见的卡顿，
 * 而且每次都逼近 localStorage 那约 5 MB 的配额。
 *
 * 合并之后：同一轮里的多次改动只整表重写一次。
 * 代价是"晚一个宏任务落盘"，所以两处兜底一定要留着 ——
 * 页面转入后台或即将卸载时立刻写完，否则"刚导入就切走/被杀"会丢。
 */
let lsDirty = false;
let lsTimer: ReturnType<typeof setTimeout> | null = null;
let lsHooked = false;

function flushLs(): void {
  if (lsTimer !== null) { clearTimeout(lsTimer); lsTimer = null; }
  if (!lsDirty) return;
  lsDirty = false;
  try { lsSave(); } catch (e) { /* lastError 已在 lsSave 里记下 */ }
}

function hookLsFlush(): void {
  if (lsHooked) return;
  lsHooked = true;
  try {
    window.addEventListener('pagehide', flushLs);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushLs();
    });
  } catch (e) { /* 非浏览器环境（单测）不挂，什么都不影响 */ }
}

function lsSaveSoon(): void {
  hookLsFlush();
  lsDirty = true;
  if (lsTimer !== null) return;
  lsTimer = setTimeout(flushLs, 0);
}

/* ------------------------------ 初始化 ------------------------------ */

/**
 * 在 React 挂载**之前**调用。失败不会抛 —— 它只会把后端降级，
 * 让应用照常起来，然后在设置页把实情写出来。
 */
export async function initStorage(): Promise<void> {
  if (ready) return;
  ready = true;

  if (isNativePlatform()) {
    try {
      sqlite = new SQLiteConnection(CapacitorSQLite);
      const conn = await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
      await conn.open();
      await conn.execute(DDL);
      db = conn;

      const res: any = await conn.query('SELECT key, data FROM assets;');
      const rows: any[] = (res && res.values) ? res.values : [];
      for (const r of rows) cache.set(String(r.key), String(r.data));

      const kres: any = await conn.query('SELECT key, value FROM kv;');
      const krows: any[] = (kres && kres.values) ? kres.values : [];
      for (const r of krows) kvCache.set(String(r.key), String(r.value));

      /* 上一次跑在 localStorage 后备上时留下的资产，搬进 SQLite 并清掉，把配额还回去 */
      const legacy = lsLoad();
      const legacyKeys = Object.keys(legacy);
      if (legacyKeys.length > 0) {
        for (const k of legacyKeys) {
          if (!cache.has(k)) {
            cache.set(k, legacy[k]);
            await conn.run('INSERT OR REPLACE INTO assets (key, mime, bytes, data, created_at) VALUES (?,?,?,?,?);',
              [k, guessMime(legacy[k]), legacy[k].length, legacy[k], Date.now()]);
          }
        }
        try { localStorage.removeItem(LS_KEY); } catch (e) { /* 清不掉也无所谓 */ }
      }

      backend = 'sqlite';
      lastError = null;
      return;
    } catch (e) {
      lastError = 'SQLite 初始化失败，已退回 localStorage：' + (e as Error).message;
      db = null;
      sqlite = null;
    }
  }

  /* 后备：localStorage */
  const o = lsLoad();
  for (const k of Object.keys(o)) cache.set(k, o[k]);
  backend = 'localStorage';
}

function guessMime(uri: string): string {
  const m = /^data:([^;,]+)/.exec(uri);
  return m ? m[1] : 'application/octet-stream';
}

/* ------------------------------ 结构化数据 ------------------------------ */

/** 同步读；没读到返回 null，调用方自己决定退回哪里 */
export function kvGetSync(key: string): string | null {
  const v = kvCache.get(key);
  return v === undefined ? null : v;
}

export function kvHas(key: string): boolean { return kvCache.has(key); }

/** 同步更新内存，异步落库（SQLite 优先；不可用时只更新内存，main 侧已写 localStorage） */
export function kvSet(key: string, value: string): void {
  kvCache.set(key, value);
  if (!db) return;
  void db.run('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?,?,?);', [key, value, Date.now()])
    .catch(function (e: unknown) {
      lastError = '写入 ' + key + ' 失败：' + ((e as Error).message || String(e));
    });
}

export function kvDelete(key: string): void {
  kvCache.delete(key);
  if (db) void db.run('DELETE FROM kv WHERE key = ?;', [key]).catch(function () { /* 忽略 */ });
}

export function kvKeys(): string[] {
  const out: string[] = [];
  kvCache.forEach(function (_v, k) { out.push(k); });
  return out;
}

/* ------------------------------ 读写 ------------------------------ */

export function assetBackend(): AssetBackend { return backend; }
export function assetLastError(): string | null { return lastError; }
export function hasAsset(key: string): boolean { return cache.has(key); }
export function getAsset(key: string): string | null {
  const v = cache.get(key);
  return v === undefined ? null : v;
}

/** 同步写进内存，异步落库 —— 界面不需要等磁盘 */
export function putAsset(key: string, uri: string): void {
  cache.set(key, uri);
  if (db) {
    void db.run('INSERT OR REPLACE INTO assets (key, mime, bytes, data, created_at) VALUES (?,?,?,?,?);',
      [key, guessMime(uri), uri.length, uri, Date.now()])
      .catch(function (e: unknown) {
        lastError = '写入图片失败：' + ((e as Error).message || String(e));
      });
    return;
  }
  /* 合并写入：一次导入里的几张图只会整表重写一次（见 lsSaveSoon 的说明） */
  lsSaveSoon();
}

export function deleteAsset(key: string): void {
  cache.delete(key);
  if (db) {
    void db.run('DELETE FROM assets WHERE key = ?;', [key]).catch(function () { /* 忽略 */ });
    return;
  }
  lsSaveSoon();
}

/** 清掉没有任何地方再引用的资产（换了壁纸之后旧图会留在这儿） */
export function pruneAssets(keep: string[]): number {
  let n = 0;
  const keepSet = new Set(keep);
  const all: string[] = [];
  cache.forEach(function (_v, k) { all.push(k); });
  for (const k of all) {
    if (!keepSet.has(k)) { deleteAsset(k); n++; }
  }
  return n;
}

export interface AssetUsage {
  count: number;
  bytes: number;
  backend: AssetBackend;
}

/** 资产占用：设置页要显示，也是判断"该不该清"的依据 */
export function assetUsage(): AssetUsage {
  let bytes = 0;
  cache.forEach(function (v) { bytes += v.length * 2; });
  return { count: cache.size, bytes: bytes, backend: backend };
}

export function assetKeys(): string[] {
  const out: string[] = [];
  cache.forEach(function (_v, k) { out.push(k); });
  return out;
}

/** 测试用：重置模块内部状态 */
export function __resetAssetsForTest(): void {
  db = null; sqlite = null; backend = 'none'; ready = false; lastError = null;
  cache.clear();
  kvCache.clear();
  lsDirty = false;
  if (lsTimer !== null) { clearTimeout(lsTimer); lsTimer = null; }
}
