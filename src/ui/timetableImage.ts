import { dateOf, expandWeek, toISODate, toMinutes } from '../core/engine';
import type { ConcreteEvent, TimetableData } from '../core/types';
import { coursePalette, mix, readableOn, withAlpha } from '../theme/color';
import { resolveDark, type Theme } from '../theme/tokens';

export interface ImageOptions {
  week: number;
  days: number;
  theme: Theme;
  systemDark: boolean;
}

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];
const W = 1080;
const PAD = 44;
const TITLE_H = 104;
const HEAD_H = 74;

function font(size: number, weight: number, mono?: boolean): string {
  const fam = mono
    ? '"SF Mono", Menlo, Consolas, monospace'
    : '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  return weight + ' ' + size + 'px ' + fam;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** 按字符换行（中文按字断行即可），最多 maxLines 行，超出加省略号 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length === maxLines) break;
    } else {
      cur = test;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines) {
    /* 还有没放下的内容就加省略号 */
    let last = lines[maxLines - 1];
    const rest = text.slice(lines.join('').length);
    if (rest.length > 0) {
      while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
  }
  return lines;
}

export function renderTimetableImage(data: TimetableData, opts: ImageOptions): HTMLCanvasElement {
  const theme = opts.theme;
  const dark = resolveDark(theme.modePref, opts.systemDark);
  const scheme = data.schemes.find(function (s) { return s.id === data.term.periodSchemeId; }) || data.schemes[0];
  const periods = scheme.periods;
  const days = opts.days;
  const palette = (theme.courseColors && theme.courseColors.length >= 12)
    ? theme.courseColors
    : coursePalette(theme.accent, dark, theme.courseSaturation, 12);

  const rowH = periods.length > 10 ? 104 : 116;
  const gridH = periods.length * rowH;
  const H = PAD + TITLE_H + HEAD_H + gridH + PAD + 46;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const bg = dark ? theme.darkBg : theme.lightBg;
  const surface = dark ? mix(bg, '#FFFFFF', 0.07) : mix(bg, '#FFFFFF', 0.94);
  const text = dark ? mix('#FFFFFF', bg, 0.10) : mix('#14161A', bg, 0.04);
  const muted = mix(text, bg, 0.46);
  const border = dark ? mix(bg, '#FFFFFF', 0.16) : mix(bg, '#0B0D12', 0.10);
  const accent = dark ? mix(theme.accent, '#FFFFFF', 0.14) : theme.accent;
  const radius = Math.max(2, Math.min(14, theme.radius));

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  /* ---------------- 标题 ---------------- */
  const a = dateOf(data.term, opts.week, 1);
  const b = dateOf(data.term, opts.week, 7);
  ctx.fillStyle = text;
  ctx.font = font(44, 700);
  ctx.textAlign = 'left';
  ctx.fillText(data.term.name || '我的课表', PAD, PAD + 32);
  ctx.font = font(28, 500);
  ctx.fillStyle = muted;
  const range = (a.getMonth() + 1) + '月' + a.getDate() + '日 - ' + (b.getMonth() + 1) + '月' + b.getDate() + '日';
  ctx.fillText('第 ' + opts.week + ' 周 · ' + range, PAD, PAD + 76);

  ctx.textAlign = 'right';
  ctx.font = font(26, 600);
  ctx.fillStyle = accent;
  const totalClasses = expandWeek(data, opts.week).filter(function (e) { return e.dayOfWeek <= days; }).length;
  ctx.fillText('本周 ' + totalClasses + ' 节', W - PAD, PAD + 76);

  /* ---------------- 星期表头 ---------------- */
  const axisW = 92;
  const colW = (W - PAD * 2 - axisW) / days;
  const headY = PAD + TITLE_H;

  for (let i = 0; i < days; i++) {
    const x = PAD + axisW + i * colW;
    const date = dateOf(data.term, opts.week, (i + 1) as 1);
    const isToday = toISODate(date) === toISODate(new Date());
    if (isToday) {
      ctx.fillStyle = accent;
      roundRect(ctx, x + 3, headY + 4, colW - 6, HEAD_H - 12, radius + 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = isToday ? readableOn(accent) : muted;
    ctx.font = font(22, 600);
    ctx.fillText('周' + WEEKDAY_CN[i], x + colW / 2, headY + 24);
    ctx.fillStyle = isToday ? readableOn(accent) : text;
    ctx.font = font(30, 700);
    ctx.fillText(String(date.getDate()), x + colW / 2, headY + 52);
  }

  /* ---------------- 网格 ---------------- */
  const gridY = headY + HEAD_H;
  ctx.fillStyle = surface;
  ctx.fillRect(PAD, gridY, W - PAD * 2, gridH);

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  for (let i = 0; i <= periods.length; i++) {
    const y = Math.round(gridY + i * rowH) + 0.5;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  }
  for (let i = 0; i <= days; i++) {
    const x = Math.round(PAD + axisW + i * colW) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, gridY); ctx.lineTo(x, gridY + gridH); ctx.stroke();
  }

  /* 节次轴 */
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const y = gridY + i * rowH;
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;
    ctx.font = font(22, 700);
    ctx.fillText(String(p.index), PAD + axisW / 2, y + rowH / 2 - 12);
    ctx.font = font(19, 500);
    ctx.fillText(p.start, PAD + axisW / 2, y + rowH / 2 + 14);
  }

  /* ---------------- 课程块 ---------------- */
  const events = expandWeek(data, opts.week).filter(function (e) { return e.dayOfWeek <= days; });
  const byDay: Record<number, ConcreteEvent[]> = {};
  for (const e of events) (byDay[e.dayOfWeek] = byDay[e.dayOfWeek] || []).push(e);

  const gap = 6;
  for (const key in byDay) {
    const day = Number(key);
    const colX = PAD + axisW + (day - 1) * colW;
    for (const e of byDay[day]) {
      const x = colX + gap / 2 + 2;
      const y = gridY + (e.periodStart - 1) * rowH + gap / 2 + 1;
      const w = colW - gap - 4;
      const h = (e.periodEnd - e.periodStart + 1) * rowH - gap - 2;
      const c = palette[e.colorIndex % palette.length];

      /* 白底 + 左侧色条 + 淡色底纹，和界面里的「色条」样式一致 */
      ctx.fillStyle = surface;
      roundRect(ctx, x, y, w, h, radius);
      ctx.fill();
      ctx.fillStyle = withAlpha(c, dark ? 0.18 : 0.08);
      roundRect(ctx, x, y, w, h, radius);
      ctx.fill();

      ctx.fillStyle = c;
      roundRect(ctx, x, y, Math.max(5, radius), h, radius);
      ctx.fill();
      ctx.fillRect(x + radius - 2, y, Math.max(2, radius), h);

      ctx.strokeStyle = border;
      ctx.lineWidth = 1.2;
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
      ctx.stroke();

      const padL = x + Math.max(10, radius + 6);
      const innerW = w - Math.max(10, radius + 6) - 8;
      ctx.textAlign = 'left';
      ctx.fillStyle = text;
      ctx.font = font(23, 700);

      const maxLines = Math.max(1, Math.min(4, Math.floor((h - 44) / 28)));
      const nameLines = wrap(ctx, e.title, innerW, maxLines);
      let ty = y + 24;
      for (const line of nameLines) {
        ctx.fillText(line, padL, ty);
        ty += 28;
      }
      if (e.location) {
        ctx.font = font(19, 500);
        ctx.fillStyle = muted;
        const locLines = wrap(ctx, e.location, innerW, 1);
        ctx.fillText(locLines[0], padL, Math.min(y + h - 16, ty + 4));
      }
    }
  }

  /* ---------------- 页脚 ---------------- */
  ctx.textAlign = 'left';
  ctx.font = font(20, 500);
  ctx.fillStyle = muted;
  ctx.fillText('由「课表」生成 · ' + toISODate(new Date()), PAD, H - PAD / 2 - 6);

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (b) {
      if (b) resolve(b); else reject(new Error('图片生成失败'));
    }, 'image/png');
  });
}

export function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').split(',')[1];
}
