import { describe, expect, it } from 'vitest';
import { shouldKeepOriginal } from './image';

/**
 * "原样保留"这条路的判据。
 *
 * 它守的是两件事：**动图不能被压成静态图**（canvas 只画得出第一帧），
 * 以及**不能让一张巨图直接进内存**。两条都是用户能直接看到后果的事，
 * 所以判据抽成纯函数钉在这里。
 */
describe('角色图要不要原样保留', function () {
  it('小图小文件：原样保留（不二次有损压缩）', function () {
    expect(shouldKeepOriginal({ bytes: 200 * 1024, w: 800, h: 900, animated: false })).toBe(true);
  });

  it('体积超线就重新压', function () {
    expect(shouldKeepOriginal({ bytes: 5 * 1024 * 1024, w: 800, h: 900, animated: false })).toBe(false);
  });

  it('像素太多就重新压（解码后要吃内存）', function () {
    expect(shouldKeepOriginal({ bytes: 1024 * 1024, w: 4000, h: 4000, animated: false })).toBe(false);
  });

  it('动图更保守：帧多，解码缓存更大', function () {
    const big = { bytes: 1024 * 1024, w: 1400, h: 1400, animated: true };
    expect(shouldKeepOriginal(big)).toBe(false);
    /* 同样尺寸的静态图是放行的 —— 差别就在这里 */
    expect(shouldKeepOriginal(Object.assign({}, big, { animated: false }))).toBe(true);
  });

  it('常见角色动图放行', function () {
    expect(shouldKeepOriginal({ bytes: 900 * 1024, w: 480, h: 640, animated: true })).toBe(true);
  });

  it('读不到体积或尺寸时不放行（宁可压一遍，也不要一张来路不明的巨图）', function () {
    expect(shouldKeepOriginal({ bytes: 0, w: 800, h: 900, animated: false })).toBe(false);
    expect(shouldKeepOriginal({ bytes: 1024, w: 0, h: 0, animated: false })).toBe(false);
  });

  it('阈值可以调（界面/测试用得上）', function () {
    expect(shouldKeepOriginal({ bytes: 2 * 1024 * 1024, w: 100, h: 100, animated: false }, { keepBytes: 1024 * 1024 })).toBe(false);
  });
});
