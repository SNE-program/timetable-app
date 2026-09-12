/**
 * 检查更新（纯逻辑 + 一次取清单的请求）。
 *
 * ## 这一版能自动到什么程度
 *
 * - **网页版**：不用管。每次打开都是服务器上最新的一份。
 * - **安卓版**：能自动检查、自动下载，但**最后一下「安装」必须由用户点** ——
 *   安卓不允许普通应用静默安装自己的更新（那是应用商店 / 设备管理员的能力）。
 *   省掉的是"去浏览器下载、再翻文件管理器找安装包"这两步。
 *
 * ## 为什么不用 GitHub API 查版本
 *
 * 未登录的 API 每小时每个 IP 只有 60 次；一个班几十号人挂在同一个校园网出口上，
 * 很容易一起被限流，于是"检查更新"变成时灵时不灵。改成读自己站点上的一个静态文件：
 * 没有限额、没有第三方、失败时也好解释。
 */

export interface LatestManifest {
  version: string;
  apkUrl?: string;
  pageUrl?: string;
  publishedAt?: string;
}

export type CheckResult =
  | { kind: 'newer'; info: LatestManifest; remote: string }
  | { kind: 'current'; version: string }
  | { kind: 'error'; message: string };

/** 'v1.7.1' / '1.7.1' / '1.7' → [1,7,1]；认不出来就返回空数组 */
export function parseVersion(v: string): number[] {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v || ''));
  if (!m) return [];
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/** a 比 b 新返回 1，相同返回 0，更旧返回 -1；认不出来的版本号一律当作"不比" */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x.length || !y.length) return 0;
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return 1;
    if (x[i] < y[i]) return -1;
  }
  return 0;
}

function sanitize(raw: unknown): LatestManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const version = String(o.version || '').trim();
  if (!version || !parseVersion(version).length) return null;
  return {
    version: version,
    apkUrl: typeof o.apkUrl === 'string' ? o.apkUrl : '',
    pageUrl: typeof o.pageUrl === 'string' ? o.pageUrl : '',
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : '',
  };
}

/** 逐个候选地址取清单；都失败就返回 null（由调用方决定怎么跟用户说） */
export async function fetchManifest(urls: string[], timeoutMs = 12000): Promise<{ manifest: LatestManifest; from: string } | null> {
  for (const url of urls) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
    try {
      const res = await fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), {
        headers: { Accept: 'application/json' },
        signal: ctl ? ctl.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) continue;
      const manifest = sanitize(await res.json());
      if (manifest) return { manifest: manifest, from: url };
    } catch (e) {
      if (timer) clearTimeout(timer);
      /* 换下一个候选 */
    }
  }
  return null;
}

export async function checkForUpdate(localVersion: string, urls: string[]): Promise<CheckResult> {
  const got = await fetchManifest(urls);
  if (!got) return { kind: 'error', message: '连不上更新服务器（也可能是网络没通），稍后再试' };
  if (compareVersions(got.manifest.version, localVersion) > 0) {
    return { kind: 'newer', info: got.manifest, remote: got.from };
  }
  return { kind: 'current', version: localVersion };
}

/** 界面用的一句话 */
export function updateSummary(result: CheckResult | null): string {
  if (!result) return '';
  if (result.kind === 'current') return '已是最新版本（' + result.version + '）';
  if (result.kind === 'error') return result.message;
  return '发现新版本 ' + result.info.version;
}
