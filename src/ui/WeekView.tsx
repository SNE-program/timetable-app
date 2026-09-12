import React from 'react';
import {
  jumpToDate, openAdd, openCourse, openOverride, openScheme, setTab, setWeek, shareWeekImage, useApp,
} from '../app/store';
import {
  dateOf, dayOfWeekOf, expandWeek, parseISODate, shortDateLabel, toISODate, toMinutes, todayISO,
  weekConflicts, weekLimitOf, weekOfDate,
} from '../core/engine';
import { MAX_WEEK } from '../core/types';
import type { ConcreteEvent, Course, DayOfWeek } from '../core/types';
import { adjust, readableOn, withAlpha } from '../theme/color';
import { courseColor, resolvePalette } from '../theme/palette';
import { resolveDark, type Theme } from '../theme/tokens';
import { useCourseMap, useMinuteClock } from './useMinuteClock';
import { DateField } from './common';
import { Icon } from './icons';
import { countRender } from '../app/renderCount';

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

function eventStyle(e: ConcreteEvent, course: Course | undefined, theme: Theme, palette: string[], dark: boolean, days: number): React.CSSProperties {
  const cc = courseColor(palette, e.colorIndex);
  const style: Record<string, string> = {
    left: 'calc((100% / ' + days + ') * ' + (e.dayOfWeek - 1) + ' + var(--gap) / 2)',
    width: 'calc(100% / ' + days + ' - var(--gap))',
    top: 'calc(var(--row-h) * ' + (e.periodStart - 1) + ' + 2px)',
    height: 'calc(var(--row-h) * ' + (e.periodEnd - e.periodStart + 1) + ' - var(--gap))',
    '--cc': cc,
    '--cc2': adjust(cc, -16, 4),
    '--cc-on': readableOn(cc),
    '--cc-soft': withAlpha(cc, dark ? 0.32 : 0.2),
    '--cc-soft-line': withAlpha(cc, 0.42),
    '--cc-fill': withAlpha(cc, dark ? 0.14 : 0.07),
  };
  if (course && course.image && theme.cardStyle !== 'outline') style.backgroundImage = 'none';
  return style as React.CSSProperties;
}

function EventCard(props: { e: ConcreteEvent; course: Course | undefined; theme: Theme; palette: string[]; dark: boolean; days: number }) {
  const e = props.e;
  const course = props.course;
  const hasImage = !!(course && course.image && props.theme.cardStyle !== 'outline');
  const style = eventStyle(e, course, props.theme, props.palette, props.dark, props.days);
  const cls = 'ev' + (hasImage ? ' has-image' : '');
  /* 屏幕阅读器没法"看"卡片长什么样，一句话把它说全：课程、第几节、时间、地点、教师 */
  const cardLabel = e.title
    + '，第 ' + e.periodStart + (e.periodEnd !== e.periodStart ? '-' + e.periodEnd : '') + ' 节'
    + '，' + e.start + ' 到 ' + e.end
    + (e.location ? '，' + e.location : '')
    + (props.theme.showTeacher && e.teacher ? '，' + e.teacher : '')
    + (e.modifiedBy ? '，已调整' : '');
  /* 长按 500ms 直接进调课面板；长按触发后抑制随后的 click */
  const timer = React.useRef<number | null>(null);
  const longPressed = React.useRef(false);
  const startAt = React.useRef({ x: 0, y: 0 });

  function pressStart(ev: React.PointerEvent) {
    longPressed.current = false;
    startAt.current = { x: ev.clientX, y: ev.clientY };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(function () {
      timer.current = null;
      longPressed.current = true;
      openOverride(e.sessionId);
    }, 600);
  }
  /* 手指挪动超过 10px 说明是在滚动 / 拖拽，不算长按 */
  function pressMove(ev: React.PointerEvent) {
    if (timer.current === null) return;
    const dx = ev.clientX - startAt.current.x;
    const dy = ev.clientY - startAt.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function pressEnd() {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  }
  return (
    /*
     * 课程卡是 div 而不是 button（里面还有长按手势、图层、绝对定位），
     * 所以要把"它其实是个可点按钮"这件事显式告诉辅助技术：
     * role + tabIndex + 键盘事件 + 一句能读出来的完整描述。
     * 只加 role 不加键盘处理的话，键盘用户反而更难受 —— 能聚焦却打不开。
     */
    <div
      className={cls}
      data-style={hasImage ? 'image' : props.theme.cardStyle}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={cardLabel}
      onClick={function () { if (longPressed.current) { longPressed.current = false; return; } if (course) openCourse(course.id); }}
      onKeyDown={function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        if (course) openCourse(course.id);
      }}
      onPointerDown={pressStart}
      onPointerMove={pressMove}
      onPointerUp={pressEnd}
      onPointerLeave={pressEnd}
      onPointerCancel={pressEnd}
      title={e.title + ' ' + e.start + '-' + e.end + (e.location ? ' @ ' + e.location : '')}
    >
      {hasImage ? <div className="ev-bg" style={{ backgroundImage: 'url("' + course!.image + '")' }} /> : null}
      {hasImage ? <div className="ev-veil" /> : null}
      <div className="ev-body">
        <div className="ev-name">{e.title}</div>
        {e.location ? <div className="ev-room">{e.location}</div> : null}
        {props.theme.showTeacher && e.teacher ? <div className="ev-teacher">{e.teacher}</div> : null}
      </div>
      {e.modifiedBy ? <div className="ev-flag">已调</div> : null}
    </div>
  );
}

export default function WeekView() {
  countRender('WeekView');
  const s = useApp();
  const data = s.data;
  const theme = s.theme;
  const today = todayISO();
  const nowWeek = weekOfDate(data.term, today);
  const nowDow = dayOfWeekOf(parseISODate(today));
  const days = theme.showDays || (theme.showWeekend ? 7 : 5);

  /* 每分钟对齐刷新一次：以前 nowTop 只在"碰巧有别的状态变化"时才重算，
     屏幕不动时那条"现在"横线是冻住的。 */
  const clock = useMinuteClock();
  const courseById = useCourseMap(data.courses);

  const scheme = React.useMemo(function () {
    return data.schemes.find(function (x) { return x.id === data.term.periodSchemeId; }) || data.schemes[0];
  }, [data.schemes, data.term.periodSchemeId]);
  const periods = scheme.periods;
  const dark = resolveDark(theme.modePref, s.systemDark);
  const palette = React.useMemo(function () { return resolvePalette(theme, s.systemDark); }, [theme, s.systemDark]);

  /* 这三个原来每次渲染都重算 —— 连 stats 的 useMemo 都因为 events 每次是新数组而永远不命中 */
  const events = React.useMemo(function () {
    return expandWeek(data, s.week).filter(function (e) { return e.dayOfWeek <= days; });
  }, [data, s.week, days]);
  const conflicts = React.useMemo(function () { return weekConflicts(data, s.week); }, [data, s.week]);

  const stats = React.useMemo(function () {
    const totalMin = events.reduce(function (sum, e) { return sum + (e.endMinutes - e.startMinutes); }, 0);
    const perDay = [1, 2, 3, 4, 5, 6, 7].map(function (d) {
      return { d: d, n: events.filter(function (e) { return e.dayOfWeek === d; }).length };
    });
    let busiest = perDay[0];
    let lightest: { d: number; n: number } | null = null;
    for (const x of perDay) {
      if (x.n > busiest.n) busiest = x;
      if (x.n > 0 && (!lightest || x.n < lightest.n)) lightest = x;
    }
    return {
      count: events.length,
      hours: Math.round(totalMin / 60 * 10) / 10,
      activeDays: perDay.filter(function (x) { return x.n > 0; }).length,
      busiest: busiest,
      lightest: lightest,
    };
  }, [events]);

  let nowTop: number | null = null;
  if (s.week === nowWeek && nowDow <= days) {
    const nowMin = clock.getHours() * 60 + clock.getMinutes();
    const dayStart = toMinutes(periods[0].start);
    const dayEnd = toMinutes(periods[periods.length - 1].end);
    if (nowMin >= dayStart - 30 && nowMin <= dayEnd + 30) {
      const frac = Math.min(1, Math.max(0, (nowMin - dayStart) / (dayEnd - dayStart)));
      nowTop = frac * 100;
    }
  }

  const touch = React.useRef<{ x: number; y: number } | null>(null);
  function onDown(ev: React.PointerEvent) {
    /* 从课程卡、按钮、输入框上开始的拖动多半不是想翻周，忽略掉 */
    const t = ev.target as HTMLElement;
    if (t.closest('.ev') || t.closest('button') || t.closest('input') || t.closest('.chip')) {
      touch.current = null;
      return;
    }
    touch.current = { x: ev.clientX, y: ev.clientY };
  }
  function onUp(ev: React.PointerEvent) {
    const t0 = touch.current;
    touch.current = null;
    if (!t0) return;
    const dx = ev.clientX - t0.x;
    const dy = ev.clientY - t0.y;
    if (Math.abs(dx) > 72 && Math.abs(dy) < 40) {
      const next = s.week + (dx < 0 ? 1 : -1);
      /**
       * 原来写的是 `next <= data.term.totalWeeks`。totalWeeks 是可选的
       * （学期"不设结束"时就是 undefined），而 `n <= undefined` 恒为 false ——
       * 于是不设结束的学期**右滑翻周直接失效**。
       * 时间轴本来就是无限延伸的，clampWeek 也只按 [1, MAX_WEEK] 夹，
       * 这里跟它对齐就好。
       */
      const limit = Math.min(MAX_WEEK, weekLimitOf(data.term));
      if (next >= 1 && next <= limit) setWeek(next);
    }
  }

  return (
    <div className="week-scroll">
      <div className="week-bar">
        <DateField
          className="jump-date"
          title="跳到某一天所在的那一周"
          clearable={false}
          value={toISODate(dateOf(data.term, s.week, 1))}
          onChange={function (v) { if (v) jumpToDate(v); }}
        />
        <span className="week-range">第 {s.week} 周</span>
        <div className="spacer" />
        {s.week !== nowWeek ? (
          <button className="btn sm ghost" onClick={function () { setWeek(nowWeek); }}>回到本周</button>
        ) : null}
        <button className="btn sm" onClick={function () { void shareWeekImage(); }}>分享</button>
      </div>

      {s.notify && (s.notify.permission === 'default' || s.notify.permission === 'denied') && data.sessions.length > 0 ? (
        <div className="warn-bar" style={{ marginBottom: 8 }}>
          <div className="warn-badge">!</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="warn-title">上课提醒还没开启</div>
            <div className="warn-item">没有通知权限，到点不会有任何提示</div>
          </div>
          <button className="btn sm primary" onClick={function () { setTab('settings'); }}>去开启</button>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="warn-bar">
          <div className="warn-badge">!</div>
          <div style={{ minWidth: 0 }}>
            <div className="warn-title">本周有 {conflicts.length} 处安排冲突</div>
            {conflicts.slice(0, 3).map(function (c, i) {
              return <div className="warn-item" key={i}>{shortDateLabel(c.date)} · {c.message}</div>;
            })}
            {conflicts.length > 3 ? <div className="warn-item">还有 {conflicts.length - 3} 处…</div> : null}
          </div>
        </div>
      ) : null}

      <div className="week-head">
        <button className="axis-spacer" onClick={openScheme} title="点这里修改每节课的上课时间"><Icon name="settings" size={13} /></button>
        <div className="days-head">
          {Array.from({ length: days }).map(function (_, i) {
            const dow = (i + 1) as DayOfWeek;
            const date = dateOf(data.term, s.week, dow);
            const isToday = s.week === nowWeek && dow === nowDow;
            return (
              <div key={i} className={isToday ? 'wk-day today' : 'wk-day'}>
                <div className="wd">周{WEEKDAY_CN[i]}</div>
                <div className="dd">{date.getDate()}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="week-grid"
        onPointerDown={onDown}
        onPointerUp={onUp}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="axis" onClick={openScheme} title="点这里修改每节课的上课时间">
          {periods.map(function (p) {
            return (
              <div className="axis-cell" key={p.index}>
                <div className="ai">{p.index}</div>
                <div className="at">{p.start}</div>
              </div>
            );
          })}
        </div>
        <div
          className="days"
          style={{
            ['--cols']: String(days),
            ['--colw']: (100 / days) + '%',
            ['--periods']: String(periods.length),
          } as React.CSSProperties}
        >
          {s.week === nowWeek && nowDow <= days ? (
            <div
              className="today-col"
              style={{
                left: 'calc(100% / ' + days + ' * ' + (nowDow - 1) + ')',
                width: 'calc(100% / ' + days + ')',
              }}
            />
          ) : null}
          {events.map(function (e) {
            return <EventCard key={e.key} e={e} course={courseById.get(e.courseId)} theme={theme} palette={palette} dark={dark} days={days} />;
          })}
          {nowTop !== null ? (
            <div
              className="now-line"
              style={{
                left: 'calc(100% / ' + days + ' * ' + (nowDow - 1) + ')',
                width: 'calc(100% / ' + days + ')',
                top: nowTop + '%',
              }}
            />
          ) : null}
        </div>
      </div>
      {events.length > 0 ? (
        <div className="stat-row">
          <div className="stat"><b>{stats.count}</b><span>节课</span></div>
          <div className="stat"><b>{stats.hours}</b><span>小时</span></div>
          <div className="stat"><b>{stats.activeDays}</b><span>天有课</span></div>
          <div className="stat"><b>周{'一二三四五六日'[stats.busiest.d - 1]}</b><span>最忙 {stats.busiest.n} 节</span></div>
        </div>
      ) : null}

      {events.length === 0 ? (
        data.sessions.length === 0 ? (
          <div className="empty">
            <Icon name="clipboard" size={30} className="empty-emoji" />
            <div className="empty-title">课表还是空的</div>
            <div className="tiny">添加第一门课，课表与上课提醒会自动排好</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={openAdd}>添加第一门课</button>
            </div>
          </div>
        ) : (
          <div className="empty">
            <Icon name="leaf" size={30} className="empty-emoji" />
            <div className="empty-title">第 {s.week} 周没有课</div>
            <div className="tiny">
              {data.term.totalWeeks !== undefined && s.week > data.term.totalWeeks
                ? '这一周已经超出学期范围了（共 ' + data.term.totalWeeks + ' 周）'
                : '本周没有安排，可切换到其他周次查看'}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
