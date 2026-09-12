import { describe, expect, it } from 'vitest';
import { humanDuration } from './duration';

describe('humanDuration', function () {
  it('不到一分钟', function () {
    expect(humanDuration(0)).toBe('不到 1 分钟');
    expect(humanDuration(0.4)).toBe('不到 1 分钟');
  });

  it('一小时内按分钟', function () {
    expect(humanDuration(5)).toBe('5 分钟');
    expect(humanDuration(59)).toBe('59 分钟');
  });

  it('一天内按小时（有余数才带分钟）', function () {
    expect(humanDuration(60)).toBe('1 小时');
    expect(humanDuration(80)).toBe('1 小时 20 分');
    expect(humanDuration(1439)).toBe('23 小时 59 分');
  });

  it('超过一天按天', function () {
    expect(humanDuration(1440)).toBe('1 天');
    expect(humanDuration(1500)).toBe('1 天 1 小时');
    expect(humanDuration(2880)).toBe('2 天');
  });

  it('绝不会输出几百上千分钟的裸数字', function () {
    /* 就是这条催生了这个函数：以前「明天第一节课」会显示「4881 分钟后开始」 */
    const s = humanDuration(4881);
    expect(s).toBe('3 天 9 小时');
    expect(s.indexOf('分钟')).toBe(-1);
    expect(Number(s.slice(0, 1))).toBeLessThan(10);
  });

  it('负数按 0 处理，不会出现「-3 分钟」', function () {
    expect(humanDuration(-5)).toBe('不到 1 分钟');
  });
});
