import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 样式表的**类名撞车**检查。
 *
 * ## 为什么要有这条测试
 *
 * 出过一次真实事故：小组件尺寸预览用了 `.wp-grid` / `.wp-item`，
 * 而这两个类名**已经属于外观页的壁纸选择**（`repeat(4, 1fr)` 的缩略图网格）。
 * 新规则写在文件后面，于是壁纸缩略图被改成 flex 纵向排列、一个个压成长方形 ——
 * 用户看到的是「外观-背景界面炸了」，而写预览的时候完全没想到撞车。
 *
 * ## 判据（要与"正常写法"区分开，否则满屏假阳性）
 *
 *   - 只看**独立定义**：选择器就是 `.name` 或 `.name:hover`；
 *     `.app.wide .toast`、`.wk-day .dd`、`.num, .at { … }` 是"在某个上下文里用"，不算；
 *   - 同一个选择器出现两次不算问题（`components.css` 里 `.toast` 就分两段写：
 *     一段管外观、一段管布局，相隔十几行）；
 *   - **相隔很远（>200 行）或跨文件**的同一选择器才算撞车 —— 那正是上面那次事故的样子。
 */

const SIMPLE = /^\.[A-Za-z][A-Za-z0-9_-]*(\s*:\s*[a-z-]+(\([^)]*\))?)?$/;
const FAR_APART = 200;

function cssFiles(): string[] {
  const dir = join(process.cwd(), 'src', 'styles');
  return readdirSync(dir).filter(function (f) { return f.endsWith('.css'); }).map(function (f) { return join(dir, f); });
}

interface Def { file: string; line: number; sel: string }

/**
 * 顶层（不在 @media 里）的独立定义。
 *
 * 深度很关键：`@media (max-height: 700px) { .topbar { … } }` 这种是**响应式覆盖**，
 * 与"同一个类被两处定义"是两回事；不算深度的话，这条测试会报出十几条假阳性。
 */
function standaloneDefinitions(): Def[] {
  const out: Def[] = [];
  for (const file of cssFiles()) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let depth = 0;
    lines.forEach(function (line, i) {
      const open = (line.match(/\{/g) || []).length;
      const close = (line.match(/\}/g) || []).length;
      const brace = line.indexOf('{');
      if (brace >= 0 && depth === 0) {
        const sel = line.slice(0, brace).trim();
        if (SIMPLE.test(sel)) {
          out.push({ file: file.split(/[\\/]/).pop() as string, line: i + 1, sel: sel });
        }
      }
      depth += open - close;
      if (depth < 0) depth = 0;
    });
  }
  return out;
}

describe('样式类名', function () {
  it('★ 顶层同一个选择器不会在很远的地方或别的文件里被重新定义（撞车会把别的页面挤变形）', function () {
    const bySel = new Map<string, Def[]>();
    for (const d of standaloneDefinitions()) {
      const list = bySel.get(d.sel) || [];
      list.push(d);
      bySel.set(d.sel, list);
    }
    const collisions: string[] = [];
    bySel.forEach(function (list, sel) {
      if (list.length < 2) return;
      const files = Array.from(new Set(list.map(function (d) { return d.file; })));
      const sameFileClose = files.length === 1
        && Math.max.apply(null, list.map(function (d) { return d.line; }))
           - Math.min.apply(null, list.map(function (d) { return d.line; })) <= FAR_APART;
      if (sameFileClose) return;
      collisions.push(sel + ' → ' + list.map(function (d) { return d.file + ':' + d.line; }).join(' | '));
    });
    expect(collisions).toEqual([]);
  });

  it('组件预览的类名一律带 wgt- 前缀（避免与壁纸的 wp- 撞车）', function () {
    const styles = cssFiles().map(function (f) { return readFileSync(f, 'utf8'); }).join('\n');
    for (const c of ['wgt-grid', 'wgt-item', 'wgt-frame', 'wgt-card', 'wgt-row']) {
      expect(styles.indexOf('.' + c) >= 0).toBe(true);
    }
    const preview = readFileSync(join(process.cwd(), 'src', 'ui', 'WidgetPreview.tsx'), 'utf8');
    expect(preview.indexOf('"wp-item"')).toBe(-1);
    expect(preview.indexOf('"wp-grid"')).toBe(-1);
  });
});