import { describe, expect, it } from 'vitest';
import {
  decodeShareCode, decodeThemeCode, encodeShareCode, encodeThemeCode, looksLikeShareCode, looksLikeThemeCode,
} from './shareCode';
import { buildDemoData, buildEmptyData } from './demo';
import { defaultTheme, type Theme } from '../theme/tokens';

describe('分享码', function () {
  it('编出来的码带版本前缀', async function () {
    const r = await encodeShareCode(buildDemoData());
    expect(looksLikeShareCode(r.code)).toBe(true);
    expect(r.code.startsWith('KBR1.') || r.code.startsWith('KBR1U.')).toBe(true);
  });

  it('往返之后数据完全一致（含调课记录与任务）', async function () {
    const src = buildDemoData();
    const enc = await encodeShareCode(src);
    const dec = await decodeShareCode(enc.code);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.data.term.startDate).toBe(src.term.startDate);
    expect(dec.data.term.totalWeeks).toBe(src.term.totalWeeks);
    expect(dec.data.courses.length).toBe(src.courses.length);
    expect(dec.data.courses[0].name).toBe(src.courses[0].name);
    expect(dec.data.sessions.length).toBe(src.sessions.length);
    expect(dec.data.overrides.length).toBe(src.overrides.length);
    expect(dec.data.tasks.length).toBe(src.tasks.length);
  });

  it('中文课程名与教室不会乱码', async function () {
    const src = buildEmptyData();
    src.courses = [{ id: 'c1', name: '高等数学 A（实验班）', teacher: '王建国', colorIndex: 0 } as never];
    src.sessions = [{
      id: 's1', courseId: 'c1', dayOfWeek: 3, periodStart: 3, periodEnd: 4,
      weeks: { type: 'all' }, location: '实验楼 C402', building: '第三教学楼',
    } as never];
    const dec = await decodeShareCode((await encodeShareCode(src)).code);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.data.courses[0].name).toBe('高等数学 A（实验班）');
    expect(dec.data.sessions[0].location).toBe('实验楼 C402');
    expect(dec.data.sessions[0].building).toBe('第三教学楼');
  });

  it('码是 URL 安全的：不含 + / =', async function () {
    const r = await encodeShareCode(buildDemoData());
    const body = r.code.slice(r.code.indexOf('.') + 1);
    expect(body.indexOf('+')).toBe(-1);
    expect(body.indexOf('/')).toBe(-1);
    expect(body.indexOf('=')).toBe(-1);
  });

  it('空白与换行不影响解码（聊天软件常会折行）', async function () {
    const enc = await encodeShareCode(buildDemoData());
    const messy = '  ' + enc.code.slice(0, 40) + '\n' + enc.code.slice(40) + '  ';
    const dec = await decodeShareCode(messy);
    expect(dec.ok).toBe(true);
  });

  it('不是分享码的文本给出人话错误，而不是抛异常', async function () {
    const r = await decodeShareCode('随手粘贴的一段话');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('KBR1');
  });

  it('空输入不崩', async function () {
    const r = await decodeShareCode('   ');
    expect(r.ok).toBe(false);
  });

  it('码被截断时报错而不是产出一份坏课表', async function () {
    const enc = await encodeShareCode(buildDemoData());
    const broken = enc.code.slice(0, Math.floor(enc.code.length / 2));
    const r = await decodeShareCode(broken);
    expect(r.ok).toBe(false);
  });

  it('体积确实压下来了', async function () {
    const src = buildDemoData();
    const r = await encodeShareCode(src);
    const raw = JSON.stringify(src).length;
    /* 阈值刻意定得保守：演示数据里全是互不相同的字符串，压缩率本来就不如
       真实课表（真实数据里"第 N 节""教学楼"这类会大量重复）。
       实测演示数据约 43%，合成的大课表约 16%；这里只守住"至少小一半"。 */
    if (r.compressed) expect(r.chars).toBeLessThan(raw / 2);
  });
});

describe('外观分享码', function () {
  function customTheme(): Theme {
    const t = defaultTheme();
    return Object.assign({}, t, {
      accent: '#7C5CFF',
      radius: 18,
      font: 'serif' as const,
      fontScale: 1.15,
      meta: Object.assign({}, t.meta, { name: '我的配色' }),
      wallpaper: Object.assign({}, t.wallpaper, {
        kind: 'custom' as const,
        custom: 'data:image/webp;base64,' + 'A'.repeat(8000),
      }),
    });
  }

  it('往返一致：配色 / 字体 / 排版都还在', async function () {
    const enc = await encodeThemeCode(customTheme());
    const dec = await decodeThemeCode(enc.code);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.theme.accent).toBe('#7C5CFF');
    expect(dec.theme.radius).toBe(18);
    expect(dec.theme.font).toBe('serif');
    expect(dec.theme.fontScale).toBeCloseTo(1.15, 5);
    expect(dec.theme.meta.name).toBe('我的配色');
  });

  it('不带壁纸：一张 8KB 的图会变成几百万字符，塞不进粘贴框', async function () {
    const enc = await encodeThemeCode(customTheme());
    expect(enc.chars).toBeLessThan(2000);
    const dec = await decodeThemeCode(enc.code);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.theme.wallpaper.kind).toBe('none');
    expect(dec.theme.wallpaper.custom).toBe('');
  });

  it('两种码互不认识，不会串台', async function () {
    const themeCode = (await encodeThemeCode(customTheme())).code;
    const dataCode = (await encodeShareCode(buildDemoData())).code;
    expect(looksLikeThemeCode(themeCode)).toBe(true);
    expect(looksLikeShareCode(themeCode)).toBe(false);
    expect(looksLikeShareCode(dataCode)).toBe(true);
    expect(looksLikeThemeCode(dataCode)).toBe(false);
    /* 拿外观码去走课表导入必须明确失败，而不是解出个半成品 */
    expect((await decodeShareCode(themeCode)).ok).toBe(false);
    expect((await decodeThemeCode(dataCode)).ok).toBe(false);
  });

  it('粘贴时多余的空白与换行要能容忍', async function () {
    const enc = await encodeThemeCode(customTheme());
    const messy = '  ' + enc.code.slice(0, 20) + '\n' + enc.code.slice(20) + '  ';
    expect((await decodeThemeCode(messy)).ok).toBe(true);
  });

  it('乱码给出人话错误，而不是抛异常', async function () {
    const bad = await decodeThemeCode('KBT1.这不是有效的压缩数据');
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.length).toBeGreaterThan(0);
  });

  it('空码', async function () {
    expect((await decodeThemeCode('   ')).ok).toBe(false);
  });
});

