import React from 'react';
import { closeSheets, confirmDanger, setData, showToast, useApp } from '../app/store';
import type { DayOfWeek, Override, Session, WeekSelector } from '../core/types';
import { Picker, Sheet } from './common';

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];
type WeekMode = 'all' | 'odd' | 'even' | 'range';

interface Draft {
  id: string | null;
  dayOfWeek: DayOfWeek;
  periodStart: number;
  periodEnd: number;
  mode: WeekMode;
  from: number;
  to: number;
  /** 勾上表示不写结束周，让这门课一直重复下去 */
  openEnded: boolean;
  location: string;
}

function weeksOfDraft(d: Draft, total: number): WeekSelector {
  if (d.mode === 'all') return { type: 'all' };
  const to = d.openEnded ? undefined : (d.mode === 'range' ? d.to : total);
  if (d.mode === 'odd') return { type: 'stepped', from: 1, to: to, step: 2 };
  if (d.mode === 'even') return { type: 'stepped', from: 2, to: to, step: 2 };
  return { type: 'range', from: d.from, to: to };
}

function draftFromSession(x: Session, total: number): Draft {
  let mode: WeekMode = 'all';
  let from = 1;
  let to = total;
  let openEnded = false;
  if (x.weeks.type === 'stepped' && x.weeks.step === 2) {
    mode = x.weeks.from === 1 ? 'odd' : 'even';
    openEnded = x.weeks.to === undefined;
    to = x.weeks.to === undefined ? total : x.weeks.to;
  } else if (x.weeks.type === 'range') {
    mode = 'range';
    from = x.weeks.from;
    openEnded = x.weeks.to === undefined;
    to = x.weeks.to === undefined ? total : x.weeks.to;
  } else if (x.weeks.type === 'list') {
    mode = 'range';
    from = x.weeks.weeks[0] || 1;
    to = x.weeks.weeks[x.weeks.weeks.length - 1] || total;
  }
  return {
    id: x.id, dayOfWeek: x.dayOfWeek, periodStart: x.periodStart, periodEnd: x.periodEnd,
    mode: mode, from: from, to: to, openEnded: openEnded, location: x.location || '',
  };
}

function newDraft(): Draft {
  return { id: null, dayOfWeek: 1, periodStart: 1, periodEnd: 2, mode: 'all', from: 1, to: 16, openEnded: false, location: '' };
}

export default function CourseEditor(props: { courseId: string | null }) {
  const s = useApp();
  const total = s.data.term.totalWeeks === undefined ? 20 : s.data.term.totalWeeks;
  const scheme = s.data.schemes.find(function (x) { return x.id === s.data.term.periodSchemeId; }) || s.data.schemes[0];
  const existing = props.courseId ? s.data.courses.find(function (c) { return c.id === props.courseId; }) : undefined;

  const [name, setName] = React.useState(existing ? existing.name : '');
  const [teacher, setTeacher] = React.useState(existing ? existing.teacher || '' : '');
  const [saving, setSaving] = React.useState(false);
  const initialRef = React.useRef<string>('');
  const [drafts, setDrafts] = React.useState<Draft[]>(function () {
    if (!existing) return [newDraft()];
    const list = s.data.sessions.filter(function (x) { return x.courseId === existing.id; });
    return list.length ? list.map(function (x) { return draftFromSession(x, total); }) : [newDraft()];
  });

  const draftSig = JSON.stringify({ n: name, t: teacher, d: drafts });
  const dirty = initialRef.current !== '' && initialRef.current !== draftSig;
  React.useEffect(function () {
    if (initialRef.current === '') initialRef.current = draftSig;
  }, []);

  /** 关掉面板前，如果有没保存的改动先问一句 */
  async function requestClose(): Promise<void> {
    if (dirty && !(await confirmDanger('有还没保存的修改，确定要放弃吗？', '放弃修改'))) return;
    closeSheets();
  }

  function patchDraft(i: number, patch: Partial<Draft>) {
    setDrafts(function (prev) {
      return prev.map(function (d, k) { return k === i ? Object.assign({}, d, patch) : d; });
    });
  }

  function save() {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) { showToast('先给课程起个名字', 'warn'); return; }
    setSaving(true);
    const now = Date.now();
    const courseId = existing ? existing.id : 'c' + now;

    const keptIds: string[] = [];
    const newSessions: Session[] = drafts.map(function (d, i) {
      const start = Math.min(d.periodStart, d.periodEnd);
      const end = Math.max(d.periodStart, d.periodEnd);
      const id = d.id || ('s' + (now + i));
      keptIds.push(id);
      return {
        id: id, courseId: courseId, dayOfWeek: d.dayOfWeek,
        periodStart: start, periodEnd: end,
        weeks: weeksOfDraft(d, total),
        location: d.location.trim() || undefined,
      };
    });

    const courses = existing
      ? s.data.courses.map(function (c) {
          return c.id === courseId ? Object.assign({}, c, { name: trimmed, teacher: teacher.trim() || undefined }) : c;
        })
      : s.data.courses.concat([{
          id: courseId, name: trimmed, teacher: teacher.trim() || undefined,
          colorIndex: s.data.courses.length % 12, tags: ['自定义'],
        }]);

    const removedIds = s.data.sessions
      .filter(function (x) { return x.courseId === courseId && keptIds.indexOf(x.id) < 0; })
      .map(function (x) { return x.id; });
    const others = s.data.sessions.filter(function (x) { return x.courseId !== courseId; });
    const overrides: Override[] = s.data.overrides.filter(function (o) { return removedIds.indexOf(o.sessionId) < 0; });

    setData(Object.assign({}, s.data, {
      courses: courses,
      sessions: others.concat(newSessions),
      overrides: overrides,
    }), existing ? '保存课程' : '添加课程');
    showToast(existing ? '已保存' : '已添加', 'ok');
    initialRef.current = '';
    closeSheets();
  }

  return (
    <Sheet
      title={existing ? '编辑课程' : '添加课程'}
      onClose={function () { void requestClose(); }}
      right={<button className="btn sm primary" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</button>}
    >
      <div className="field">
        <div className="field-label">课程名称</div>
        <input className="input" value={name} placeholder="例如：概率论与数理统计" onChange={function (e) { setName(e.target.value); }} />
      </div>
      <div className="field">
        <div className="field-label">任课教师</div>
        <input className="input" value={teacher} placeholder="选填" onChange={function (e) { setTeacher(e.target.value); }} />
      </div>

      <div className="section-title">上课时段 · {drafts.length} 个</div>
      {drafts.map(function (d, i) {
        return (
          <div className="sess-card" key={d.id || ('new' + i)}>
            <div className="sess-head">
              <span className="sess-index">#{i + 1}</span>
              <span className="tiny muted">周{WEEKDAY_CN[d.dayOfWeek - 1]} · 第 {Math.min(d.periodStart, d.periodEnd)}-{Math.max(d.periodStart, d.periodEnd)} 节</span>
              <div className="spacer" />
              {drafts.length > 1 ? (
                <button
                  className="btn sm ghost"
                  onClick={function () { setDrafts(function (prev) { return prev.filter(function (_, k) { return k !== i; }); }); }}
                >删除</button>
              ) : null}
            </div>

            <div className="field" style={{ marginBottom: 10 }}>
              <div className="field-label">星期</div>
              <div className="chip-row" style={{ padding: 0 }}>
                {WEEKDAY_CN.map(function (w, k) {
                  const dow = (k + 1) as DayOfWeek;
                  return (
                    <button key={w} className={d.dayOfWeek === dow ? 'chip on' : 'chip'}
                      onClick={function () { patchDraft(i, { dayOfWeek: dow }); }}>周{w}</button>
                  );
                })}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 10 }}>
              <div className="field-label">节次</div>
              <div className="row">
                <Picker
                  compact title="开始节次" value={d.periodStart}
                  options={scheme.periods.map(function (p) { return { value: p.index, label: '第 ' + p.index + ' 节', sub: p.start }; })}
                  onChange={function (v) { patchDraft(i, { periodStart: v }); }}
                />
                <span className="muted small">到</span>
                <Picker
                  compact title="结束节次" value={d.periodEnd}
                  options={scheme.periods.map(function (p) { return { value: p.index, label: '第 ' + p.index + ' 节', sub: p.end }; })}
                  onChange={function (v) { patchDraft(i, { periodEnd: v }); }}
                />
              </div>
            </div>

            <div className="field" style={{ marginBottom: 10 }}>
              <div className="field-label">周次</div>
              <div className="chip-row" style={{ padding: 0 }}>
                {([['all', '每周'], ['odd', '单周'], ['even', '双周'], ['range', '指定范围']] as [WeekMode, string][]).map(function (it) {
                  return (
                    <button key={it[0]} className={d.mode === it[0] ? 'chip on' : 'chip'}
                      onClick={function () { patchDraft(i, { mode: it[0] }); }}>{it[1]}</button>
                  );
                })}
                {d.mode !== 'all' ? (
                  <button
                    className={d.openEnded ? 'chip on' : 'chip'}
                    onClick={function () { patchDraft(i, { openEnded: !d.openEnded }); }}
                  >不设结束</button>
                ) : null}
              </div>
            </div>

            {d.mode === 'range' && !d.openEnded ? (
              <div className="field" style={{ marginBottom: 10 }}>
                <div className="row">
                  <input className="input" type="number" min={1} max={total} value={d.from}
                    onChange={function (e) { patchDraft(i, { from: Number(e.target.value) }); }} />
                  <span className="muted small">到</span>
                  <input className="input" type="number" min={1} max={total} value={d.to}
                    onChange={function (e) { patchDraft(i, { to: Number(e.target.value) }); }} />
                  <span className="muted small">周</span>
                </div>
              </div>
            ) : null}

            <div className="field" style={{ marginBottom: 0 }}>
              <div className="field-label">教室</div>
              <input className="input" value={d.location} placeholder="例如：A301"
                onChange={function (e) { patchDraft(i, { location: e.target.value }); }} />
            </div>
          </div>
        );
      })}

      <button className="btn block" onClick={function () { setDrafts(function (p) { return p.concat([newDraft()]); }); }}>
        ＋ 再添加一个时段
      </button>
      <div className="panel-desc" style={{ padding: '10px 0 0' }}>
        同一门课可以有好几个时段（比如周一理论课、周三实验课），在这里一次录完。勾「不设结束」后这门课会一直重复，课表能翻到任意远的将来。
      </div>
    </Sheet>
  );
}
