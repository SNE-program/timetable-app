import React from 'react';
import {
  clearReminderRule, closeSheets, confirmDanger, deleteCourse, openEdit, openOverride, setData,
  setReminderRule, showToast, useApp,
} from '../app/store';
import { describeWeeks, timeRangeLabel } from '../core/engine';
import { mostSpecificRule, offsetsFor } from '../core/reminders';
import type { Course } from '../core/types';
import { courseColor, resolvePalette } from '../theme/palette';
import { formatBytes, processImageFile } from '../theme/image';
import { Sheet } from './common';

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日'];
const REMIND_OPTIONS = [30, 15, 10, 5];

export default function CourseSheet(props: { courseId: string }) {
  const s = useApp();
  const course = s.data.courses.find(function (c) { return c.id === props.courseId; });
  const scheme = s.data.schemes.find(function (x) { return x.id === s.data.term.periodSchemeId; }) || s.data.schemes[0];
  const palette = resolvePalette(s.theme, s.systemDark);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const prefsObj = {
    reminderOffsets: s.prefs.reminderOffsets,
    dailyBrief: s.prefs.dailyBrief,
    briefHour: s.prefs.briefHour,
  };
  const sessions = course ? s.data.sessions.filter(function (x) { return x.courseId === course.id; }) : [];
  const firstSessionId = sessions.length ? sessions[0].id : '';
  const [remind, setRemind] = React.useState<number[]>(function () {
    return course ? offsetsFor(s.data.reminderRules, firstSessionId, course.id, prefsObj) : [];
  });

  React.useEffect(function () {
    if (!course) return;
    setRemind(offsetsFor(s.data.reminderRules, firstSessionId, course.id, prefsObj));
  }, [props.courseId]);

  if (!course) return null;
  const cc = courseColor(palette, course.colorIndex);
  const ownRule = mostSpecificRule(s.data.reminderRules, firstSessionId, course.id);

  function updateCourse(patch: Partial<Course>) {
    setData(Object.assign({}, s.data, {
      courses: s.data.courses.map(function (c) { return c.id === course!.id ? Object.assign({}, c, patch) : c; }),
    }), '修改课程');
  }

  async function pickImage(file: File) {
    setBusy(true);
    try {
      const img = await processImageFile(file, 1200, 0.8);
      updateCourse({ image: img.src });
      showToast('课程图片已设置（' + formatBytes(img.bytes) + '）', 'ok');
    } catch (e) {
      showToast('图片处理失败：' + (e as Error).message, 'error');
    }
    setBusy(false);
  }

  function toggleRemind(m: number) {
    const on = remind.indexOf(m) >= 0;
    const next = on ? remind.filter(function (x) { return x !== m; }) : remind.concat([m]).sort(function (a, b) { return b - a; });
    setRemind(next);
    setReminderRule('course', course!.id, next, next.length > 0);
  }

  return (
    <Sheet title={course.name} onClose={closeSheets}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 6, flex: '0 0 auto',
          background: course.image ? 'url("' + course.image + '") center/cover' : cc,
          border: '1px solid var(--c-border)',
        }} />
        <div>
          <div className="bold">{course.teacher || '未填教师'}</div>
          <div className="tiny muted">
            {course.tags && course.tags.length ? course.tags.join(' · ') : '未分类'} · {sessions.length} 个上课时段
          </div>
        </div>
        <div className="spacer" />
        <button className="btn sm" onClick={function () { openEdit(course!.id); }}>编辑</button>
      </div>

      <div className="section-title">上课时段</div>
      <div className="card-block" style={{ marginBottom: 14 }}>
        {sessions.length === 0 ? (
          <div className="list-row"><div className="lr-sub">还没有时段，点右上角「编辑」加一个</div></div>
        ) : sessions.map(function (x) {
          return (
            <div className="list-row" key={x.id}>
              <div style={{ width: 3, height: 32, borderRadius: 1, background: cc, flex: '0 0 auto' }} />
              <div>
                <div className="lr-label">
                  周{WEEKDAY_CN[x.dayOfWeek - 1]} · 第 {x.periodStart}-{x.periodEnd} 节
                  <span className="muted"> {timeRangeLabel(s.data, x.periodStart, x.periodEnd)}</span>
                </div>
                <div className="lr-sub">{describeWeeks(x.weeks, s.data.term.totalWeeks)} · {x.location || '未填教室'}</div>
              </div>
              <div className="spacer" />
              <button className="btn sm" onClick={function () { openOverride(x.id); }}>调课</button>
            </div>
          );
        })}
      </div>

      <div className="section-title">课程图片</div>
      <div className="card-block" style={{ marginBottom: 14 }}>
        {course.image ? (
          <div className="asset-line">
            <img className="asset-thumb" src={course.image} alt="课程图" />
            <div>
              <div className="small bold">已设置</div>
              <div className="tiny muted">{formatBytes(Math.round(course.image.length * 0.75))} · 课表卡片与今日大卡会用它</div>
            </div>
            <div className="spacer" />
            <button className="btn sm ghost" onClick={function () { updateCourse({ image: undefined }); }}>移除</button>
          </div>
        ) : null}
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { if (fileRef.current) fileRef.current.click(); }}>
          <div>
            <div className="lr-label">{busy ? '正在处理…' : '选择一张图片'}</div>
            <div className="lr-sub">会显示在课表卡片背景上（自动压到 1200px）</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <input
          ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            if (f) void pickImage(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="section-title">这门课的提醒</div>
      <div className="card-block" style={{ marginBottom: 14 }}>
        <div className="chip-row">
          {REMIND_OPTIONS.map(function (m) {
            const on = remind.indexOf(m) >= 0;
            return (
              <button key={m} className={on ? 'chip on' : 'chip'} onClick={function () { toggleRemind(m); }}>
                课前 {m} 分钟
              </button>
            );
          })}
        </div>
        <div className="list-row">
          <div>
            <div className="lr-label">{ownRule ? '已单独设置' : '沿用默认规则'}</div>
            <div className="lr-sub">
              {ownRule
                ? '这门课不再跟随全局设置'
                : '全局默认：' + (s.prefs.reminderOffsets.length ? s.prefs.reminderOffsets.join(' / ') + ' 分钟' : '未开启')}
            </div>
          </div>
          {ownRule ? (
            <div className="lr-right">
              <button
                className="btn sm ghost"
                onClick={function () {
                  clearReminderRule('course', course!.id);
                  setRemind(s.prefs.reminderOffsets);
                  showToast('已恢复跟随默认规则', 'ok');
                }}
              >恢复默认</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="section-title">出勤</div>
      <div className="card-block" style={{ marginBottom: 14 }}>
        {(() => {
          const recs = (s.data.attendance || []).filter(function (a) {
            return sessions.some(function (x) { return x.id === a.sessionId; });
          });
          if (recs.length === 0) {
            return <div className="list-row"><div className="lr-sub">还没有记录。在「今日」页点课程卡片下方的 到 / 迟 / 缺 / 假 即可标记。</div></div>;
          }
          const count = function (k: string) { return recs.filter(function (a) { return a.status === k; }).length; };
          const attended = count('present') + count('late');
          const rate = Math.round(attended / recs.length * 100);
          return (
            <React.Fragment>
              <div className="list-row">
                <div>
                  <div className="lr-label">出勤率 {rate}%</div>
                  <div className="lr-sub">已记录 {recs.length} 次 · 到 {count('present')} · 迟 {count('late')} · 缺 {count('absent')} · 假 {count('leave')}</div>
                </div>
              </div>
            </React.Fragment>
          );
        })()}
      </div>

      <div className="section-title">作息</div>
      <div className="card-block" style={{ marginBottom: 14 }}>
        <div className="list-row">
          <div>
            <div className="lr-label">{scheme.name}</div>
            <div className="lr-sub">第 {sessions[0] ? sessions[0].periodStart : 1} 节 {scheme.periods[0].start} 开始 · 共 {scheme.periods.length} 节</div>
          </div>
        </div>
      </div>

      <button
        className="btn danger block"
        onClick={function () {
          void (async function () {
            if (await confirmDanger('删除「' + course!.name + '」？它的上课时段、调课记录与提醒规则也会一并删除。', '删除课程')) {
              deleteCourse(course!.id);
            }
          })();
        }}
      >删除这门课</button>
    </Sheet>
  );
}
