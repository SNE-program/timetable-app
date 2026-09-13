import React from 'react';
import { deleteOverride, markAttendance, openAdd, openCourse, useApp } from '../app/store';
import type { AttendanceStatus } from '../core/types';
import { conflictsOf, expandDay, freeSlots, nextEvent, parseISODate, todayISO } from '../core/engine';
import { courseColor, resolvePalette } from '../theme/palette';
import { resolveDark } from '../theme/tokens';
import { useCourseMap, useMinuteClock } from './useMinuteClock';
import { humanDuration } from '../core/duration';
import { Icon } from './icons';

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export default function TodayView() {
  const s = useApp();
  const data = s.data;
  const theme = s.theme;
  /* 分钟对齐，不是每秒 */
  const now = useMinuteClock();
  const today = todayISO();
  const courseById = useCourseMap(data.courses);

  /* 这些只跟"哪一天 / 哪份课表"有关，跟"现在几点"无关 —— 每分钟重算纯属浪费 */
  const events = React.useMemo(function () { return expandDay(data, today); }, [data, today]);
  const conflicts = React.useMemo(function () { return conflictsOf(data, today); }, [data, today]);
  const slots = React.useMemo(function () { return freeSlots(data, today); }, [data, today]);
  const palette = React.useMemo(function () { return resolvePalette(theme, s.systemDark); }, [theme, s.systemDark]);

  /* 只有这个真的依赖"现在几点" */
  const next = React.useMemo(function () { return nextEvent(data, now); }, [data, now]);
  const dark = resolveDark(theme.modePref, s.systemDark);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const heroEvent = next ? next.event : null;
  const heroCourse = heroEvent ? courseById.get(heroEvent.courseId) : undefined;
  const heroColor = heroCourse ? courseColor(palette, heroCourse.colorIndex) : (palette[0] || theme.accent);
  const sameDay = heroEvent ? heroEvent.date === today : false;
  const ongoing = !!(sameDay && next && next.ongoing);

  let kicker = '今日';
  let title = '今天的课都上完了';
  let meta = '明天没有安排，好好休息';
  let tag = '';
  let num: string | null = null;
  let unit = '';
  let pct = 0;

  if (heroEvent) {
    tag = '第 ' + heroEvent.periodStart + '-' + heroEvent.periodEnd + ' 节';
    title = heroEvent.title;
    meta = (heroEvent.location || '教室待定') + '  ·  ' + heroEvent.start + '-' + heroEvent.end;
    if (heroCourse && heroCourse.teacher) meta += '  ·  ' + heroCourse.teacher;

    if (ongoing) {
      kicker = '正在上课';
      const left = Math.max(0, heroEvent.endMinutes - nowMin);
      num = humanDuration(left);
      unit = '后下课';
      const total = Math.max(1, heroEvent.endMinutes - heroEvent.startMinutes);
      pct = clamp01((nowMin - heroEvent.startMinutes) / total) * 100;
    } else if (sameDay && next) {
      kicker = '下一节课';
      num = humanDuration(next.startsInMinutes);
      unit = '后开始';
      pct = (1 - clamp01(Math.min(next.startsInMinutes, 120) / 120)) * 100;
    } else {
      /*
       * 跨天时不再显示倒计时。以前这里直接甩一个「4881 分钟后开始」，
       * 没人能把它换算成「三天后的周一早上」—— 直接给日子和上课时间。
       */
      const diffDays = Math.round(
        (parseISODate(heroEvent.date).getTime() - parseISODate(today).getTime()) / 86400000
      );
      const wd = WEEKDAY_CN[heroEvent.dayOfWeek - 1];
      if (diffDays === 1) { kicker = '明天第一节课'; num = '明天'; }
      else if (diffDays === 2) { kicker = '后天第一节课'; num = '后天'; }
      else { kicker = '周' + wd + ' 第一节课'; num = '周' + wd; }
      unit = heroEvent.start + ' 开始';
      pct = 0;
    }
  }

  const heroHasImage = !!(heroCourse && heroCourse.image && sameDay);
  const todayCourses = events.map(function (e) {
    return { e: e, c: courseById.get(e.courseId) };
  });

  const heroStyle: React.CSSProperties = heroHasImage
    ? { backgroundImage: 'url("' + heroCourse!.image + '")' }
    : ({ ['--hero-c']: heroColor } as React.CSSProperties);

  return (
    <div>
      <div className={heroHasImage ? 'hero has-image' : 'hero'} style={heroStyle}>
        {heroHasImage ? <div className="hero-veil" /> : null}
        <div className="hero-inner">
          <div className="hero-head">
            <span className="hero-kicker">{kicker}</span>
            {tag ? <span className="hero-tag">{tag}</span> : null}
          </div>
          <div className="hero-title">{title}</div>
          <div className="hero-meta">{meta}</div>
          {num !== null ? (
            <div className="hero-count">
              <span className="num">{num}</span>
              <span className="unit">{unit}</span>
            </div>
          ) : null}
          <div className="hero-progress"><i style={{ width: pct.toFixed(1) + '%' }} /></div>
        </div>
      </div>

      {conflicts.length > 0 ? (
        <div className="warn-bar" style={{ marginBottom: 6 }}>
          <div className="warn-badge">!</div>
          <div style={{ minWidth: 0 }}>
            <div className="warn-title">今天有 {conflicts.length} 处冲突</div>
            {conflicts.map(function (c, i) { return <div className="warn-item" key={i}>{c.message}</div>; })}
          </div>
        </div>
      ) : null}

      {slots.length > 0 && events.length > 0 ? (
        <React.Fragment>
          <div className="section-title">今天的空档</div>
          <div className="chip-row" style={{ padding: '0 0 4px' }}>
            {slots.map(function (sl) {
              return <span className="chip" key={sl.start}>{sl.start} - {sl.end}</span>;
            })}
          </div>
        </React.Fragment>
      ) : null}

      <div className="section-title">今日安排 · {events.length} 节</div>
      {events.length === 0 ? (
        data.sessions.length === 0 ? (
          <div className="empty">
            <Icon name="clipboard" size={30} className="empty-emoji" />
            <div className="empty-title">还没有课程</div>
            <div className="tiny">加完课之后，这里会显示下一节课的倒计时</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={openAdd}>添加第一门课</button>
            </div>
          </div>
        ) : (
          <div className="empty">
            <Icon name="sun" size={30} className="empty-emoji" />
            <div className="empty-title">今天没有课</div>
            <div className="tiny">去看看这一周的其他安排</div>
          </div>
        )
      ) : (
        <div className="tl">
          {todayCourses.map(function (item) {
            const e = item.e;
            const c = item.c;
            const cc = courseColor(palette, e.colorIndex);
            const past = e.endMinutes <= nowMin;
            /*
             * 这一节如果被调过，就地给出「恢复这一次」。
             * 调整记录的 id 就在事件里（引擎把 modifiedBy 填成那条 override 的 id）——
             * 不要自己按 (sessionId, date) 去找：补课这类调整的原日期与出现日期不同，
             * 那样找会在"补到今天"的那一节上找不到记录，按钮就不出现了。
             */
            const overrideId = e.modifiedBy || '';
            const isNow = e.startMinutes <= nowMin && nowMin < e.endMinutes;
            let cls = 'tl-item';
            if (past) cls += ' past';
            if (isNow) cls += ' ongoing';
            return (
              <div className={cls} key={e.key} style={{ ['--tl-c']: cc } as React.CSSProperties}>
                <div className="tl-time">{e.start}<br />{e.end}</div>
                <div className="tl-node" />
                <div className="tl-card" onClick={function () { if (c) openCourse(c.id); }}>
                  <div className="tl-name">{e.title}</div>
                  <div className="tl-meta">
                    {e.location || '教室待定'}{c && c.teacher ? ' · ' + c.teacher : ''} · 第 {e.periodStart}-{e.periodEnd} 节
                  </div>
                  {isNow ? <div className="tl-status" style={{ color: cc }}>进行中 · 还有 {e.endMinutes - nowMin} 分钟下课</div> : null}
                  {e.startMinutes <= nowMin ? (
                    <div className="att-row">
                      {([['present', '到'], ['late', '迟'], ['absent', '缺'], ['leave', '假']] as [AttendanceStatus, string][]).map(function (it) {
                        const rec = (data.attendance || []).find(function (a) { return a.sessionId === e.sessionId && a.date === e.date; });
                        const on = !!rec && rec.status === it[0];
                        return (
                          <button
                            key={it[0]}
                            className={on ? 'att on' : 'att'}
                            onClick={function (ev) { ev.stopPropagation(); markAttendance(e.sessionId, e.date, it[0]); }}
                          >{it[1]}</button>
                        );
                      })}
                    </div>
                  ) : null}
                  {e.modifiedBy ? (
                    <div className="tl-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>已调课 / 临时调整</span>
                      {/* 今天刚停掉/改过的课，就地就能恢复 —— 不用去长按课程卡再翻面板 */}
                      {overrideId ? (
                        <button
                          className="btn sm ghost"
                          onClick={function (ev) { ev.stopPropagation(); deleteOverride(overrideId); }}
                        >恢复这一次</button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
