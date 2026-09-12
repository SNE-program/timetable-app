import React from 'react';
import { closeSheets, duplicateScheme, setActiveScheme, showToast, updateSchemePeriods, useApp } from '../app/store';
import type { Period } from '../core/types';
import { Sheet, TimeField } from './common';

export default function SchemeSheet() {
  const s = useApp();
  const [activeId, setActiveId] = React.useState(s.data.term.periodSchemeId);
  const scheme = s.data.schemes.find(function (x) { return x.id === activeId; }) || s.data.schemes[0];
  const [periods, setPeriods] = React.useState<Period[]>(function () {
    return scheme.periods.map(function (p) { return Object.assign({}, p); });
  });
  const [newName, setNewName] = React.useState('');

  React.useEffect(function () {
    const cur = s.data.schemes.find(function (x) { return x.id === activeId; }) || s.data.schemes[0];
    setPeriods(cur.periods.map(function (p) { return Object.assign({}, p); }));
  }, [activeId]);

  /** 改动即时生效 —— 手机上很容易改完直接关掉，别让用户白改 */
  function apply(next: Period[]): void {
    const bad = next.filter(function (p) { return !p.start || !p.end || p.start >= p.end; });
    if (bad.length > 0) {
      showToast('第 ' + bad[0].index + ' 节的开始时间必须早于结束时间', 'warn');
      return;
    }
    updateSchemePeriods(activeId, next);
  }

  function patchPeriod(i: number, patch: Partial<Period>) {
    const next = periods.map(function (p, k) { return k === i ? Object.assign({}, p, patch) : p; });
    setPeriods(next);
    apply(next);
  }

  function pickScheme(id: string) {
    setActiveId(id);
    setActiveScheme(id);
  }

  return (
    <Sheet
      title="作息与节次"
      onClose={closeSheets}
      right={<button className="btn sm primary" onClick={closeSheets}>完成</button>}
    >
      <div className="section-title">使用哪一套</div>
      <div className="chip-row" style={{ padding: '0 0 6px' }}>
        {s.data.schemes.map(function (x) {
          return (
            <button key={x.id} className={activeId === x.id ? 'chip on' : 'chip'} onClick={function () { pickScheme(x.id); }}>
              {x.name} · {x.periods.length} 节
            </button>
          );
        })}
      </div>
      <div className="panel-desc" style={{ padding: '0 0 6px' }}>
        课程只记录「第几节」，具体几点由这里的作息决定 —— 所以冬夏令时切换不用重录任何课程。<b>改动即时生效</b>。
      </div>

      <div className="section-title">节次时间 · {scheme.name}</div>
      {periods.map(function (p, i) {
        const invalid = !p.start || !p.end || p.start >= p.end;
        return (
          <div className="sess-card" key={p.index} style={invalid ? { borderColor: 'var(--c-danger)' } : undefined}>
            <div className="sess-head">
              <span className="sess-index">第 {p.index} 节</span>
              <div className="spacer" />
              {invalid ? <span className="tiny" style={{ color: 'var(--c-danger)' }}>时间不对</span> : null}
            </div>
            <div className="row">
              <TimeField title="开始时间" value={p.start} onChange={function (v) { patchPeriod(i, { start: v }); }} />
              <span className="muted small">到</span>
              <TimeField title="结束时间" value={p.end} onChange={function (v) { patchPeriod(i, { end: v }); }} />
            </div>
          </div>
        );
      })}

      <div className="section-title">再建一套</div>
      <div className="row">
        <input className="input" value={newName} placeholder="新方案名称" onChange={function (e) { setNewName(e.target.value); }} />
        <button
          className="btn"
          onClick={function () {
            const n = newName.trim();
            if (!n) { showToast('先给新方案起个名字', 'warn'); return; }
            duplicateScheme(scheme.id, n);
            setNewName('');
          }}
        >新增</button>
      </div>
      <div className="panel-desc" style={{ padding: '10px 0 0' }}>
        新方案会复制当前这套的时间，改完记得点右上角保存。
      </div>
    </Sheet>
  );
}
