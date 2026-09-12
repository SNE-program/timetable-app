import React from 'react';
import { parseISODate, toISODate } from '../core/engine';

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function Sheet(props: {
  title: string; onClose: () => void; children: React.ReactNode;
  right?: React.ReactNode;
  /** 叠在别的弹层之上时用（比如课程编辑面板里再开一个选择器） */
  className?: string;
}) {
  const cls = props.className ? ' ' + props.className : '';
  return (
    <React.Fragment>
      <div className={'sheet-mask' + cls} onClick={props.onClose} />
      <div className={'sheet' + cls} role="dialog">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div className="sheet-title">{props.title}</div>
          <div className="spacer" />
          {props.right}
          <button className="icon-btn" onClick={props.onClose} aria-label="关闭">✕</button>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </React.Fragment>
  );
}

export function Segmented<T extends string>(props: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {props.options.map(function (o) {
        return (
          <button
            key={o.value}
            className={props.value === o.value ? 'seg active' : 'seg'}
            onClick={function () { props.onChange(o.value); }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

export function SliderRow(props: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const step = props.step || 1;
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span className="small">{props.label}</span>
        <span className="sv">{props.format ? props.format(props.value) : props.value}</span>
      </div>
      <input
        className="rng"
        type="range"
        min={props.min} max={props.max} step={step} value={props.value}
        style={{ ['--fill']: pct + '%' } as React.CSSProperties}
        onChange={function (e) { props.onChange(Number(e.target.value)); }}
      />
    </div>
  );
}

export function SwitchRow(props: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="list-row" onClick={function () { props.onChange(!props.on); }} style={{ cursor: 'pointer' }}>
      <div>
        <div className="lr-label">{props.label}</div>
        {props.sub ? <div className="lr-sub">{props.sub}</div> : null}
      </div>
      <div className="lr-right">
        <div className={props.on ? 'switch on' : 'switch'} />
      </div>
    </div>
  );
}

export interface PickerOption<T extends string | number> {
  value: T;
  label: string;
  /** 右侧的次要信息，比如节次时间 */
  sub?: string;
}

/**
 * 替代原生 `<select>`。
 *
 * 原生 select 在安卓 WebView 里弹的是**系统白底列表** —— 和这套描边 + 深色的
 * 工业风界面完全不搭，而且选项的字号、间距、圆角一律不受 CSS 控制。
 * 这里换成和全站同一套底部弹层：相同的圆角、描边、字号和按压反馈，
 * 选中项用主题色标出来，还多带一个「取消」。
 */
export function Picker<T extends string | number>(props: {
  value: T;
  options: PickerOption<T>[];
  onChange: (v: T) => void;
  title?: string;
  disabled?: boolean;
  /** 紧凑模式：用于「第 X 节 到 第 Y 节」这种成对出现的场景 */
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const cur = props.options.filter(function (o) { return o.value === props.value; })[0];

  return (
    <React.Fragment>
      <button
        type="button"
        className={props.compact ? 'picker-trigger compact' : 'picker-trigger'}
        disabled={props.disabled}
        onClick={function () { setOpen(true); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="pk-text">{cur ? cur.label : '请选择'}</span>
        <span className="pk-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <Sheet
          className="picker-layer"
          title={props.title || '请选择'}
          onClose={function () { setOpen(false); }}
          right={<button className="btn sm" onClick={function () { setOpen(false); }}>取消</button>}
        >
          <div className="picker-list" role="listbox">
            {props.options.map(function (o) {
              const on = o.value === props.value;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={on ? 'picker-opt on' : 'picker-opt'}
                  onClick={function () { setOpen(false); props.onChange(o.value); }}
                >
                  <span className="pk-check" aria-hidden="true">{on ? '✓' : ''}</span>
                  <span className="pk-label">{o.label}</span>
                  {o.sub ? <span className="pk-sub">{o.sub}</span> : null}
                </button>
              );
            })}
          </div>
        </Sheet>
      ) : null}
    </React.Fragment>
  );
}

/**
 * 替代 `window.confirm`。
 *
 * 系统弹窗同样是白底、系统字体、系统按钮，在设置和删除这些关键动作上
 * 一出现就把整个界面的调性打断了。这里换成自家的卡片：文案、按钮、危险色
 * 都跟着主题走，危险操作的主按钮用红色。
 */
export function ConfirmDialog(props: {
  message: string;
  okText?: string;
  danger?: boolean;
  onResolve: (ok: boolean) => void;
}) {
  return (
    <div className="confirm-mask" onClick={function () { props.onResolve(false); }}>
      <div
        className="confirm-box" role="alertdialog" aria-modal="true"
        onClick={function (e) { e.stopPropagation(); }}
      >
        <div className="confirm-msg">{props.message}</div>
        <div className="confirm-actions">
          <button className="btn ghost" onClick={function () { props.onResolve(false); }}>取消</button>
          <button
            className={props.danger === false ? 'btn primary' : 'btn danger'}
            onClick={function () { props.onResolve(true); }}
          >{props.okText || '确定'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 替代原生 `<input type="date">`。
 *
 * 安卓上原生日期控件弹的是系统日历，白底、系统字体，和这套界面完全两回事。
 * 这里自己画一个月历：同样的描边卡片、主题色选中、周一起始（中文习惯），
 * 另外给「今天」和「清除」两个快捷入口，比原生少点好几下。
 */
export function DateField(props: {
  /** 'YYYY-MM-DD'；空串表示未设置 */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  /** 允许清空（比如任务的截止日期可以没有） */
  clearable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState(function () {
    const d = props.value ? parseISODate(props.value) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  /* 每次打开都跟着当前值回到正确的月份，而不是停在上次翻到的位置 */
  React.useEffect(function () {
    if (!open) return;
    const d = props.value ? parseISODate(props.value) : new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }, [open]);

  const selected = props.value ? parseISODate(props.value) : null;
  const today = new Date();

  const label = (function () {
    if (!selected) return props.placeholder || '选择日期';
    const wd = WEEK_HEAD[(selected.getDay() + 6) % 7];
    const y = selected.getFullYear() === today.getFullYear() ? '' : selected.getFullYear() + '年';
    return y + (selected.getMonth() + 1) + '月' + selected.getDate() + '日 周' + wd;
  })();

  /* 6 行 × 7 列固定 42 格，月初之前的格子用上个月的日期补满 */
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(new Date(view.y, view.m, i - lead + 1));

  function shift(delta: number): void {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <React.Fragment>
      <button
        type="button"
        className={props.className ? 'picker-trigger ' + props.className : 'picker-trigger'}
        onClick={function () { setOpen(true); }} aria-haspopup="dialog"
      >
        <span className={selected ? 'pk-text' : 'pk-text ph'}>{label}</span>
        <span className="pk-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <Sheet
          className="picker-layer"
          title={props.title || '选择日期'}
          onClose={function () { setOpen(false); }}
          right={<button className="btn sm" onClick={function () { setOpen(false); }}>取消</button>}
        >
          <div className="cal">
            <div className="cal-head">
              <button type="button" className="cal-nav" onClick={function () { shift(-1); }} aria-label="上个月">‹</button>
              <div className="cal-title">{view.y} 年 {view.m + 1} 月</div>
              <button type="button" className="cal-nav" onClick={function () { shift(1); }} aria-label="下个月">›</button>
            </div>
            <div className="cal-week">
              {WEEK_HEAD.map(function (w) { return <span key={w}>{w}</span>; })}
            </div>
            <div className="cal-grid">
              {cells.map(function (d) {
                const inMonth = d.getMonth() === view.m;
                const isSel = selected ? sameDay(d, selected) : false;
                const isToday = sameDay(d, today);
                let cls = 'cal-day';
                if (!inMonth) cls += ' out';
                if (isToday) cls += ' today';
                if (isSel) cls += ' on';
                return (
                  <button
                    key={toISODate(d)} type="button" className={cls}
                    onClick={function () { setOpen(false); props.onChange(toISODate(d)); }}
                  >{d.getDate()}</button>
                );
              })}
            </div>
            <div className="cal-foot">
              <button
                type="button" className="btn ghost"
                onClick={function () { setOpen(false); props.onChange(toISODate(new Date())); }}
              >今天</button>
              {props.clearable !== false ? (
                <button
                  type="button" className="btn ghost"
                  onClick={function () { setOpen(false); props.onChange(''); }}
                >清除</button>
              ) : null}
            </div>
          </div>
        </Sheet>
      ) : null}
    </React.Fragment>
  );
}

/**
 * 替代原生 `<input type="time">`。
 *
 * 原生时间控件在安卓上是系统时钟盘，白底、字号巨大，和这里格格不入。
 * 课表的时间精度到分钟就够，所以做成两列列表：小时 + 分钟（5 分钟一档），
 * 点一下就选中，改完点「完成」。比转盘在手机上更好点。
 */
export function TimeField(props: {
  value: string;
  onChange: (v: string) => void;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(props.value || '08:00');

  const parts = (props.value || '08:00').split(':');
  const hh = parts[0] || '08';
  const mm = parts[1] || '00';
  const label = props.value || '选择时间';

  const HOURS: string[] = [];
  for (let i = 0; i < 24; i++) HOURS.push(pad2(i));
  const MINUTES: string[] = [];
  for (let i = 0; i < 60; i += 5) MINUTES.push(pad2(i));
  /* 当前值不在 5 分钟档上时也要能看到自己选中的是什么 */
  if (MINUTES.indexOf(mm) < 0) MINUTES.push(mm);
  MINUTES.sort();

  const dParts = (draft || '08:00').split(':');
  const dH = dParts[0] || '08';
  const dM = dParts[1] || '00';

  return (
    <React.Fragment>
      <button
        type="button"
        className={props.className ? 'picker-trigger ' + props.className : 'picker-trigger'}
        onClick={function () { setDraft(props.value || '08:00'); setOpen(true); }}
        aria-haspopup="dialog"
      >
        <span className={props.value ? 'pk-text' : 'pk-text ph'}>{label}</span>
        <span className="pk-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <Sheet
          className="picker-layer"
          title={props.title || '选择时间'}
          onClose={function () { setOpen(false); }}
          right={
            <button
              className="btn sm primary"
              onClick={function () { setOpen(false); props.onChange(dH + ':' + dM); }}
            >完成</button>
          }
        >
          <div className="time-pick">
            <div className="tp-col">
              <div className="tp-head">时</div>
              <div className="tp-scroll">
                {HOURS.map(function (h) {
                  return (
                    <button
                      key={h} type="button"
                      className={h === dH ? 'tp-cell on' : 'tp-cell'}
                      onClick={function () { setDraft(h + ':' + dM); }}
                    >{h}</button>
                  );
                })}
              </div>
            </div>
            <div className="tp-col">
              <div className="tp-head">分</div>
              <div className="tp-scroll">
                {MINUTES.map(function (m) {
                  return (
                    <button
                      key={m} type="button"
                      className={m === dM ? 'tp-cell on' : 'tp-cell'}
                      onClick={function () { setDraft(dH + ':' + m); }}
                    >{m}</button>
                  );
                })}
              </div>
            </div>
          </div>
        </Sheet>
      ) : null}
    </React.Fragment>
  );
}

/* 自定义主色的备选色：够覆盖常见偏好，又不至于让人挑花眼 */
const CUSTOM_COLORS = [
  '#2F6BFF', '#4C6EF5', '#6D4AFF', '#8B5CF6', '#C2478E', '#E0524A',
  '#F0623C', '#E07B2E', '#C9971F', '#7CA82B', '#3F9A54', '#12A594',
  '#0891B2', '#0EA5A5', '#2563EB', '#7C3AED', '#DB2777', '#475569',
];

/**
 * 替代原生 `<input type="color">`。
 *
 * 原生取色器在安卓上是一个系统对话框，白底、色轮巨大，和这里格格不入，
 * 而且它只能给一个颜色，没法在旁边做实时预览。这里换成自家的面板：
 * 大色块预览 + 十六进制输入 + 一组备选色，输入合法的十六进制就立刻生效。
 */
export function ColorField(props: {
  value: string;
  onChange: (v: string) => void;
  title?: string;
  className?: string;
  /** 触发按钮的内容；省略时显示一个彩虹色块 */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [hex, setHex] = React.useState(props.value);

  React.useEffect(function () { if (!open) setHex(props.value); }, [props.value, open]);

  const norm = hex.trim().replace(/^#?/, '#');
  const valid = /^#[0-9a-fA-F]{6}$/.test(norm);

  function type(v: string): void {
    setHex(v);
    const n = v.trim().replace(/^#?/, '#');
    if (/^#[0-9a-fA-F]{6}$/.test(n)) props.onChange(n.toLowerCase());
  }

  return (
    <React.Fragment>
      <button
        type="button"
        className={props.className || 'custom-color'}
        onClick={function () { setHex(props.value); setOpen(true); }}
        title={props.title || '自定义颜色'}
        aria-haspopup="dialog"
      >
        {props.children !== undefined ? props.children : (
          <span className="cf-chip" style={{ background: props.value }} />
        )}
      </button>

      {open ? (
        <Sheet
          className="picker-layer"
          title={props.title || '自定义颜色'}
          onClose={function () { setOpen(false); }}
          right={<button className="btn sm primary" onClick={function () { setOpen(false); }}>完成</button>}
        >
          <div className="cf">
            <div className="cf-preview" style={{ background: valid ? norm : props.value }} />
            <div className="cf-input">
              <span className="cf-hash">#</span>
              <input
                className="input"
                value={hex.replace(/^#/, '').toUpperCase()}
                maxLength={6}
                spellCheck={false}
                autoComplete="off"
                placeholder="2F6BFF"
                onChange={function (e) { type('#' + e.target.value.replace(/[^0-9a-fA-F]/g, '')); }}
              />
            </div>
            {valid ? null : <div className="cf-warn">请输入 6 位十六进制，例如 2F6BFF</div>}
            <div className="cf-grid">
              {CUSTOM_COLORS.map(function (c) {
                return (
                  <button
                    key={c} type="button"
                    className={c.toLowerCase() === props.value.toLowerCase() ? 'cf-swatch on' : 'cf-swatch'}
                    style={{ background: c }}
                    onClick={function () { setHex(c); props.onChange(c.toLowerCase()); }}
                    title={c}
                  />
                );
              })}
            </div>
          </div>
        </Sheet>
      ) : null}
    </React.Fragment>
  );
}

export function Panel(props: { title?: string; sub?: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      {props.title ? (
        <div className="panel-head">
          <div className="panel-title">{props.title}</div>
          {props.sub ? <div className="panel-sub">{props.sub}</div> : null}
        </div>
      ) : null}
      {props.desc ? <div className="panel-desc">{props.desc}</div> : null}
      {props.children}
    </div>
  );
}
