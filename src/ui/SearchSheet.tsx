import React from 'react';
import { closeSheets, openCourse, openTask, setWeek, jumpToDate, useApp } from '../app/store';
import { occurrencesOf, shortDateLabel, todayISO, weekOfDate } from '../core/engine';
import { courseColor, resolvePalette } from '../theme/palette';
import { Sheet } from './common';
import { Icon } from './icons';

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

export default function SearchSheet() {
  const s = useApp();
  const [q, setQ] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const palette = resolvePalette(s.theme, s.systemDark);

  React.useEffect(function () { if (inputRef.current) inputRef.current.focus(); }, []);

  const query = q.trim().toLowerCase();
  const has = query.length > 0;

  const courseHits = !has ? [] : s.data.courses.filter(function (c) {
    if (c.name.toLowerCase().indexOf(query) >= 0) return true;
    if (c.teacher && c.teacher.toLowerCase().indexOf(query) >= 0) return true;
    return s.data.sessions.some(function (x) {
      return x.courseId === c.id && (x.location || '').toLowerCase().indexOf(query) >= 0;
    });
  });

  const taskHits = !has ? [] : (s.data.tasks || []).filter(function (t) {
    return t.title.toLowerCase().indexOf(query) >= 0;
  });

  const total = courseHits.length + taskHits.length;

  return (
    <Sheet title="搜索" onClose={closeSheets}>
      <input
        ref={inputRef}
        className="input search-input"
        value={q}
        placeholder="课程名 / 教师 / 教室 / 任务"
        onChange={function (e) { setQ(e.target.value); }}
      />

      {!has ? (
        <div className="panel-desc" style={{ padding: '14px 0 0' }}>
          输入课程名称、教师或教室即可查找。
        </div>
      ) : total === 0 ? (
        <div className="empty" style={{ padding: '36px 12px' }}>
          <Icon name="search" size={30} className="empty-emoji" />
          <div className="empty-title">没有找到「{q}」</div>
        </div>
      ) : null}

      {courseHits.length > 0 ? (
        <React.Fragment>
          <div className="section-title">课程 · {courseHits.length}</div>
          <div className="card-block">
            {courseHits.map(function (c) {
              const cc = courseColor(palette, c.colorIndex);
              const sess = s.data.sessions.filter(function (x) { return x.courseId === c.id; });
              const next = occurrencesOf(s.data, sess.length ? sess[0].id : '', todayISO(), 1)[0];
              return (
                <div className="result-row" key={c.id} onClick={function () { openCourse(c.id); }}>
                  <div className="result-bar" style={{ background: cc }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="lr-label ellipsis">{c.name}</div>
                    <div className="lr-sub">
                      {sess.map(function (x, i) {
                        return (i > 0 ? ' / ' : '') + '周' + WEEKDAY_CN[x.dayOfWeek - 1] + ' ' + x.periodStart + '-' + x.periodEnd + ' 节' + (x.location ? ' ' + x.location : '');
                      }).join('')}
                    </div>
                    {next ? <div className="lr-sub">下次：{shortDateLabel(next)}</div> : null}
                  </div>
                  {next ? (
                    <div className="lr-right">
                      <button
                        className="btn sm"
                        onClick={function (e) { e.stopPropagation(); jumpToDate(next); closeSheets(); }}
                      >跳到第 {weekOfDate(s.data.term, next)} 周</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </React.Fragment>
      ) : null}

      {taskHits.length > 0 ? (
        <React.Fragment>
          <div className="section-title">任务 · {taskHits.length}</div>
          <div className="card-block">
            {taskHits.map(function (t) {
              return (
                <div className="result-row" key={t.id} onClick={function () { openTask(t.id); }}>
                  <div className="result-bar" style={{ background: t.done ? 'var(--c-border-strong)' : (t.due ? '#FF7D00' : 'var(--c-accent)') }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="lr-label ellipsis">{t.title}</div>
                    <div className="lr-sub">{t.done ? '已完成' : (t.due ? '截止 ' + t.due : '无期限')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </React.Fragment>
      ) : null}
    </Sheet>
  );
}
