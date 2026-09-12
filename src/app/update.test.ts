import { describe, expect, it, vi, beforeEach } from 'vitest';
import { checkForUpdate, compareVersions, fetchManifest, parseVersion, updateSummary } from './update';

/**
 * 检查更新：一个真实请求都不发（fetch 被换掉）。
 *
 * 这一类代码最容易出的问题不是"逻辑难"，而是**版本号比较**：
 * 拿字符串比会得出 v1.10.0 < v1.9.0 这种结论，于是新版本永远推不出来；
 * 而用户看到的只是"检查更新没反应"，根本不会想到是版本号比错了。
 */

interface Call { url: string }
function stub(handler: (url: string) => { status?: number; json?: unknown; throw?: boolean }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async function (url: string) {
    calls.push({ url: String(url) });
    const r = handler(String(url));
    if (r.throw) throw new Error('Failed to fetch');
    const status = r.status === undefined ? 200 : r.status;
    return { ok: status >= 200 && status < 300, status: status, json: async function () { return r.json; } } as unknown as Response;
  });
  return calls;
}

beforeEach(function () { vi.unstubAllGlobals(); });

describe('版本号', function () {
  it('解析出三段数字，v 前缀与缺段都能认', function () {
    expect(parseVersion('1.7.1')).toEqual([1, 7, 1]);
    expect(parseVersion('v1.8.0')).toEqual([1, 8, 0]);
    expect(parseVersion('2.0')).toEqual([2, 0, 0]);
    expect(parseVersion('')).toEqual([]);
    expect(parseVersion('nonsense')).toEqual([]);
  });

  it('按数字比，不是按字符串 —— 1.10 要比 1.9 新', function () {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.7.1', '1.7.1')).toBe(0);
    expect(compareVersions('v1.8.0', '1.7.9')).toBe(1);
    /* 认不出来的当"不比"，免得误报有新版本 */
    expect(compareVersions('', '1.7.1')).toBe(0);
    expect(compareVersions('1.7.1', 'x')).toBe(0);
  });
});

describe('取清单', function () {
  it('从第一个能用的地址拿，并做字段清洗', async function () {
    const calls = stub(function (url) {
      if (url.indexOf('a.example') >= 0) return { status: 500, json: {} };
      return { json: { version: 'v1.9.0', apkUrl: 'https://x/y.apk', pageUrl: 'https://x/p', publishedAt: '2026-09-12T00:00:00Z', extra: 1 } };
    });
    const got = await fetchManifest(['https://a.example/latest.json', 'https://b.example/latest.json']);
    expect(calls.length).toBe(2);
    expect(got).not.toBe(null);
    expect(got!.manifest.version).toBe('v1.9.0');
    expect(got!.manifest.apkUrl).toBe('https://x/y.apk');
    expect(got!.from).toContain('b.example');
    /* 带时间戳参数绕开缓存 */
    expect(calls[1].url).toContain('t=');
  });

  it('清单不是合法 JSON 或缺版本号时当作没有', async function () {
    stub(function () { return { json: { hello: 1 } }; });
    expect(await fetchManifest(['https://a/latest.json'])).toBe(null);
    stub(function () { return { json: null }; });
    expect(await fetchManifest(['https://a/latest.json'])).toBe(null);
  });

  it('全都连不上时返回 null，不抛异常', async function () {
    stub(function () { return { throw: true }; });
    expect(await fetchManifest(['https://a/latest.json', 'https://b/latest.json'])).toBe(null);
  });
});

describe('检查更新的结论', function () {
  it('远端更新 → newer，并带上清单', async function () {
    stub(function () { return { json: { version: '1.8.0', apkUrl: 'https://x/app.apk' } }; });
    const r = await checkForUpdate('1.7.1', ['https://a/latest.json']);
    expect(r.kind).toBe('newer');
    expect(r.kind === 'newer' ? r.info.version : '').toBe('1.8.0');
    expect(updateSummary(r)).toContain('1.8.0');
  });

  it('一样或更低 → current（不能因为远端是旧的就提示更新）', async function () {
    stub(function () { return { json: { version: '1.7.1' } }; });
    expect((await checkForUpdate('1.7.1', ['https://a/latest.json'])).kind).toBe('current');
    stub(function () { return { json: { version: '1.0.0' } }; });
    expect((await checkForUpdate('1.7.1', ['https://a/latest.json'])).kind).toBe('current');
  });

  it('拿不到清单 → error，并给人话', async function () {
    stub(function () { return { throw: true }; });
    const r = await checkForUpdate('1.7.1', ['https://a/latest.json']);
    expect(r.kind).toBe('error');
    expect(updateSummary(r)).toContain('连不上');
  });
});
