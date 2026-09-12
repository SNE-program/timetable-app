import React from 'react';
import {
  closeSheets, mascotExportText, saveMascotPack, showToast, useApp,
} from '../app/store';
import {
  buildPack, cellSize, defaultDraftAsset, draftAdvice, draftFromPack, draftIssues, emptyDraft,
  type DraftAsset, type MascotDraft,
} from '../mascot/draft';
import {
  MASCOT_STATES, SHEET_MAX, STATE_LABEL, type MascotAsset, type MascotAssetKind, type MascotState,
} from '../mascot/types';
import { prepareMascotImage } from '../theme/image';
import { describeVideoSheet, isVideoFile, scanSheetCells, videoToSpriteSheet } from '../theme/videoSheet';
import { saveTextFile } from '../platform/saveFile';
import MascotArt from './MascotArt';
import MascotThumb from './MascotThumb';
import { Panel, Segmented, Sheet, SliderRow, SwitchRow } from './common';

/**
 * 角色编辑器：填表做一个角色包。
 *
 * ## 为什么要有这个
 *
 * 手写 JSON 对绝大多数人是过不去的坎 —— 光是"把图片转成 base64"这一步就能劝退九成。
 * 而"用一张图当角色"那条快捷路径又只能做静态图，做不了四个状态、做不了逐帧图。
 * 这个编辑器补的就是中间那段：**能填出来的，就不用写文件**。
 *
 * ## 一个刻意的设计：预览用的是真身那段代码
 *
 * 预览不是另画一个缩略图，而是直接用 `MascotArt` —— 课表上那个角色就是它渲染的。
 * 这样"预览里好好的、放到桌面上就切错格"这类差异从结构上不会出现。
 *
 * ## 状态都放草稿里
 *
 * 界面只改草稿，保存时才 `buildPack` 收敛成合法角色包。
 * 于是"填到一半退出"不会留下半个包，而收敛规则和导入路径共用同一套。
 */

const KIND_LABEL: Record<MascotAssetKind, string> = {
  still: '静态图',
  animated: '动图',
  sheet: '逐帧图',
};

/**
 * 草稿素材 → 渲染用的素材。
 * 缩略图和预览都吃这个形态 —— 两者和桌面上那个角色走的是同一段渲染代码，
 * 不会出现选素材时看到的和最终效果不一样。
 */
function draftAssetToAsset(a: DraftAsset): MascotAsset {
  const out: MascotAsset = { kind: a.kind, src: a.src };
  if (a.kind === 'sheet') {
    out.cols = Math.max(1, Math.round(a.cols || 1));
    out.rows = Math.max(1, Math.round(a.rows || 1));
    out.fps = Math.max(1, Math.round(a.fps || 8));
  }
  return out;
}

/** 一格素材的现状，一句话说清：形态 + 原始尺寸 + 每帧多大 */
function describeDraft(a: DraftAsset | undefined): string {
  if (!a || !a.src) return '还没有选素材';
  const parts: string[] = [KIND_LABEL[a.kind]];
  if (a.width && a.height) parts.push(a.width + '×' + a.height);
  const cell = cellSize(a);
  if (cell) parts.push('每帧 ' + cell.w + '×' + cell.h);
  if (a.kind === 'sheet') {
    const cells = Math.max(1, a.cols || 1) * Math.max(1, a.rows || 1);
    /* 帧数和格数不一样时两个都写出来 —— "会不会闪"看这一行就够了 */
    parts.push(a.frames >= 2 && a.frames < cells ? '共 ' + a.frames + ' 帧（网格 ' + cells + ' 格）' : '共 ' + cells + ' 帧');
    parts.push((a.fps || 8) + ' fps');
  }
  return parts.join(' · ');
}
export default function MascotEditor(props: { mode: 'new' | 'edit' }) {
  const s = useApp();
  const [draft, setDraft] = React.useState<MascotDraft>(function () {
    if (props.mode === 'edit' && s.mascot) return draftFromPack(s.mascot);
    return emptyDraft();
  });
  const [busy, setBusy] = React.useState(false);
  const [phase, setPhase] = React.useState<MascotState>('idle');
  /** 从视频抽帧后的实测结果（帧数、每帧多大、会不会发虚） */
  const [report, setReport] = React.useState<{ summary: string; notes: string[] } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const pendingRef = React.useRef<MascotState>('idle');

  const issues = draftIssues(draft);
  /* 建议不是错误：糊也能用，所以它不拦保存，只在预览下面摆一行 */
  const advice = draftAdvice(draft, typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const preview = buildPack(draft).pack;
  const previewAsset = preview.states[phase] || preview.states.idle;
  /** 当前正在编辑的那一格 */
  const editing = draft.assets[phase];
  const editingAsset = editing && editing.src ? draftAssetToAsset(editing) : undefined;

  function patch(p: Partial<MascotDraft>): void {
    setDraft(function (d) { return Object.assign({}, d, p); });
  }

  function patchAsset(key: MascotState, a: Partial<DraftAsset> | null): void {
    setDraft(function (d) {
      const assets = Object.assign({}, d.assets);
      if (a === null) delete assets[key];
      else assets[key] = Object.assign({}, assets[key] || defaultDraftAsset('', 0, 0), a);
      return Object.assign({}, d, { assets: assets });
    });
  }

  async function pickImage(file: File, key: MascotState): Promise<void> {
    setBusy(true);
    try {
      /* 视频 → 逐帧雪碧图。二游的动图素材大量是 webm，而 webm 不是图片 */
      if (isVideoFile(file)) {
        showToast('正在从视频里抽帧，可能要几秒…', 'info');
        const v = await videoToSpriteSheet(file);
        patchAsset(key, {
          src: v.src,
          kind: 'sheet',
          cols: v.plan.cols,
          rows: v.plan.rows,
          fps: v.plan.fps,
          /*
           * 真实帧数必须一起填。网格最后一排常常排不满，那几格是全透明的；
           * 播放时按网格格数循环就会播到它们 —— 表现就是"角色一闪一闪"。
           */
          frames: v.plan.frames,
          /* 单格尺寸：算出来的格宽高，正好是"每个格子多大"，直接填进去更直观 */
          width: v.plan.cols * v.plan.cellW,
          height: v.plan.rows * v.plan.cellH,
        });
        setPhase(key);
        const d = describeVideoSheet(v, draft.height, window.devicePixelRatio || 1);
        setReport(d);
        showToast(d.summary, d.notes.length ? 'warn' : 'ok');
        return;
      }

      /*
       * 图片优先**原样保留**（见 prepareMascotImage）：重压一遍是有损的二次编码，
       * 还会把动图拍成静态图。真要压时压到 1536 长边 ——
       * 逐帧图是切出来的，每一格都要够大；显示高度上限 320px 在 3.5 倍屏上要 1120 物理像素。
       */
      const img = await prepareMascotImage(file, 1536, 0.94);
      patchAsset(key, {
        src: img.src, kind: img.kind, cols: 1, rows: 1, fps: 8, frames: 0,
        width: img.width, height: img.height,
      });
      setPhase(key);
      if (img.lostAnimation) showToast('这张动图太大了，已经压成静态图（超过 3MB 或 150 万像素）', 'warn');
    } catch (e) {
      showToast('这个文件用不了：' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 改格数/帧率时顺手把帧数收进合法范围。
   *
   * 帧数和格数是两个数：格数决定"切几刀"，帧数决定"播几帧"。
   * 用户把格数改小了，旧帧数就可能超出网格 —— 那就等于又把空格子放回播放序列里，
   * 所以这里必须一起夹住。
   */
  function patchGrid(p: Partial<DraftAsset>): void {
    const a = draft.assets[phase];
    if (!a) return;
    const cols = Math.max(1, Math.min(SHEET_MAX, Math.round(Number(p.cols === undefined ? a.cols : p.cols) || 1)));
    const rows = Math.max(1, Math.min(SHEET_MAX, Math.round(Number(p.rows === undefined ? a.rows : p.rows) || 1)));
    const cells = cols * rows;
    let frames = Math.round(Number(p.frames === undefined ? a.frames : p.frames) || 0);
    if (frames > cells || frames < 2) frames = 0;
    patchAsset(phase, Object.assign({}, p, { cols: cols, rows: rows, frames: frames }));
  }

  /** 数一遍这张逐帧图里真正有几帧（纯本地像素统计，不联网） */
  async function countFrames(): Promise<void> {
    const a = draft.assets[phase];
    if (!a || !a.src || a.kind !== 'sheet') return;
    const cols = Math.max(1, Math.round(a.cols || 1));
    const rows = Math.max(1, Math.round(a.rows || 1));
    if (cols * rows < 2) return;
    setBusy(true);
    try {
      const scan = await scanSheetCells(a.src, cols, rows);
      patchAsset(phase, { frames: scan.frames >= 2 && scan.frames < cols * rows ? scan.frames : 0 });
      if (scan.frames < cols * rows) {
        showToast('数出来是 ' + scan.frames + ' 帧（网格 ' + (cols * rows) + ' 格，最后 '
          + (cols * rows - scan.frames) + ' 格是空的）', 'ok');
      } else {
        showToast('数出来是 ' + scan.frames + ' 帧，网格正好排满', 'ok');
      }
    } catch (e) {
      showToast('数不出来：' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  /*
   * 自动数帧。
   *
   * 用户手填格数时没法知道"这张图其实只有 9 帧"（最后一排没排满），
   * 于是预览和桌面上都会闪。这里在他填完格数后自己量一遍 ——
   * 只在量出来**比格数少**的时候才改，绝不放大，也不会覆盖他手动填的值
   * （同一张图 + 同一组格数只量一次）。
   */
  const scanKeyRef = React.useRef<{ src: string; cols: number; rows: number } | null>(null);
  React.useEffect(function () {
    const a = draft.assets[phase];
    if (!a || !a.src || a.kind !== 'sheet') return;
    const cols = Math.max(1, Math.round(a.cols || 1));
    const rows = Math.max(1, Math.round(a.rows || 1));
    if (cols * rows < 3) return;
    const last = scanKeyRef.current;
    if (last && last.src === a.src && last.cols === cols && last.rows === rows) return;
    scanKeyRef.current = { src: a.src, cols: cols, rows: rows };
    let alive = true;
    void scanSheetCells(a.src, cols, rows).then(function (scan) {
      if (!alive) return;
      if (scan.frames < 2 || scan.frames >= cols * rows) return;   /* 排满的图不用管 */
      /* 已经填对了就什么都别做 —— 每次打开编辑器都弹一句提示很吵 */
      const cur = Math.round(a.frames || 0);
      if (cur === scan.frames) return;
      patchAsset(phase, { frames: scan.frames });
      showToast('这张逐帧图只有 ' + scan.frames + ' 帧（网格 ' + (cols * rows) + ' 格），已按实测帧数播放', 'info');
    }).catch(function () { /* 量不到就保持原样，用户还能手动数 */ });
    return function () { alive = false; };
  }, [phase, draft.assets]);

  async function exportPack(): Promise<void> {
    const built = buildPack(draft);
    const text = JSON.stringify({
      format: 'timetable-mascot',
      version: 1,
      exportedAt: new Date().toISOString(),
      assets: MASCOT_STATES.filter(function (k) { return !!built.pack.states[k]; })
        .map(function (k) { return { state: k, kind: built.pack.states[k]!.kind }; }),
      mascot: built.pack,
    }, null, 2);
    const name = (built.pack.name || 'mascot').replace(/[\\/:*?"<>|\s]+/g, '-');
    const r = await saveTextFile({
      fileName: name + '.mascot.json',
      text: text,
      mime: 'application/json',
      title: '课表助手角色包 · ' + built.pack.name,
      dialogTitle: '导出角色包',
    });
    if (r === 'shared') showToast('已打开分享面板', 'ok');
    else if (r === 'saved') showToast('已保存到「文档」目录', 'ok');
    else if (r === 'cancelled') showToast('已取消', 'info');
    else showToast('导出失败', 'error');
  }

  function save(): void {
    if (issues.length > 0) { showToast(issues[0], 'warn'); return; }
    const r = saveMascotPack(buildPack(draft).pack);
    if (!r.ok) { showToast(r.error || '保存失败', 'error'); return; }
    showToast('角色已保存并应用', 'ok');
    closeSheets();
  }

  return (
    <Sheet
      title={props.mode === 'edit' ? '编辑角色' : '做一个角色'}
      onClose={closeSheets}
      className="sheet-full"
      right={
        <React.Fragment>
          <button
            className="btn sm" disabled={issues.length > 0 || busy}
            title={issues.length > 0 ? issues[0] : '导出成 .json'}
            onClick={function () { void exportPack(); }}
          >导出</button>
          <button
            className="btn sm primary" disabled={issues.length > 0} onClick={save}
            title={issues.length > 0 ? issues[0] : '保存并应用到课表界面'}
          >保存</button>
        </React.Fragment>
      }
    >
      {/*
        保存按钮放在**顶栏**里，而且永远写着"保存"两个字。
        原来它在全屏弹层的最底部，而且按钮文字会被"至少要给「待机」选一张图"这句
        提示顶替掉 —— 用户在别的格子上选了图，就既看不到"保存"，也想不到要往下滚。
      */}
      {issues.length > 0 ? (
        <div className="warn-bar" style={{ marginBottom: 10 }}>
          <div className="warn-badge">!</div>
          <div className="warn-item">{issues.join('；')}</div>
        </div>
      ) : null}

      <input
        ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }}
        onChange={function (e) {
          const f = e.target.files && e.target.files[0];
          e.target.value = '';
          if (f) void pickImage(f, pendingRef.current);
        }}
      />

      {/* ---------- 预览 ---------- */}
      <div className="mascot-preview">
        <div className="mascot-preview-stage">
          {previewAsset ? (
            <MascotArt
              asset={previewAsset}
              motion={draft.motion}
              phase={phase === 'sleep' ? 'sleep' : 'idle'}
              size={Math.min(180, draft.height)}
              shadow={draft.shadow}
            />
          ) : (
            <div className="lr-sub">给「待机」选一张图，这里就会出现预览</div>
          )}
        </div>
      </div>

      {/*
        抽帧结果与"够不够清楚"的建议。
        这些话必须**说成数字**（每帧多少像素、屏幕要多少物理像素），
        否则用户只会看到一个糊糊的角色，然后怀疑是不是应用做得糙。
      */}
      {advice.length > 0 || report ? (
        <div className="warn-bar">
          <div className="warn-badge">{report && report.notes.length === 0 && advice.length === 0 ? '✓' : '!'}</div>
          <div>
            {report ? (
              <div className="warn-item" style={{ color: 'var(--c-text)', marginTop: 0 }}>{report.summary}</div>
            ) : null}
            {report ? report.notes.map(function (n, i) {
              return <div className="warn-item" key={'n' + i}>{n}</div>;
            }) : null}
            {advice.map(function (n, i) {
              return <div className="warn-item" key={'a' + i}>{n}</div>;
            })}
          </div>
        </div>
      ) : null}

      {/*
        ---------- 素材 ----------
        四个状态排成一排格子，点哪格编哪格 —— 比每个状态各堆一坨同样的控件短得多，
        而且缩略图直接告诉你每格现在是什么，不用去看文字描述。
        没做过的格子是虚线加号，一眼能看出还差几格。
      */}
      <Panel title="素材" desc="点一格来编辑它。只有「待机」是必填的，其余留空会自动退回待机。">
        <div className="mascot-slots">
          {MASCOT_STATES.map(function (key) {
            const a = draft.assets[key];
            const on = phase === key;
            return (
              <button
                key={key}
                type="button"
                className={on ? 'mascot-slot on' : 'mascot-slot'}
                aria-pressed={on}
                onClick={function () { setPhase(key); }}
              >
                {a && a.src ? <MascotThumb asset={draftAssetToAsset(a)} />
                  : <div className="mascot-thumb is-empty mascot-slot-add" style={{ height: '48px' }}>＋</div>}
                <div className="mascot-slot-name">{STATE_LABEL[key]}</div>
                <div className="mascot-slot-sub">{key === 'idle' ? (a && a.src ? '必填 · 已设置' : '必填') : (a && a.src ? '已设置' : '留空')}</div>
              </button>
            );
          })}
        </div>

        {/* 选中那一格的详情：只出现一份，不再重复四遍 */}
        <div className="mascot-editbox">
          <div className="mascot-editbox-head">
            <MascotThumb asset={editingAsset} size={56} />
            <div className="mascot-editbox-name">
              <div className="lr-label">{STATE_LABEL[phase]}</div>
              <div className="lr-sub">{describeDraft(editing)}</div>
            </div>
            <button
              className="btn sm" disabled={busy}
              onClick={function () { pendingRef.current = phase; if (fileRef.current) fileRef.current.click(); }}
            >{editing && editing.src ? '换一个' : '选图'}</button>
            {editing && editing.src ? (
              <button className="btn sm ghost" onClick={function () { patchAsset(phase, null); }}>清除</button>
            ) : null}
          </div>

          <div className="field-label" style={{ marginTop: 10 }}>这是什么形态</div>
          <Segmented<MascotAssetKind>
            value={editing && editing.src ? editing.kind : 'still'}
            onChange={function (v) { patchAsset(phase, { kind: v }); }}
            options={[
              { value: 'still', label: '静态图' },
              { value: 'animated', label: '动图' },
              { value: 'sheet', label: '逐帧图' },
            ]}
          />
          {editing && editing.src && editing.kind === 'sheet' ? (
            <React.Fragment>
              <div className="mascot-grid-nums">
                <label>
                  <span>横排几格</span>
                  <input
                    className="input" type="number" min={1} max={SHEET_MAX} value={editing.cols}
                    onChange={function (e) { patchGrid({ cols: Number(e.target.value) }); }}
                  />
                </label>
                <label>
                  <span>竖排几格</span>
                  <input
                    className="input" type="number" min={1} max={SHEET_MAX} value={editing.rows}
                    onChange={function (e) { patchGrid({ rows: Number(e.target.value) }); }}
                  />
                </label>
                {/*
                  帧数和格数是两个数，这是这一版新拆出来的：
                  格数决定"切几刀"，帧数决定"播几帧"。最后一排没排满时，
                  多出来的格子是全透明的 —— 按格数播就会闪，所以必须能填、能自动数。
                */}
                <label>
                  <span>共几帧</span>
                  <input
                    className="input" type="number" min={2} max={Math.max(2, editing.cols * editing.rows)}
                    value={editing.frames >= 2 ? editing.frames : editing.cols * editing.rows}
                    onChange={function (e) { patchGrid({ frames: Number(e.target.value) }); }}
                  />
                </label>
                <label>
                  <span>每秒几帧</span>
                  <input
                    className="input" type="number" min={1} max={24} value={editing.fps}
                    onChange={function (e) { patchGrid({ fps: Number(e.target.value) }); }}
                  />
                </label>
              </div>
              <div className="field-label" style={{ marginTop: 8 }}>
                {cellSize(editing) ? '每帧 ' + cellSize(editing)!.w + '×' + cellSize(editing)!.h + ' 像素 · ' : ''}
                填完上面的大预览会立刻按这个切法播放，切错了当场就能看出来。
              </div>
              <button
                className="btn sm block" style={{ marginTop: 8 }} disabled={busy}
                onClick={function () { void countFrames(); }}
              >自动数帧（量一下这张图里真正有几帧）</button>
            </React.Fragment>
          ) : null}
          {editing && editing.src && editing.kind !== 'sheet' ? (
            <div className="field-label" style={{ marginTop: 8 }}>
              {editing.kind === 'animated'
                ? '动图由系统自己播放，循环和帧率跟着文件走。'
                : '静态图靠下面「动作」里的呼吸和浮动活起来。'}
            </div>
          ) : null}
          {!editing || !editing.src ? (
            <div className="field-label" style={{ marginTop: 8 }}>
              点上面的缩略格选一张图。图片和视频都行 —— 视频会自动抽帧做成逐帧图。
            </div>
          ) : null}
        </div>
      </Panel>

      {/* ---------- 外观与动作 ---------- */}

      {/* ---------- 外观与动作 ---------- */}
      <Panel title="动作" desc="静态图靠这几项动起来。左边拖动、上面预览，改完立刻能看到。">
        <div style={{ padding: '0 14px' }}>
          <SliderRow
            label="呼吸幅度" value={draft.motion.breathe} min={0} max={0.08} step={0.005}
            format={function (v) { return v === 0 ? '关闭' : (v * 100).toFixed(1) + '%'; }}
            onChange={function (v) { patch({ motion: Object.assign({}, draft.motion, { breathe: v }) }); }}
          />
          <SliderRow
            label="上下浮动" value={draft.motion.bob} min={0} max={0.06} step={0.005}
            format={function (v) { return v === 0 ? '关闭' : (v * 100).toFixed(1) + '%'; }}
            onChange={function (v) { patch({ motion: Object.assign({}, draft.motion, { bob: v }) }); }}
          />
          <SliderRow
            label="左右摇摆" value={draft.motion.sway} min={0} max={8} step={0.5}
            format={function (v) { return v === 0 ? '关闭' : v.toFixed(1) + '°'; }}
            onChange={function (v) { patch({ motion: Object.assign({}, draft.motion, { sway: v }) }); }}
          />
          <SliderRow
            label="显示高度" value={draft.height} min={56} max={320} step={4}
            format={function (v) { return v + ' px'; }}
            onChange={function (v) { patch({ height: v }); }}
          />
        </div>
        <SwitchRow
          label="脚下投一小团阴影" sub="深色角色立在浅色背景上时不至于浮起来"
          on={draft.shadow} onChange={function (v) { patch({ shadow: v }); }}
        />
        <SwitchRow
          label="点一下有反应" on={draft.click} onChange={function (v) { patch({ click: v }); }}
        />
        <SwitchRow
          label="可以拖动换位置" on={draft.drag} onChange={function (v) { patch({ drag: v }); }}
        />
      </Panel>

      {/* ---------- 信息 ---------- */}
      <Panel title="信息" desc="名字会出现在外观页；作者和说明会一起写进角色包，分享给别人时能看到。">
        <div style={{ padding: '0 14px' }}>
          <div className="field">
            <div className="field-label">名字</div>
            <input
              className="input" value={draft.name} placeholder="例如：小课表"
              onChange={function (e) { patch({ name: e.target.value }); }}
            />
          </div>
          <div className="field">
            <div className="field-label">作者（选填）</div>
            <input
              className="input" value={draft.author} placeholder="留空就不写进包里"
              onChange={function (e) { patch({ author: e.target.value }); }}
            />
          </div>
          <div className="field">
            <div className="field-label">一句话说明（选填）</div>
            <input
              className="input" value={draft.description} placeholder="例如：期末周的怨念集合体"
              onChange={function (e) { patch({ description: e.target.value }); }}
            />
          </div>
        </div>
      </Panel>

      {/* 滚到最后也会看到一遍，和顶栏那两个按钮是同一个动作 */}
      <button className="btn primary block" disabled={issues.length > 0} onClick={save}>
        保存并应用
      </button>
      <button className="btn block" style={{ marginTop: 8 }} disabled={issues.length > 0} onClick={function () { void exportPack(); }}>
        导出角色包（.json）
      </button>
      <div className="panel-desc" style={{ paddingTop: 10 }}>
        导出的文件可以直接发给别人，他在「导入角色包」里选一下就能用。
        素材全部内嵌在里面，不依赖任何外部文件。
      </div>
    </Sheet>
  );
}
