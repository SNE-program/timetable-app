import { describe, expect, it } from 'vitest';
import { cardTextWidth, fitLine, shortRoom, textWidth } from './cardFit';

/**
 * 卡片文字能不能放下。
 *
 * 这组判据来自一次真实的用户反馈：课表卡上的教室名在手机上全被截成"实…"。
 * 结论是——那么窄的地方不该放这一行，所以这里要能算出"放不放得下"。
 */
describe('文字宽度估算', function () {
  it('中日韩字符按一个字宽，英文数字按半个字宽', function () {
    expect(Math.round(textWidth('实验楼', 10))).toBe(30);
    expect(Math.round(textWidth('C101', 10))).toBe(22);
  });

  it('空串是 0 宽', function () {
    expect(textWidth('', 12)).toBe(0);
  });
});

describe('取地点里最有辨识度的一段', function () {
  it('去掉楼名前缀', function () {
    expect(shortRoom('实验楼 C101')).toBe('C101');
    expect(shortRoom('一教 A101')).toBe('A101');
  });
  it('没有空格就原样返回', function () {
    expect(shortRoom('机房302')).toBe('机房302');
  });
});

describe('一行文字放不放得下', function () {
  const shorten = shortRoom;

  it('放得下就用完整名字', function () {
    const r = fitLine('实验楼 C101', 80, 11, shorten);
    expect(r.text).toBe('实验楼 C101');
    expect(r.full).toBe(true);
  });

  it('放不下完整名字但放得下短名字 → 用短名字', function () {
    const r = fitLine('实验楼 C101', 45, 11, shorten);
    expect(r.text).toBe('C101');
    expect(r.full).toBe(false);
  });

  it('连短名字都放不下 → 不放（返回空串，而不是给一段被截断的碎片）', function () {
    const r = fitLine('实验楼 C101', 20, 11, shorten);
    expect(r.text).toBe('');
  });

  it('没有内容时不放', function () {
    expect(fitLine('', 80, 11, shorten).text).toBe('');
    expect(fitLine('   ', 80, 11, shorten).text).toBe('');
  });

  it('宽度为 0（还没量到）时不放，避免闪一下又消失', function () {
    expect(fitLine('C101', 0, 11, shorten).text).toBe('');
  });
});

describe('卡片可用宽度', function () {
  it('扣掉左右内边距', function () {
    expect(cardTextWidth(60)).toBe(50);
    expect(cardTextWidth(6)).toBe(0);
  });
});