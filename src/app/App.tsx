import React from 'react';
import {
  closeSheets, dismissToast, importMascotPack, importMascotSheet, importThemeFromFile, jumpToDate, openAdd, openCourse,
  openMascotEditor, openSearch, openTask, patchMascotPrefs, patchPrefs, patchWallpaper, redo, removeMascot,
  resolveConfirm, setNotify, setNotifyStatus, setSystemDark, setTab, setWeek, showToast, takeMigrateNotes, undo,
  useApp,
} from './store';
import { ConfirmDialog } from '../ui/common';
import Welcome from '../ui/Welcome';
import ShareCodeSheet from '../ui/ShareCodeSheet';
import ExportSheet from '../ui/ExportSheet';
import ManualView from '../ui/ManualView';
import ImportSheet from '../ui/ImportSheet';
import MascotOverlay from '../ui/Mascot';
import ErrorBoundary from '../ui/ErrorBoundary';
import MascotEditor from '../ui/MascotEditor';
import { isVideoFile, videoToSpriteSheet } from '../theme/videoSheet';
import ChangelogSheet from '../ui/ChangelogSheet';
import { onNotified, syncReminders } from './reminderRuntime';
import { watchSystemTimeChanges } from './rescheduleWatch';
import { consumePendingOpen } from '../platform/widget';
import { getNotifier } from '../platform';
import { applyThemeToDom } from '../theme/apply';
import { weekOfDate, todayISO, toISODate, dateOf } from '../core/engine';
import { MAX_WEEK } from '../core/types';
import WeekView from '../ui/WeekView';
import TodayView from '../ui/TodayView';
import ThemeStudio from '../ui/ThemeStudio';
import SettingsView from '../ui/SettingsView';
import OverrideSheet from '../ui/OverrideSheet';
import SchemeSheet from '../ui/SchemeSheet';
import TaskView from '../ui/TaskView';
import TaskEditor from '../ui/TaskEditor';
import SearchSheet from '../ui/SearchSheet';
import CourseSheet from '../ui/CourseSheet';
import CourseEditor from '../ui/CourseEditor';
import { processImageFile } from '../theme/image';
import { Icon } from '../ui/icons';
import { useWideLayout } from '../ui/useWideLayout';
import { APP_VERSION } from './version';
import { DOWNLOAD_PAGE } from './meta';
import { isNativePlatform } from '../platform/nativeBridge';

const TABS = [
  { key: 'week', icon: 'calendar', label: '本周' },
  { key: 'today', icon: 'sun', label: '今日' },
  { key: 'tasks', icon: 'tasks', label: '任务' },
  { key: 'studio', icon: 'palette', label: '外观' },
  { key: 'settings', icon: 'settings', label: '设置' },
] as const;

export default function App() {
  const s = useApp();
  /* 电脑（宽屏）布局：只在浏览器里、且窗口足够宽时打开，见 useWideLayout 的注释 */
  const wide = useWideLayout();
  const [dragging, setDragging] = React.useState(false);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const activePillRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(function () {
    applyThemeToDom(s.theme, s.systemDark);
    /* 首屏时 .wallpaper 可能还没挂载，下一帧再补一次 */
    const id = window.requestAnimationFrame(function () { applyThemeToDom(s.theme, s.systemDark); });
    return function () { window.cancelAnimationFrame(id); };
  }, [s.theme, s.systemDark]);

  /**
   * 课表或**提醒相关**偏好一变，就重新排程。
   *
   * 注意依赖项是拆开的，不是整个 prefs 对象：prefs 里还装着「外观是否锁定」
   * 「危险操作是否二次确认」这些跟提醒毫无关系的开关，而外观锁定会在
   * **离开外观页时自动打开**（以及闲置 3 分钟后）。依赖整个对象的话，
   * 每次切走一个标签页都要「取消全部通知 → 重新排一遍」，
   * 既白跑一趟原生调用，又在那几百毫秒里把所有提醒短暂清空。
   */
  const reminderOffsetsKey = s.prefs.reminderOffsets.join(',');
  const dailyBrief = s.prefs.dailyBrief;
  const briefHour = s.prefs.briefHour;
  React.useEffect(function () {
    let alive = true;
    syncReminders(s.data, s.prefs).then(function (r) {
      if (alive) setNotify(r.status, r.upcoming);
    }).catch(function (e) {
      /* 兜底：无论如何都要把状态写进去，界面不能卡在"正在检测" */
      if (!alive) return;
      /* 出错时保留上一次的清单 —— 清空会让人误以为"没有课要提醒" */
      setNotifyStatus({
        platform: 'unknown', displayName: '不可用', permission: 'unsupported',
        scheduled: 0, survivesAppClose: false, exactAlarm: 'unsupported', channels: [],
        lastError: (e && e.message) ? e.message : String(e),
        note: '排程时出错，详情见"最近一次失败"。',
      });
    });
    return function () { alive = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- 刻意只依赖影响提醒的字段 */
  }, [s.data, reminderOffsetsKey, dailyBrief, briefHour]);

  /**
   * 系统时间 / 时区变化后重排提醒。
   *
   * 依赖数组里放的是"影响提醒的那些字段"—— 重排要拿到最新的课表与偏好，
   * 而 effect 只跑一次的话闭包里会是首帧的旧数据。这里用 ref 读最新值，
   * 于是既能只订阅一次，又不会用到过期数据。
   */
  const latest = React.useRef({ data: s.data, prefs: s.prefs });
  latest.current = { data: s.data, prefs: s.prefs };
  React.useEffect(function () {
    return watchSystemTimeChanges(function (reason) {
      showToast('检测到' + reason + '，正在重新排程提醒', 'info');
      syncReminders(latest.current.data, latest.current.prefs).then(function (r) {
        setNotify(r.status, r.upcoming);
        showToast('提醒已按新的时间重排（' + r.status.scheduled + ' 条）', 'ok');
      }).catch(function () {
        showToast('重排提醒失败，去设置页看一眼通知状态', 'warn');
      });
    });
  }, []);

  /**
   * 桌面小组件点进来 → 打开对应课程的详情（计划书 6.5 节）。
   *
   * 两个时机都要看：冷启动（onCreate）和从后台切回来（onNewIntent）。
   * 后者对应的是"应用已经在后台，用户又点了一次小组件"——
   * 少了它，第二次点就只会把应用拉到前台、不跳详情。
   */
  React.useEffect(function () {
    let stopped = false;
    const check = function (): void {
      void consumePendingOpen().then(function (id) {
        if (!stopped && id) openCourse(id);
      });
    };
    check();
    const onVisible = function (): void { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return function () {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  /**
   * 检查用：`?mascotop=hide|show|remove|size` 在启动后自动执行一次角色操作。
   *
   * 不能点鼠标的环境里（无头检查、CI）就是靠这条把
   * "隐藏 / 移除 / 改尺寸"这几条路径跑到 —— v0.13.0 的白屏正是
   * 只在这几条路径上才会出现，而 tsc、单测、布局检查全都看不出来。
   */
  React.useEffect(function () {
    let op = '';
    try { op = new URLSearchParams(window.location.search).get('mascotop') || ''; } catch (e) { op = ''; }
    if (!op) return;
    const id = window.setTimeout(function () {
      if (op === 'hide') patchMascotPrefs({ hidden: true });
      else if (op === 'show') patchMascotPrefs({ hidden: false });
      else if (op === 'remove') removeMascot();
      else if (op === 'size') patchMascotPrefs({ size: 260 });
      else if (op === 'editor') openMascotEditor('new');
    }, 1200);
    return function () { window.clearTimeout(id); };
  }, []);

  /* 键盘快捷键：Ctrl/Cmd+Z 撤销，Ctrl+Shift+Z 或 Ctrl+Y 重做。
     焦点在输入框里时让给浏览器自带的文本撤销，别抢。

     电脑上再补一组导航键：←/→ 翻周、1–5 切页、/ 搜索。
     手机上没有物理键盘，也就在电脑布局（wide）下才挂这几个键 ——
     这样 Android 上的键盘行为与之前完全一致。 */
  React.useEffect(function () {
    function inField(el: EventTarget | null): boolean {
      const t = el as HTMLElement | null;
      if (!t) return false;
      return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
    }
    function onKey(e: KeyboardEvent): void {
      if (inField(e.target)) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
        return;
      }
      if (!wide || e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setWeek(s.week - 1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); setWeek(s.week + 1); return; }
      if (e.key === '/') { e.preventDefault(); openSearch(); return; }
      if (e.key >= '1' && e.key <= '5') {
        const t = TABS[Number(e.key) - 1];
        if (t) { e.preventDefault(); setTab(t.key); }
      }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [wide, s.week]);

  /* 数据迁移过就提示一次 */
  React.useEffect(function () {
    const notes = takeMigrateNotes();
    if (notes.length > 0) showToast(notes[0], 'info');
  }, []);

  /* 首次启动自动申请一次通知权限 —— 不用用户自己去设置里找 */
  React.useEffect(function () {
    if (s.prefs.permissionAsked) return;
    if (!s.notify || s.notify.probing) return;
    patchPrefs({ permissionAsked: true });
    if (s.notify.permission !== 'default') return;
    const nt = getNotifier();
    nt.requestPermission().then(function () { return nt.status(); }).then(function (st) {
      setNotifyStatus(st);
      if (st.permission === 'granted') showToast('通知权限已开启', 'ok');
    }).catch(function () { /* 用户拒绝就算了 */ });
  }, [s.notify, s.prefs.permissionAsked]);

  /* 通知真的响的时候，在应用内也给一次反馈 */
  React.useEffect(function () {
    return onNotified(function (item) { showToast(item.title, 'info'); });
  }, []);

  React.useEffect(function () {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange(e: MediaQueryListEvent) { setSystemDark(e.matches); }
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    return function () { if (mq.removeEventListener) mq.removeEventListener('change', onChange); };
  }, []);

  React.useEffect(function () {
    if (activePillRef.current && activePillRef.current.scrollIntoView) {
      activePillRef.current.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [s.week]);

  React.useEffect(function () {
    let depth = 0;
    function onOver(e: DragEvent) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (e.type === 'dragenter') depth++;
      setDragging(true);
    }
    function onLeave() { depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (isVideoFile(f)) {
        /* 拖进来的视频：做成逐帧图角色（webm 不是图片，走不了壁纸那条路） */
        showToast('正在从视频里抽帧，可能要几秒…', 'info');
        videoToSpriteSheet(f).then(function (v) {
          importMascotSheet(v.src, f.name.replace(/\.[^.]+$/, ''), v.plan.cols, v.plan.rows, v.plan.fps);
          setTab('studio');
          showToast('视频已做成角色：' + v.plan.frames + ' 帧', 'ok');
        }).catch(function (e) { showToast('这个视频用不了：' + (e as Error).message, 'error'); });
      } else if (f.type.indexOf('image/') === 0) {
        processImageFile(f, 1920, 0.82).then(function (img) {
          patchWallpaper({ kind: 'custom', custom: img.src });
          setTab('studio');
        }).catch(function () { /* 忽略 */ });
      } else {
        /* 文本类文件先看 format：角色包和主题包都叫 .json，靠后缀分不干净 */
        f.text().then(function (text) {
          let fmt = '';
          try { fmt = String((JSON.parse(text) as { format?: unknown }).format || ''); } catch (e) { fmt = ''; }
          if (fmt === 'timetable-mascot') {
            const r = importMascotPack(text, f.name);
            if (r.ok) {
              setTab('studio');
              showToast('角色已就位，按住它可以拖到别的位置', 'ok');
            } else {
              showToast('角色包导入失败：' + r.error, 'error');
            }
            return;
          }
          void importThemeFromFile(f);
        }).catch(function () { void importThemeFromFile(f); });
      }
    }
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragenter', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return function () {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragenter', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const nowWeek = weekOfDate(s.data.term, todayISO());
  const tab = s.tab;
  const total = s.data.term.totalWeeks;

  /* 周次条虚拟化：只渲染当前周前后各 7 周，所以时间轴再长也不会拖慢渲染 */
  const WIN = 7;
  const upper = total === undefined ? s.week + WIN : Math.min(Math.max(total, s.week), s.week + WIN);
  const visibleWeeks: number[] = [];
  for (let w = Math.max(1, s.week - WIN); w <= Math.min(MAX_WEEK, upper); w++) visibleWeeks.push(w);

  const weekRangeLabel = (function () {
    const a = dateOf(s.data.term, s.week, 1);
    const b = dateOf(s.data.term, s.week, 7);
    if (a.getFullYear() === b.getFullYear()) {
      return (a.getMonth() + 1) + '/' + a.getDate() + ' - ' + (b.getMonth() + 1) + '/' + b.getDate();
    }
    return toISODate(a) + ' - ' + toISODate(b);
  })();

  const titles: Record<string, string> = { today: '今日', tasks: '任务与 DDL', studio: '外观 DIY', settings: '设置' };

  /* 首次启动先讲清楚数据去哪了 —— 拦在最外层，其它一律不渲染 */
  if (!s.prefs.privacySeen) return <Welcome />;

  return (
    <div className={wide ? 'app wide' : 'app'}>
      <div className="wallpaper" />
      <div className="wallpaper-scrim" />

      <div className="app-layer">
        <div className="content">
          <div className="topbar">
            <div className="topbar-row">
              <div>
                <div className="term-name">{tab === 'week' ? s.data.term.name : titles[tab]}</div>
                <div className="term-sub">
                  {tab === 'week'
                    ? '第 ' + s.week + ' 周 · ' + (total === undefined ? '不设结束' : '共 ' + total + ' 周') + ' · ' + weekRangeLabel
                    : tab === 'today' ? '今天有 ' + s.data.sessions.length + ' 个上课时段'
                    : tab === 'tasks' ? (s.data.tasks || []).filter(function (t) { return !t.done; }).length + ' 项待完成'
                    : tab === 'studio' ? '改到你满意为止' : '本地优先 · 数据属于你'}
                </div>
              </div>
              <div className="topbar-actions">
                {/* 只在确实有东西可撤销/重做时才出现 —— 平时顶栏保持干净 */}
                {s.history.undo > 0 ? (
                  <button
                    className="icon-btn" title={'撤销：' + (s.history.lastLabel || '上一步')}
                    onClick={function () { undo(); }}
                  >↶</button>
                ) : null}
                {s.history.redo > 0 ? (
                  <button className="icon-btn" title="重做" onClick={function () { redo(); }}>↷</button>
                ) : null}
                {tab !== 'settings' ? (
                  <button className="icon-btn" title="设置" onClick={function () { setTab('settings'); }}><Icon name="settings" size={18} /></button>
                ) : null}
                <button className="icon-btn" title="搜索" onClick={openSearch}><Icon name="search" size={18} /></button>
                <button className="icon-btn" title={tab === 'tasks' ? '添加任务' : '添加课程'} onClick={function () { if (tab === 'tasks') openTask(null); else openAdd(); }}>＋</button>
              </div>
            </div>
            {tab === 'week' ? (
              <div className="week-strip" ref={stripRef}>
                <button className="week-pill step" aria-label="上一周" onClick={function () { setWeek(s.week - 1); }} disabled={s.week <= 1}>‹</button>
                {visibleWeeks.map(function (w) {
                  const active = w === s.week;
                  const isNow = w === nowWeek;
                  let cls = 'week-pill';
                  if (active) cls += ' active';
                  if (isNow) cls += ' is-now';
                  return (
                    <button
                      key={w}
                      ref={active ? activePillRef : undefined}
                      className={cls}
                      aria-label={'第 ' + w + ' 周' + (isNow ? '（本周）' : '')}
                      aria-current={active ? 'true' : undefined}
                      onClick={function () { setWeek(w); }}
                    >{w}</button>
                  );
                })}
                <button className="week-pill step" aria-label="下一周" onClick={function () { setWeek(s.week + 1); }}>›</button>
              </div>
            ) : null}
          </div>

          <div className={
            (tab === 'week' ? 'content-inner flush' : 'content-inner')
            + (wide && (tab === 'settings' || tab === 'studio') ? ' two-col' : '')
          }>
            {tab === 'week' ? <WeekView /> : null}
            {tab === 'today' ? <TodayView /> : null}
            {tab === 'tasks' ? <TaskView /> : null}
            {tab === 'studio' ? <ThemeStudio /> : null}
            {tab === 'settings' ? <SettingsView /> : null}
          </div>
        </div>

        {tab === 'week' || tab === 'today' ? (
          <button className="fab" onClick={openAdd} title="添加课程">＋</button>
        ) : null}
        {tab === 'tasks' ? (
          <button className="fab" onClick={function () { openTask(null); }} title="添加任务">＋</button>
        ) : null}

        <div className="tabbar">
          {/*
            电脑上侧边栏顶部的品牌块。手机上这块是 display:none ——
            标签栏用的是 grid-auto-flow: column，隐藏的元素不占格子，
            所以手机端的五个标签位置一个像素都不会变。
          */}
          <div className="tab-brand">
            <div className="tab-brand-mark">课</div>
            <div>
              <div className="tab-brand-name">课表助手</div>
              <div className="tab-brand-sub">本地优先 · 无广告</div>
            </div>
          </div>

          {TABS.map(function (t) {
            return (
              <button
                key={t.key}
                className={tab === t.key ? 'tab active' : 'tab'}
                aria-label={t.label}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={function () { setTab(t.key); }}
              >
                {/* 图标是装饰，文字才是标签本身；不让屏幕阅读器把 SVG 读成乱码 */}
                <Icon name={t.icon} size={20} className="tab-icon" />
                <span>{t.label}</span>
              </button>
            );
          })}

          {/* 侧边栏底部：安卓安装包入口与版本号。手机上整块隐藏 */}
          <div className="tab-foot">
            {!isNativePlatform() ? (
              <a className="tab-get" href={DOWNLOAD_PAGE}>获取 Android 版</a>
            ) : null}
            <div className="tab-ver">v{APP_VERSION || '?'}</div>
          </div>
        </div>
      </div>

      {/*
        角色单独一层围栏：它是个装饰，**永远不该有能力搞白整个应用**。
        真出事时这里会显示一条错误 + 两个一键回退（收起 / 移除），
        而不是让用户对着白屏卸载重装。
      */}
      <ErrorBoundary
        label="角色"
        onRetry={function () { patchMascotPrefs({ hidden: true }); }}
        extraAction={{ text: '移除角色', run: removeMascot }}
      >
        <MascotOverlay />
      </ErrorBoundary>

      {s.courseSheet ? <CourseSheet courseId={s.courseSheet} /> : null}
      {s.addSheet ? <CourseEditor courseId={null} /> : null}
      {s.editSheet ? <CourseEditor courseId={s.editSheet} /> : null}
      {s.overrideSheet ? <OverrideSheet sessionId={s.overrideSheet} /> : null}
      {s.schemeSheet ? <SchemeSheet /> : null}
      {s.taskEditor ? <TaskEditor taskId={null} /> : null}
      {s.taskSheet ? <TaskEditor taskId={s.taskSheet} /> : null}
      {s.searchSheet ? <SearchSheet /> : null}
      {s.shareSheet ? <ShareCodeSheet mode={s.shareSheet} /> : null}
      {s.exportSheet ? <ExportSheet /> : null}
      {s.importSheet ? <ImportSheet /> : null}
      {s.mascotEditor ? <MascotEditor mode={s.mascotEditor} key={s.mascotEditor} /> : null}
      {s.manualSheet ? <ManualView /> : null}
      {s.changelogSheet ? <ChangelogSheet /> : null}

      {dragging ? <div className="drop-mask">松手即可应用 · 图片设为壁纸，主题包 / 角色包直接导入</div> : null}

      {/* 应用内确认框，替代 window.confirm 的系统白底弹窗 */}
      {s.confirm ? (
        <ConfirmDialog
          message={s.confirm.message}
          okText={s.confirm.okText}
          danger={s.confirm.danger}
          onResolve={resolveConfirm}
        />
      ) : null}

      {s.toast ? (
        /* 提示条是"发生了什么"的唯一反馈通道，屏幕阅读器必须能念出来 */
        <div className={'toast ' + s.toast.kind} role="status" aria-live={s.toast.kind === 'error' ? 'assertive' : 'polite'}>
          <span>{s.toast.text}</span>
          {s.toast.undo ? (
            <button
              className="toast-undo"
              onClick={function () { const u = s.toast && s.toast.undo; dismissToast(); if (u) u(); }}
            >撤销</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
