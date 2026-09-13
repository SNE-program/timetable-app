import React from 'react';
import { applySheetImport, closeSheets, showToast, useApp } from '../app/store';
import { readSheetBytes, type SheetTable } from '../core/sheetImport';
import {
  FIELD_LABEL, FIELD_ORDER, FIELD_REQUIRED, detectMatrix, emptyMap, guessColumns, parseMatrix, parseSheet,
  type ColumnMap, type FieldKey, type MatrixGuess, type ParseOutcome,
} from '../core/courseImport';
import { describeWeeks } from '../core/engine';
import { activeImports } from '../plugins/host';
import { Panel, Picker, Segmented, Sheet } from './common';

/**
 * 从 Excel / CSV 导入课表。
 *
 * 三步：选文件 → 对列 → 看预览再确认。
 *
 * 为什么中间一定要有"对列"和"预览"两步：
 * 教务系统导出的表长得千奇百怪 —— 表头在第 3 行、节次写成"第1-2节"、
 * 周次写成"1-16周(单)"、教室在课程名里。自动识别能覆盖大多数情况，
 * 但**只要有一列猜错，整张课表就全错**，而课表错了很难手工修回来。
 * 所以宁可让用户多点两下：解析结果先摆出来，看清了再入库。
 *
 * 入库走 store 的 setData，天然带一步撤销；提示条上会给「撤销」。
 */

type Step = 'pick' | 'map' | 'preview';
type Mode = 'long' | 'matrix';

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

function cellText(v: string): string {
  return v && v.length ? v : '—';
}


/* ------------------------------ 检查样例 ------------------------------ */

/**
 * `?sample=1..4` 用的内置样例表（1/3 矩阵，2/4 长表；3/4 直接跳到预览步）。
 *
 * 无头浏览器里点不了"选择文件"，没有这两张表就**没法验证第 2、3 步渲染**
 * （而"构建通过 ≠ 运行正常"这个坑我们踩过）。生产路径完全不受影响：
 * 不传参数时这段代码不执行。
 */
const SAMPLE_MATRIX: SheetTable = {
  name: '课表矩阵',
  rows: [
    ['节次', '星期一', '星期二', '星期三', '星期四', '星期五'],
    ['第1-2节', '高等数学\n张三\n1-16周\nA301', '', '大学英语\n李四\n1-16周(单)\nB202', '', ''],
    ['第3-4节', '', '大学物理\n王五\n1-8周\nC401', '', '线性代数\n孙七\n3-14周\nD105', ''],
    ['第5-6节', '体育\n赵六\n每周\n操场', '', '', '', '形势与政策\n周八\n1-8周\nE201'],
  ],
};

const SAMPLE_LONG: SheetTable = {
  name: '长表',
  rows: [
    ['2026 春季学期 学生课表', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['课程名称', '任课教师', '星期', '节次', '上课周次', '上课地点'],
    ['高等数学（上）', '张三', '周一', '第1-2节', '1-16周', 'A301'],
    ['大学英语', '李四', '周三', '第3-4节', '1-16周(双)', 'B202'],
    ['大学物理', '王五', '周二', '第3-4节', '1-8周', 'C401'],
    ['待定课程', '赵六', '下周', '第5-6节', '1-8周', 'D105'],
  ],
};

export default function ImportSheet() {
  useApp();   /* 订阅一次，切换学期后描述文案跟着更新 */

  const [step, setStep] = React.useState<Step>('pick');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [encoding, setEncoding] = React.useState('');
  const [tables, setTables] = React.useState<SheetTable[]>([]);
  const [tableIdx, setTableIdx] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>('long');
  const [headerRow, setHeaderRow] = React.useState(-1);
  const [map, setMap] = React.useState<ColumnMap>(emptyMap);
  const [matrix, setMatrix] = React.useState<MatrixGuess | null>(null);
  const [importMode, setImportMode] = React.useState<'merge' | 'replace'>('merge');
  const [presetId, setPresetId] = React.useState('');
  /** 预设认出了几个字段（''= 没选预设） */
  const [presetHits, setPresetHits] = React.useState(-1);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const presets = React.useMemo(function () { return activeImports(); }, []);

  const table = tables[tableIdx];
  const rows = table ? table.rows : [];

  /* 检查入口：见文件末尾 SAMPLE_* 的说明 */
  React.useEffect(function () {
    let q = '';
    try { q = new URLSearchParams(window.location.search).get('sample') || ''; } catch (e) { q = ''; }
    const matrix = q === '1' || q === '3';
    if (q !== '1' && q !== '2' && q !== '3' && q !== '4') return;
    const t = matrix ? SAMPLE_MATRIX : SAMPLE_LONG;
    setFileName(matrix ? '示例-课表矩阵.xlsx' : '示例-长表.csv');
    setEncoding('内置样例');
    setTables([t]);
    adoptTable([t], 0);
    setStep(q === '3' || q === '4' ? 'preview' : 'map');
  }, []);

  /* 换表/换方式/换表头都要重算，所以这里用一个纯函数而不是散在各处 setState */
  const parsed: ParseOutcome = React.useMemo(function () {
    if (step === 'pick' || rows.length === 0) return { sessions: [], issues: [], courseNames: [] };
    if (mode === 'matrix') {
      return matrix ? parseMatrix(rows, matrix) : { sessions: [], issues: [], courseNames: [] };
    }
    return parseSheet(rows, headerRow, map);
  }, [step, mode, rows, headerRow, map, matrix]);

  /**
   * 按当前选中的**插件预设**重新认一次列。
   *
   * 预设只提供"这份文件里表头怎么写"（同义词）与表头在第几行 ——
   * 解析、预览、入库仍然是宿主那一条路，插件不碰数据。
   */
  function applyPreset(presetId: string, list?: SheetTable[], idx?: number): void {
    const tables2 = list || tables;
    const i = idx === undefined ? tableIdx : idx;
    const t = tables2[i];
    if (!t) return;
    const preset = presetId ? activeImports().filter(function (x) { return x.pluginId + ':' + x.capability.id === presetId; })[0] : null;
    setPresetId(presetId);
    const cap = preset ? preset.capability : null;
    const g = guessColumns(t.rows, cap ? cap.headers : undefined, cap ? cap.headerRow : undefined);
    setHeaderRow(g.headerRow);
    setMap(g.map);
    const m = cap && cap.mode === 'matrix' ? (detectMatrix(t.rows) || null) : detectMatrix(t.rows);
    setMatrix(m);
    setMode(cap ? (cap.mode || (g.hits >= 2 ? 'long' : 'matrix')) : (g.hits >= 2 ? 'long' : (m ? 'matrix' : 'long')));
    /* 命中几个字段要当场告诉用户：预设不对时他会立刻看到"只认出了 1 列" */
    setPresetHits(g.hits);
  }

  function adoptTable(list: SheetTable[], idx: number): void {
    applyPreset('', list, idx);
  }

  async function pick(file: File): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const r = await readSheetBytes(buf, file.name);
      const usable = r.tables.filter(function (t) { return t.rows.length > 0; });
      if (usable.length === 0) {
        setError('这个文件里没有读到任何内容。如果是空表，先在 Excel 里确认一下有没有数据行。');
        return;
      }
      setFileName(file.name);
      setEncoding(r.encoding);
      setTables(usable);
      adoptTable(usable, 0);
      setStep('map');
    } catch (e) {
      setError((e as Error).message || '读不了这个文件');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(m: Mode): void {
    setMode(m);
    if (m === 'matrix' && !matrix && rows.length) setMatrix(detectMatrix(rows));
  }

  function switchTable(idx: number): void {
    adoptTable(tables, idx);
  }

  /* ------------------------------ 选文件 ------------------------------ */

  if (step === 'pick') {
    return (
      <Sheet title="从表格导入" onClose={closeSheets} className="sheet-full">
        <div className="panel-desc" style={{ padding: '0 0 12px' }}>
          支持教务系统导出的 <b>.xlsx</b> 与 <b>.csv / .txt</b>。文件只在手机本地解析，
          不会上传到任何地方，也不需要联网。
        </div>

        <button className="btn primary block" disabled={busy} onClick={function () { if (fileRef.current) fileRef.current.click(); }}>
          {busy ? '正在读取…' : '选择表格文件'}
        </button>
        <input
          ref={fileRef} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f) void pick(f);
          }}
        />

        {error ? <div className="warn-bar" style={{ marginTop: 12 }}><div className="warn-badge">!</div><div className="warn-item">{error}</div></div> : null}

        <Panel title="两种常见格式" desc="导入时两种都能自动识别，也可以手动切换。">
          <div className="list-row">
            <div>
              <div className="lr-label">一行一个时段</div>
              <div className="lr-sub">每行写着一门课的一次上课：课程名 / 教师 / 星期 / 节次 / 周次 / 教室。需要你对一次列。</div>
            </div>
          </div>
          <div className="list-row">
            <div>
              <div className="lr-label">课表矩阵</div>
              <div className="lr-sub">行是节次、列是星期，格子里是「课程名 教师 周次 教室」。多数教务系统的课表页导出来就是这个。</div>
            </div>
          </div>
        </Panel>

        <div className="doc-note">
          如果只有旧版 <b>.xls</b>：用 Excel 或 WPS 打开，另存为 .xlsx 或 CSV 再导入。
          那个格式是完全不同的二进制结构，读不了，这里不会假装能读。
        </div>
      </Sheet>
    );
  }

  /* ------------------------------ 对列 ------------------------------ */

  const headerOptions = rows.slice(0, 10).map(function (r, i) {
    const text = r.filter(function (c) { return c; }).join(' | ');
    return { value: i, label: '第 ' + (i + 1) + ' 行', sub: text.length > 22 ? text.slice(0, 22) + '…' : text };
  });

  function columnOptions(field: FieldKey) {
    const opts = [{ value: -1, label: FIELD_REQUIRED[field] ? '请选择' : '不使用', sub: '' }];
    (rows[headerRow] || []).forEach(function (h, i) {
      opts.push({ value: i, label: '第 ' + (i + 1) + ' 列', sub: h || '（空表头）' });
    });
    return opts;
  }

  if (step === 'map') {
    const missing = FIELD_ORDER.filter(function (f) { return FIELD_REQUIRED[f] && map[f] < 0; });

    return (
      <Sheet title="对应哪一列" onClose={closeSheets} className="sheet-full" right={<span className="panel-sub">{fileName}</span>}>
        <div className="panel-desc" style={{ padding: '0 0 10px' }}>
          读到 {rows.length} 行 · 编码 {encoding}
          {tables.length > 1 ? ' · ' + tables.length + ' 个工作表' : ''}
        </div>

        {/*
           * 插件预设：这是哪个学校导出来的表。
           *
           * 放在最上面，因为它是"一次点掉一整轮对列"的东西 —— 用户在教务系统里
           * 下载的那张表，表头叫什么、在第几行，插件已经写好了。
           * 没装任何带导入能力的插件时这一块**整个不出现**（不占位置、不多一个空标题）。
         */}
        {presets.length > 0 ? (
          <div className="field">
            <div className="field-label">这是哪个学校导出来的表</div>
            <div className="chip-row" style={{ padding: 0 }}>
              <span
                className={presetId === '' ? 'chip on' : 'chip'}
                role="button"
                tabIndex={0}
                onClick={function () { applyPreset(''); }}
              >自动识别</span>
              {presets.map(function (pr) {
                const key = pr.pluginId + ':' + pr.capability.id;
                return (
                  <span
                    className={presetId === key ? 'chip on' : 'chip'}
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={function () { applyPreset(key); }}
                  >{pr.capability.name}</span>
                );
              })}
            </div>
            <div className="panel-desc" style={{ paddingTop: 6 }}>
              {presetId === ''
                ? '选一个预设，会按那份文件的表头写法自动对上列；对完之后仍然可以手动改。'
                : (presetHits >= 3
                  ? '已按预设对上 ' + presetHits + ' 列，下面可以逐项检查。'
                  : '按这个预设只认出了 ' + Math.max(0, presetHits) + ' 列 —— 可能不是这份表，换一个预设或手动对列。')}
            </div>
          </div>
        ) : null}

        {tables.length > 1 ? (
          <div className="field">
            <div className="field-label">用哪张工作表</div>
            <Picker
              value={tableIdx}
              options={tables.map(function (t, i) { return { value: i, label: t.name, sub: t.rows.length + ' 行' }; })}
              onChange={switchTable}
            />
          </div>
        ) : null}

        <div className="field">
          <div className="field-label">表格形式</div>
          <Segmented<Mode>
            value={mode}
            onChange={switchMode}
            options={[{ value: 'long', label: '一行一个时段' }, { value: 'matrix', label: '课表矩阵' }]}
          />
        </div>

        <div className="field">
          <div className="field-label">表头在第几行</div>
          <Picker
            value={headerRow}
            options={[{ value: -1, label: '没有表头', sub: '第一行就是数据' }].concat(headerOptions)}
            onChange={setHeaderRow}
          />
        </div>

        {mode === 'matrix' ? (
          matrix ? (
            <div className="list-row">
              <div>
                <div className="lr-label">识别到的矩阵</div>
                <div className="lr-sub">
                  第 {matrix.periodCol + 1} 列是节次；
                  {matrix.dayCols.map(function (d) { return ' 周' + WEEKDAY_CN[d.day - 1] + '=第' + (d.col + 1) + '列'; }).join(' · ')}
                </div>
              </div>
            </div>
          ) : (
            <div className="warn-bar">
              <div className="warn-badge">!</div>
              <div className="warn-item">这张表里没有找到「星期一…星期日」这样的表头，认不出矩阵。换一张工作表，或者改用「一行一个时段」。</div>
            </div>
          )
        ) : (
          <Panel title="列对应关系" desc="自动猜的，对不上就手动改。课程名、星期、节次是必填的。">
            {FIELD_ORDER.map(function (f) {
              return (
                <div className="field" key={f} style={{ padding: '0 14px' }}>
                  <div className="field-label">
                    {FIELD_LABEL[f]}{FIELD_REQUIRED[f] ? '（必填）' : '（选填）'}
                    {map[f] >= 0 && (rows[headerRow] || [])[map[f]] ? ' · ' + rows[headerRow][map[f]] : ''}
                  </div>
                  <Picker
                    value={map[f]}
                    options={columnOptions(f)}
                    onChange={function (v) { setMap(Object.assign({}, map, { [f]: v })); }}
                  />
                </div>
              );
            })}
          </Panel>
        )}

        <Panel title="前几行长什么样">
          <div className="sheet-peek">
            {rows.slice(0, 6).map(function (r, i) {
              return (
                <div key={i} className={'peek-row' + (i === headerRow ? ' head' : '')}>
                  <span className="peek-no">{i + 1}</span>
                  <span className="peek-text">{r.map(cellText).join(' | ')}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <button
          className="btn primary block"
          disabled={mode === 'long' && missing.length > 0}
          onClick={function () {
            if (mode === 'long' && missing.length > 0) {
              showToast('还没指定：' + missing.map(function (f) { return FIELD_LABEL[f]; }).join('、'), 'warn');
              return;
            }
            setStep('preview');
          }}
        >下一步：看预览</button>

        <button className="btn block" style={{ marginTop: 8 }} onClick={function () { setStep('pick'); }}>换一个文件</button>
      </Sheet>
    );
  }

  /* ------------------------------ 预览 ------------------------------ */

  const byDay = parsed.sessions.slice().sort(function (a, b) {
    return a.dayOfWeek - b.dayOfWeek || a.periodStart - b.periodStart;
  });

  return (
    <Sheet title="确认导入" onClose={closeSheets} className="sheet-full" right={<span className="panel-sub">{fileName}</span>}>
      <div className="import-stats">
        <div className="stat"><div className="stat-n">{parsed.courseNames.length}</div><div className="stat-l">门课</div></div>
        <div className="stat"><div className="stat-n">{parsed.sessions.length}</div><div className="stat-l">个时段</div></div>
        <div className={'stat' + (parsed.issues.length ? ' bad' : '')}>
          <div className="stat-n">{parsed.issues.length}</div><div className="stat-l">行没读懂</div>
        </div>
      </div>

      {parsed.sessions.length === 0 ? (
        <div className="warn-bar">
          <div className="warn-badge">!</div>
          <div>
            <div className="warn-title">一个时段都没解析出来</div>
            <div className="warn-item">回到上一步换一下表头行或列对应关系，多半是列没对上。</div>
          </div>
        </div>
      ) : null}

      {parsed.issues.length > 0 ? (
        <Panel title="这些行没能读懂" sub={parsed.issues.length + ' 行'} desc="不影响其它行的导入。想让它们也进来，回上一步改一下列对应关系。">
          <div className="sheet-peek">
            {parsed.issues.slice(0, 8).map(function (it, i) {
              return (
                <div key={i} className="peek-row">
                  <span className="peek-no">{it.row}</span>
                  <span className="peek-text">{it.reason} · {it.raw.filter(function (c) { return c; }).join(' | ').slice(0, 40)}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {parsed.sessions.length > 0 ? (
        <Panel title="将会写入的时段" sub={'共 ' + parsed.sessions.length + ' 个'}>
          <div className="sheet-peek tall">
            {byDay.slice(0, 200).map(function (s, i) {
              return (
                <div key={i} className="peek-row">
                  <span className="peek-no">周{WEEKDAY_CN[s.dayOfWeek - 1]}</span>
                  <span className="peek-text">
                    {s.periodStart === s.periodEnd ? s.periodStart : s.periodStart + '-' + s.periodEnd} 节 · {s.name}
                    {s.teacher ? ' · ' + s.teacher : ''}
                    {s.place ? ' · ' + s.place : ''}
                    {' · ' + describeWeeks(s.weeks)}
                  </span>
                </div>
              );
            })}
          </div>
          {parsed.sessions.length > 200 ? <div className="panel-desc">只列出前 200 个，导入时会全部写入。</div> : null}
        </Panel>
      ) : null}

      <div className="field">
        <div className="field-label">怎么写入</div>
        <Segmented<'merge' | 'replace'>
          value={importMode}
          onChange={setImportMode}
          options={[{ value: 'merge', label: '并进现有课表' }, { value: 'replace', label: '替换全部课程' }]}
        />
        <div className="field-label" style={{ marginTop: 6 }}>
          {importMode === 'merge'
            ? '同名课程会合并到已有的那门课上（沿用它的配色），完全相同的时段会被跳过。'
            : '现有课程、时段、调课记录与出勤记录都会被清空，只留这次导入的内容。'}
        </div>
      </div>

      <button
        className="btn primary block"
        disabled={parsed.sessions.length === 0}
        onClick={function () { applySheetImport(parsed.sessions, importMode); }}
      >导入 {parsed.courseNames.length} 门课 / {parsed.sessions.length} 个时段</button>

      <button className="btn block" style={{ marginTop: 8 }} onClick={function () { setStep('map'); }}>回去改列对应</button>
      <div className="panel-desc" style={{ paddingTop: 10 }}>
        导入后可以在提示条上点「撤销」整步还原。
      </div>
    </Sheet>
  );
}
