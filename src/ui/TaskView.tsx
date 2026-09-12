import React from 'react';
import { openTask, toggleTask, useApp } from '../app/store';
import { todayISO } from '../core/engine';
import type { Task } from '../core/types';
import { Icon } from './icons';

function dueInfo(t: Task): { text: string; state: 'overdue' | 'today' | 'soon' | 'later' | 'none' } {
  if (!t.due) return { text: '无期限', state: 'none' };
  const today = todayISO();
  const due = t.due;
  const diff = Math.round((new Date(due).getTime() - new Date(today).getTime()) / 86400000);
  const hm = t.dueMinutes === undefined ? '23:59' : ('0' + Math.floor(t.dueMinutes / 60)).slice(-2) + ':' + ('0' + (t.dueMinutes % 60)).slice(-2);
  const md = due.slice(5).replace('-', '/');
  if (diff < 0) return { text: '逾期 ' + (-diff) + ' 天 · ' + md, state: 'overdue' };
  if (diff === 0) return { text: '今天 ' + hm, state: 'today' };
  if (diff === 1) return { text: '明天 ' + hm, state: 'soon' };
  if (diff <= 7) return { text: diff + ' 天后 · ' + md, state: 'soon' };
  return { text: md + ' · ' + hm, state: 'later' };
}

const STATE_COLOR: Record<string, string> = {
  overdue: 'var(--c-danger)',
  today: '#FF7D00',
  soon: 'var(--c-text)',
  later: 'var(--c-text-muted)',
  none: 'var(--c-text-muted)',
};

export default function TaskView() {
  const s = useApp();
  const tasks = s.data.tasks || [];
  const [showDone, setShowDone] = React.useState(false);

  const open = tasks.filter(function (t) { return !t.done; }).sort(function (a, b) {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  });
  const done = tasks.filter(function (t) { return t.done; });
  const overdue = open.filter(function (t) { return dueInfo(t).state === 'overdue'; }).length;

  function courseName(id?: string): string {
    if (!id) return '';
    const c = s.data.courses.find(function (x) { return x.id === id; });
    return c ? c.name : '';
  }

  function Row(props: { t: Task }) {
    const t = props.t;
    const info = dueInfo(t);
    return (
      <div className={t.done ? 'task-row done' : 'task-row'}>
        <button
          className={t.done ? 'task-check on' : 'task-check'}
          onClick={function () { toggleTask(t.id); }}
          aria-label={t.done ? '标记未完成' : '标记完成'}
        >{t.done ? '✓' : ''}</button>
        <div className="task-main" onClick={function () { openTask(t.id); }}>
          <div className={t.done ? 'task-title done' : 'task-title'}>{t.title}</div>
          <div className="task-sub">
            <span style={{ color: STATE_COLOR[info.state], fontWeight: info.state === 'overdue' || info.state === 'today' ? 700 : 400 }}>
              {info.text}
            </span>
            {t.courseId ? <span className="muted"> · {courseName(t.courseId)}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {overdue > 0 ? (
        <div className="warn-bar">
          <div className="warn-badge">!</div>
          <div>
            <div className="warn-title">有 {overdue} 项已经逾期</div>
            <div className="warn-item">逾期的任务在系统通知里也会提醒（提前一天 / 提前两小时）</div>
          </div>
        </div>
      ) : null}

      <div className="section-title">待完成 · {open.length}</div>
      {open.length === 0 ? (
        <div className="empty">
          <Icon name="check" size={30} className="empty-emoji" />
          <div className="empty-title">没有待办</div>
          <div className="tiny">点右下角的 ＋ 添加作业或 DDL</div>
        </div>
      ) : (
        <div className="card-block">{open.map(function (t) { return <Row key={t.id} t={t} />; })}</div>
      )}

      {done.length > 0 ? (
        <React.Fragment>
          <div className="section-title" style={{ cursor: 'pointer' }} onClick={function () { setShowDone(!showDone); }}>
            已完成 · {done.length} {showDone ? '▾' : '▸'}
          </div>
          {showDone ? <div className="card-block">{done.map(function (t) { return <Row key={t.id} t={t} />; })}</div> : null}
        </React.Fragment>
      ) : null}

      <div className="panel-desc" style={{ padding: '14px 2px 0' }}>
        带截止日期的任务会自动进入提醒排程，可以在「设置 → 提醒通道 → 接下来的提醒」里看到。
      </div>
    </div>
  );
}
