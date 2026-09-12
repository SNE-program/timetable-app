import React from 'react';
import {
  clearReminderRule, closeSheets, deleteOverride, setReminderRule, showToast, upsertOverride, useApp,
} from '../app/store';
import { mostSpecificRule, offsetsFor } from '../core/reminders';
import { occurrencesOf, shortDateLabel, toISODate, addDays, parseISODate } from '../core/engine';
import type { OverrideAction } from '../core/types';
import { DateField, Picker, Sheet } from './common';

type Action = 'cancel' | 'roomChange' | 'time' | 'move';

const ACTION_LABEL: Record<Action, string> = {
  cancel: '停课一次',
  roomChange: '换教室',
  time: '改节次',
  move: '改到别的时间',
};

export default function OverrideSheet(props: { sessionId: string }) {
  const s = useApp();
  const session = s.data.sessions.find(function (x) { return x.id === props.sessionId; });
  const course = session ? s.data.courses.find(function (c) { return c.id === session.courseId; }) : undefined;
  const scheme = s.data.schemes.find(function (x) { return x.id === s.data.term.periodSchemeId; }) || s.data.schemes[0];

  const occurrences = React.useMemo(function () {
    return occurrencesOf(s.data, props.sessionId, toISODate(new Date()), 10);
  }, [props.sessionId]);

  const [date, setDate] = React.useState<string>(occurrences.length ? occurrences[0] : toISODate(new Date()));
  const [action, setAction] = React.useState<Action>('cancel');
  const [location, setLocation] = React.useState('');
  const [p1, setP1] = React.useState(session ? session.periodStart : 1);
  const [p2, setP2] = React.useState(session ? session.periodEnd : 2);
  const [newDate, setNewDate] = React.useState(function () {
    const base = occurrences.length ? occurrences[0] : toISODate(new Date());
    return toISODate(addDays(parseISODate(base), 1));
  });
  const [reason, setReason] = React.useState('');

  const prefsObj = {
    reminderOffsets: s.prefs.reminderOffsets,
    dailyBrief: s.prefs.dailyBrief,
    briefHour: s.prefs.briefHour,
  };
  const [remind, setRemind] = React.useState<number[]>(function () {
    return session ? offsetsFor(s.data.reminderRules, props.sessionId, session.courseId, prefsObj) : [];
  });
  const sessionRule = mostSpecificRule(s.data.reminderRules, props.sessionId, session ? session.courseId : '');

  if (!session || !course) return null;

  const existing = s.data.overrides.filter(function (o) { return o.sessionId === props.sessionId; });

  function describe(o: { action: OverrideAction; patch?: Record<string, unknown> }): string {
    if (o.action === 'cancel') return '停课';
    if (o.action === 'roomChange') return '换到 ' + String((o.patch && o.patch.location) || '');
    const p = o.patch || {};
    if (p.newDate) return '改到 ' + String(p.newDate) + ' 第 ' + String(p.periodStart || '') + '-' + String(p.periodEnd || '') + ' 节';
    return '改为第 ' + String(p.periodStart || '') + '-' + String(p.periodEnd || '') + ' 节';
  }

  function save() {
    const base = { sessionId: props.sessionId, date: date, reason: reason.trim() || undefined };
    if (action === 'cancel') {
      upsertOverride(Object.assign({ action: 'cancel' as OverrideAction }, base));
    } else if (action === 'roomChange') {
      if (!location.trim()) { showToast('请填写新的教室', 'warn'); return; }
      upsertOverride(Object.assign({ action: 'roomChange' as OverrideAction, patch: { location: location.trim() } }, base));
    } else if (action === 'time') {
      upsertOverride(Object.assign({ action: 'reschedule' as OverrideAction, patch: { periodStart: p1, periodEnd: p2 } }, base));
    } else {
      if (!newDate) { showToast('请选择改到哪一天', 'warn'); return; }
      upsertOverride(Object.assign({
        action: 'reschedule' as OverrideAction,
        patch: { newDate: newDate, periodStart: p1, periodEnd: p2, location: location.trim() || undefined },
      }, base));
    }
    closeSheets();
  }

  return (
    <Sheet title="调整某一次课" onClose={closeSheets}>
      <div className="panel-desc" style={{ padding: '0 0 12px' }}>
        {course.name} · 周{'一二三四五六日'[session.dayOfWeek - 1]} 第 {session.periodStart}-{session.periodEnd} 节
        {session.location ? ' · ' + session.location : ''}
      </div>

      <div className="section-title">调整哪一次</div>
      {occurrences.length === 0 ? (
        <div className="panel-desc">这门课在未来没有可调整的安排（可能周次已经结束）。</div>
      ) : (
        <div className="chip-row" style={{ padding: '0 0 4px' }}>
          {occurrences.map(function (d) {
            const has = existing.some(function (o) { return o.date === d && o.action === 'cancel'; });
            return (
              <button key={d} className={date === d ? 'chip on' : 'chip'} onClick={function () { setDate(d); }}>
                {shortDateLabel(d)}{has ? ' · 已停' : ''}
              </button>
            );
          })}
        </div>
      )}

      <div className="section-title">怎么调整</div>
      <div className="chip-row" style={{ padding: '0 0 4px' }}>
        {(['cancel', 'roomChange', 'time', 'move'] as Action[]).map(function (a) {
          return (
            <button key={a} className={action === a ? 'chip on' : 'chip'} onClick={function () { setAction(a); }}>
              {ACTION_LABEL[a]}
            </button>
          );
        })}
      </div>

      {action === 'roomChange' ? (
        <div className="field" style={{ marginTop: 12 }}>
          <div className="field-label">新教室</div>
          <input className="input" value={location} placeholder="例如：B202" onChange={function (e) { setLocation(e.target.value); }} />
        </div>
      ) : null}

      {action === 'time' || action === 'move' ? (
        <div className="field" style={{ marginTop: 12 }}>
          <div className="field-label">节次</div>
          <div className="row">
            <Picker
              compact title="开始节次" value={p1}
              options={scheme.periods.map(function (p) { return { value: p.index, label: '第 ' + p.index + ' 节', sub: p.start }; })}
              onChange={setP1}
            />
            <span className="muted small">到</span>
            <Picker
              compact title="结束节次" value={p2}
              options={scheme.periods.map(function (p) { return { value: p.index, label: '第 ' + p.index + ' 节', sub: p.end }; })}
              onChange={setP2}
            />
          </div>
        </div>
      ) : null}

      {action === 'move' ? (
        <div className="field">
          <div className="field-label">补到哪一天</div>
          <DateField title="补到哪一天" clearable={false} value={newDate} onChange={setNewDate} />
          <div className="field-label" style={{ marginTop: 6 }}>原来的那一次会自动从课表上消失</div>
        </div>
      ) : null}

      <div className="field">
        <div className="field-label">原因（选填）</div>
        <input className="input" value={reason} placeholder="例如：教师出差 / 场地冲突" onChange={function (e) { setReason(e.target.value); }} />
      </div>

      <button className="btn primary block" style={{ marginTop: 4 }} onClick={save}>保存调整</button>

      <div className="section-title">这一个时段的提醒</div>
      <div className="card-block" style={{ marginBottom: 14 }}>
        <div className="chip-row">
          {[30, 15, 10, 5].map(function (m) {
            const on = remind.indexOf(m) >= 0;
            return (
              <button
                key={m}
                className={on ? 'chip on' : 'chip'}
                onClick={function () {
                  const next = on ? remind.filter(function (x) { return x !== m; }) : remind.concat([m]).sort(function (a, b) { return b - a; });
                  setRemind(next);
                  setReminderRule('session', props.sessionId, next, next.length > 0);
                }}
              >课前 {m} 分钟</button>
            );
          })}
        </div>
        <div className="list-row">
          <div>
            <div className="lr-label">{sessionRule && sessionRule.scope === 'session' ? '已单独设置' : '跟随课程 / 全局'}</div>
            <div className="lr-sub">
              {sessionRule && sessionRule.scope === 'session'
                ? '只有这一个时段用这套提醒'
                : '全局默认：' + (s.prefs.reminderOffsets.length ? s.prefs.reminderOffsets.join(' / ') + ' 分钟' : '未开启')}
            </div>
          </div>
          {sessionRule && sessionRule.scope === 'session' ? (
            <div className="lr-right">
              <button
                className="btn sm ghost"
                onClick={function () {
                  clearReminderRule('session', props.sessionId);
                  setRemind(s.prefs.reminderOffsets);
                  showToast('已恢复跟随课程设置', 'ok');
                }}
              >恢复默认</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="section-title">这门课已有的调整 · {existing.length}</div>
      <div className="card-block">
        {existing.length === 0 ? (
          <div className="list-row"><div className="lr-sub">还没有调整记录</div></div>
        ) : existing.map(function (o) {
          return (
            <div className="list-row" key={o.id}>
              <div>
                <div className="lr-label">{shortDateLabel(o.date)} · {describe(o as { action: OverrideAction; patch?: Record<string, unknown> })}</div>
                <div className="lr-sub">{o.reason || '未填原因'}</div>
              </div>
              <div className="spacer" />
              <button className="btn sm ghost" onClick={function () { deleteOverride(o.id); }}>撤销</button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
