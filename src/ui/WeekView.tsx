import React from 'react';
import {
  jumpToDate, openAdd, openCourse, openOverride, openScheme, setTab, setWeek, shareWeekImage, showToast,
  upsertOverride, useApp,
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

/** 一次拖动的进行态。只服务于「改天 / 改节次」这件事，别的一概不做 */
interface DragState {
  sessionId: string;
  /** 这一次课原本的日期（ISO） */
  date: string;
  title: string;
  /** 拖动前的节次，用于算"有没有真的变" */
  fromStart: number;
  fromEnd: number;
  fromDay: number;
  /** 拖动模式：整块移动 / 拖上边缘改开始 / 拖下边缘改结束 */
  mode: 'move' | 'resize-top' | 'resize-bottom';
  /** 抓住的位置在卡片内占了几行（移动时保持手感：抓哪就跟着哪） */
  grabRowOffset: number;
  /** 当前预览到的目标 */
  toDay: number;
  toStart: number;
  toEnd: number;
  /** 这张卡上已有的调整（合并时要保留，别把用户之前改的抹掉） */
  existingPatch: Record<string, unknown>;
  existingReason?: string;
}

/** 卡片上、下边缘这么多像素之内算"拉伸"，其余算"整块移动" */
const EDGE_PX = 18;
/** 长按多久进入"准备拖动"（松手不改动就是原来的调课面板） */
const HOLD_MS = 420;
/** 触屏上挪动超过这么多像素就认为是在滚动，不再算拖动 */
const SCROLL_SLOP = 10;
/** 鼠标不需要长按：按下后移动超过这么多像素就开始拖 */
const MOUSE_SLOP = 6;

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v);
}

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

function EventCard(props: {
  e: ConcreteEvent; course: Course | undefined; theme: Theme; palette: string[]; dark: boolean; days: number;
  /**
   * 手势交给外面：周视图那边才知道网格几何（一天多宽、一节多高），
   * 卡片只报告"按下 / 移动 / 松手"三件事，不自己算坐标。
   */
  onGrabStart: (e: ConcreteEvent, mode: DragState['mode'], ev: React.PointerEvent, card: DOMRect) => void;
  onGrabMove: (ev: React.PointerEvent) => boolean;
  onGrabEnd: (moved: boolean) => boolean;
}) {
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
  /*
   * 三种手势共用一次按下：
   *
   *   长按（420ms）→ 卡片"拿起来"（略微抬起）：此时**松手 = 打开调课面板**（老行为不变），
   *                    **移动 = 拖动**（改天 / 改节次）；
   *   鼠标：不用长按，按下后移动 6px 就开始拖 —— 桌面上拖东西本来就该是直接的；
   *   轻点：什么都没发生，交给 click（打开课程详情）。
   *
   * 手指在长按期间挪动超过 10px 就当作在滚动（横滑翻周是周视图自己的手势），
   * 直接放弃这次拖动 —— 否则"想翻周却把课拖走了"。
   */
  const timer = React.useRef<number | null>(null);
  const longPressed = React.useRef(false);
  const held = React.useRef(false);
  /** 已经真的拖动过（决定松手后要不要抑制 click） */
  const dragged = React.useRef(false);
  const startAt = React.useRef({ x: 0, y: 0 });

  /**
   * 落在卡片上/下边缘算"拉伸"，中间算"整块移动"。
   *
   * 边缘宽度要**按卡高收一收**：一节的小卡只有 50 多像素高，固定 18px 会让
   * 上下两条边缘吃掉整张卡 —— 那种情况下永远拖不动整块，只能改节数。
   */
  function modeAt(ev: React.PointerEvent): DragState['mode'] {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const edge = Math.min(EDGE_PX, Math.max(8, r.height / 3));
    if (ev.clientY - r.top <= edge) return 'resize-top';
    if (r.bottom - ev.clientY <= edge) return 'resize-bottom';
    return 'move';
  }

  function pressStart(ev: React.PointerEvent) {
    longPressed.current = false;
    held.current = false;
    dragged.current = false;
    startAt.current = { x: ev.clientX, y: ev.clientY };
    const card = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const mode = modeAt(ev);
    if (ev.pointerType === 'mouse') {
      /* 鼠标：按下就先记一笔，等移动够远再真正开始拖 */
      props.onGrabStart(e, mode, ev, card);
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(function () {
      timer.current = null;
      held.current = true;
      props.onGrabStart(e, mode, ev, card);
    }, HOLD_MS);
  }

  function pressMove(ev: React.PointerEvent) {
    const dx = ev.clientX - startAt.current.x;
    const dy = ev.clientY - startAt.current.y;
    if (held.current || ev.pointerType === 'mouse') {
      /* 父组件说"够远了、开始拖"，之后这次手势就不再是点击 */
      if (props.onGrabMove(ev)) dragged.current = true;
      return;
    }
    if (timer.current === null) return;
    if (Math.abs(dx) > SCROLL_SLOP || Math.abs(dy) > SCROLL_SLOP) {
      window.clearTimeout(timer.current);
      timer.current = null;
      props.onGrabEnd(false);
    }
  }

  function pressEnd(): void {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    /* 真的拖动过：结束这次拖动，并抑制后面那一下 click（否则松手会顺手打开课程详情） */
    if (dragged.current) {
      dragged.current = false;
      longPressed.current = true;
      props.onGrabEnd(true);
      return;
    }
    /* 长按过但没移动：老行为 —— 打开「调整某一次课」 */
    const wasHeld = held.current;
    held.current = false;
    props.onGrabEnd(false);
    if (wasHeld) openOverride(e.sessionId);
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
      /* 位置信息落在 DOM 上：拖动自检（?dragcheck=1）要靠它挑样本、核对结果 */
      data-day={e.dayOfWeek}
      data-start={e.periodStart}
      data-end={e.periodEnd}
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

  /*
   * 拖动改课（v1.9.6）。
   *
   * 网格是百分比定位的（列 = 100%/天数，行 = --row-h），所以"指针落在哪个格子"
   * 完全由 .days 的矩形反算出来 —— 不去读每张卡的坐标，也就不会有"卡片错位导致算错"。
   *
   * 改动最终落在**一次调课（Override）**上，走的是和「调整某一次课」面板同一个入口：
   * 于是它自动进撤销栈、自动重排提醒，而且事后能一键恢复。
   */
  const daysRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<DragState | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  /** 指针按下时记下的几何信息（还没开始拖之前也要留着） */
  const pending = React.useRef<{ mode: DragState['mode']; x: number; y: number; grabRow: number } | null>(null);

  /** 指针 → 目标格子。取不到容器时返回 null（缩放/旋转的瞬间可能发生） */
  function cellAt(clientX: number, clientY: number): { day: number; row: number } | null {
    const el = daysRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const day = clampInt(Math.floor((clientX - r.left) / (r.width / days)) + 1, 1, days);
    const row = clampInt(Math.floor((clientY - r.top) / (r.height / periods.length)) + 1, 1, periods.length);
    return { day: day, row: row };
  }

  function grabStart(e: ConcreteEvent, mode: DragState['mode'], ev: React.PointerEvent, card: DOMRect): void {
    const rowH = card.height / Math.max(1, e.periodEnd - e.periodStart + 1);
    const grabRow = clampInt(Math.floor((ev.clientY - card.top) / Math.max(1, rowH)), 0, e.periodEnd - e.periodStart);
    const ov = (data.overrides || []).filter(function (o) { return o.id === e.modifiedBy; })[0];
    pending.current = { mode: mode, x: ev.clientX, y: ev.clientY, grabRow: grabRow };
    dragRef.current = {
      sessionId: e.sessionId,
      date: e.date,
      title: e.title,
      fromStart: e.periodStart,
      fromEnd: e.periodEnd,
      fromDay: e.dayOfWeek,
      mode: mode,
      grabRowOffset: grabRow,
      toDay: e.dayOfWeek,
      toStart: e.periodStart,
      toEnd: e.periodEnd,
      existingPatch: (ov && ov.patch ? ov.patch : {}) as Record<string, unknown>,
      existingReason: ov ? ov.reason : undefined,
    };
  }

  /** 返回 true 表示"够远了，这次手势算拖动"；父组件据此让卡片抑制 click */
  function grabMove(ev: React.PointerEvent): boolean {
    const p = pending.current;
    const d = dragRef.current;
    if (!p || !d) return false;
    const far = Math.abs(ev.clientX - p.x) + Math.abs(ev.clientY - p.y) >= MOUSE_SLOP;
    const cell = cellAt(ev.clientX, ev.clientY);
    if (!cell) return false;
    /* 触屏上是长按之后才开始拖（卡片那边已经把长按这一关过了），鼠标则看移动距离 */
    const active = ev.pointerType === 'mouse' ? far : true;
    if (!active) return false;

    const len = d.fromEnd - d.fromStart + 1;
    let toDay = d.fromDay;
    let toStart = d.fromStart;
    let toEnd = d.fromEnd;
    if (d.mode === 'move') {
      toDay = cell.day;
      toStart = clampInt(cell.row - d.grabRowOffset, 1, periods.length - len + 1);
      toEnd = toStart + len - 1;
    } else if (d.mode === 'resize-top') {
      toStart = clampInt(cell.row, 1, d.fromEnd);
      toEnd = d.fromEnd;
    } else {
      toStart = d.fromStart;
      toEnd = clampInt(cell.row, d.fromStart, periods.length);
    }
    if (toDay === d.toDay && toStart === d.toStart && toEnd === d.toEnd) return true;
    const next = Object.assign({}, d, { toDay: toDay, toStart: toStart, toEnd: toEnd });
    dragRef.current = next;
    setDrag(next);
    return true;
  }

  /**
   * 结束手势。
   *
   * 只有"目标真的和原来不一样"才写数据：鼠标点一下卡片、轻微抖两像素，
   * 不该产生一条调整记录（那会让撤销栈里全是垃圾）。
   */
  function grabEnd(commit: boolean): boolean {
    const d = dragRef.current;
    const p = pending.current;
    dragRef.current = null;
    pending.current = null;
    setDrag(null);
    if (!d || !p) return false;
    const moved = d.toDay !== d.fromDay || d.toStart !== d.fromStart || d.toEnd !== d.fromEnd;
    /* 自检（?dragcheck=1）要能看到这次拖动到底算出了什么 —— 拖动的失败方式大多是"数值没算对" */
    try {
      (window as unknown as { __lastDrag?: unknown }).__lastDrag = {
        title: d.title, sessionId: d.sessionId, date: d.date,
        mode: d.mode, fromDay: d.fromDay, fromStart: d.fromStart, fromEnd: d.fromEnd,
        toDay: d.toDay, toStart: d.toStart, toEnd: d.toEnd, moved: moved, commit: commit,
      };
    } catch (e) { /* 忽略 */ }
    if (!commit || !moved) return false;

    const patch: Record<string, unknown> = Object.assign({}, d.existingPatch, {
      periodStart: d.toStart,
      periodEnd: d.toEnd,
    });
    /* 换了天：写 dayOfWeek（同一教学周内换天），并把可能残留的 newDate 去掉 */
    if (d.toDay !== d.fromDay) {
      patch.dayOfWeek = d.toDay;
      delete patch.newDate;
    }
    upsertOverride({
      sessionId: d.sessionId,
      date: d.date,
      action: 'reschedule',
      patch: patch,
      reason: d.existingReason || '在课表上拖动调整',
    });
    return true;
  }

  /* Esc 取消拖动：拖到一半发现拖错了，不该被迫松手落下去 */
  React.useEffect(function () {
    if (!drag) return;
    function onKey(ev: KeyboardEvent): void {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      grabEnd(false);
      showToast('已取消这次拖动', 'info');
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [drag]);

  /** 拖动中的提示："→ 周三 第 3-4 节"，落在卡片上方的浮标里 */
  function dragHint(d: DragState): string {
    const bits: string[] = [];
    if (d.toDay !== d.fromDay) bits.push('周' + WEEKDAY_CN[d.toDay - 1]);
    if (d.toStart !== d.fromStart || d.toEnd !== d.fromEnd) {
      bits.push('第 ' + d.toStart + (d.toEnd !== d.toStart ? '-' + d.toEnd : '') + ' 节');
    }
    return bits.length > 0 ? bits.join(' · ') : '没有变化';
  }
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
          ref={daysRef}
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
            return (
              <EventCard
                key={e.key} e={e} course={courseById.get(e.courseId)} theme={theme} palette={palette}
                dark={dark} days={days}
                onGrabStart={grabStart} onGrabMove={grabMove} onGrabEnd={grabEnd}
              />
            );
          })}
          {/* 拖动预览：虚线框 + 一句"会变成什么"。位置用的是同一套百分比公式，所见即所得 */}
          {drag ? (
            <div
              className="ev-drag-ghost"
              style={{
                left: 'calc((100% / ' + days + ') * ' + (drag.toDay - 1) + ' + var(--gap) / 2)',
                width: 'calc(100% / ' + days + ' - var(--gap))',
                top: 'calc(var(--row-h) * ' + (drag.toStart - 1) + ' + 2px)',
                height: 'calc(var(--row-h) * ' + (drag.toEnd - drag.toStart + 1) + ' - var(--gap))',
              }}
            >
              <div className="ev-drag-label">{dragHint(drag)}</div>
            </div>
          ) : null}

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
