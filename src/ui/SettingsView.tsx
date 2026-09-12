import React from 'react';
import {
  clearAllCourses, confirmDanger, exportIcsNow, exportThemeNow, importIcsFromFile, importTimetableFromFile,
  openChangelog, openExport, openImportSheet, openManual, openScheme, openShare, patchPrefs, setNotifyStatus,
  shareWeekImage, toastSave,
  setReminderRule, setTerm, showToast, useApp,
} from '../app/store';
import { getNotifier } from '../platform';
import { saveTextFile } from '../platform/saveFile';
import { Reliability, isReliabilitySupported, type ReliabilityInfo } from '../platform/reliability';
import { withDeadline } from '../app/asyncAction';
import { APP_VERSION } from '../app/version';
import { MAX_WEEK } from '../core/types';
import { DateField, Panel, SwitchRow } from './common';
import PluginsPanel from './PluginsPanel';
import WidgetPanel from './WidgetPanel';
import WebReminderPanel from './WebReminderPanel';
import { isNativePlatform } from '../platform/nativeBridge';
import { ANDROID_RELEASE_URL } from '../app/meta';
import DebugSection from './DebugSection';

const REMIND_OPTIONS = [30, 15, 10, 5];

function whenLabel(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day - day0) / 86400000);
  const hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  if (diff === 0) return '今天 ' + hm;
  if (diff === 1) return '明天 ' + hm;
  if (diff === 2) return '后天 ' + hm;
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}

const PERM_TEXT: Record<string, string> = {
  granted: '已允许',
  denied: '已被拒绝。可以点上面的「申请」重新请求，或去系统设置里打开',
  default: '还没申请',
  unknown: '暂时读不到（系统没有响应），点「逐步检查」看看卡在哪一步',
  unsupported: '当前环境不支持',
};

export default function SettingsView() {
  const s = useApp();
  const term = s.data.term;
  const offsets = s.prefs.reminderOffsets;
  const n = s.notify;
  const [dateDraft, setDateDraft] = React.useState(term.startDate);
  const [weeksDraft, setWeeksDraft] = React.useState(term.totalWeeks === undefined ? '' : String(term.totalWeeks));
  const [busy, setBusy] = React.useState(false);
  const [rel, setRel] = React.useState<ReliabilityInfo | null>(null);
  const [relBusy, setRelBusy] = React.useState(false);

  const refreshReliability = React.useCallback(function () {
    if (!isReliabilitySupported()) { setRel(null); return; }
    withDeadline(Reliability.check(), 12000, '系统可靠性检测').then(function (r) { setRel(r.ok ? r.value : null); });
  }, []);

  React.useEffect(function () { refreshReliability(); }, [refreshReliability]);

  React.useEffect(function () {
    setDateDraft(term.startDate);
    setWeeksDraft(term.totalWeeks === undefined ? '' : String(term.totalWeeks));
  }, [term.startDate, term.totalWeeks]);

  function commitTerm() {
    const raw = weeksDraft.trim();
    const okDate = /^\d{4}-\d{2}-\d{2}$/.test(dateDraft);
    /* 留空 = 学期不设结束，周次可以无限往后延伸 */
    const w = raw === '' ? undefined : Math.min(MAX_WEEK, Math.max(1, Number(raw) || 20));
    setTerm({ startDate: okDate ? dateDraft : term.startDate, totalWeeks: w });
    showToast(raw === '' ? '学期已设为不设结束' : '学期设置已更新', 'ok');
  }

  /** 日期现在是选择器，选完当场生效，不用等失焦 */
  function setCommitDate(v: string) {
    setDateDraft(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    const raw = weeksDraft.trim();
    const w = raw === '' ? undefined : Math.min(MAX_WEEK, Math.max(1, Number(raw) || 20));
    setTerm({ startDate: v, totalWeeks: w });
    showToast('学期设置已更新', 'ok');
  }

  async function askPermission() {
    setBusy(true);
    try {
      const nt = getNotifier();
      const r = await withDeadline(nt.requestPermission(), 90000, '申请通知权限');
      if (!r.ok) { showToast(r.error, 'warn'); return; }
      const st = await withDeadline(nt.status(), 12000, '读取状态');
      if (st.ok) setNotifyStatus(st.value);
      showToast(r.value === 'granted' ? '通知权限已开启' : '没有拿到通知权限', r.value === 'granted' ? 'ok' : 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function askExactAlarm() {
    setBusy(true);
    try {
      const nt = getNotifier();
      /* 这一步要跳到系统页面，用户可能停留很久，给 3 分钟 */
      const r = await withDeadline(nt.requestExactAlarm(), 180000, '精确闹钟授权');
      const st = await withDeadline(nt.status(), 12000, '读取状态');
      if (st.ok) setNotifyStatus(st.value);
      const granted = r.ok && r.value === 'granted';
      showToast(granted ? '精确闹钟已授权，提醒会准点到分钟' : '请在系统页面里允许「闹钟和提醒」', granted ? 'ok' : 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function testNotify() {
    setBusy(true);
    try {
      await runTestNotify();
    } finally {
      setBusy(false);   /* 无论如何都要把按钮恢复 */
    }
  }

  async function runTestNotify() {
    const nt = getNotifier();
    let st = await nt.status();
    if (st.permission !== 'granted') {
      await nt.requestPermission();
      st = await nt.status();
    }
    if (st.permission !== 'granted') {
      showToast('没有通知权限，请先允许通知', 'warn');
      return;
    }
    const r = await withDeadline(nt.fireNow({
      fingerprint: 'test@' + Date.now(),
      title: '测试提醒',
      body: '看到这条说明提醒通道是通的',
      at: Date.now(),
      channel: 'class-reminder',
    }), 20000, '发送测试通知');
    const after = await withDeadline(nt.status(), 12000, '读取状态');
    if (after.ok) setNotifyStatus(after.value);
    if (!r.ok) { showToast(r.error + '（原生调用卡住了）', 'error'); return; }
    showToast(
      r.value ? '测试通知已发出，看看通知栏' : '发送失败：' + (st.lastError || '未知原因'),
      r.value ? 'ok' : 'error'
    );
  }

  /**
   * 导出课表 JSON。
   *
   * 必须走 platform/saveFile：安卓 WebView 里 `a.download` 是被丢掉的，
   * 点了没反应 —— 用户会直接判定"这个功能没做"。
   */
  async function exportTimetable() {
    const text = JSON.stringify(s.data, null, 2);
    const r = await saveTextFile({
      fileName: (s.data.term.name || '我的课表') + '.json',
      text: text,
      mime: 'application/json',
      title: '课表助手数据备份 · ' + s.data.courses.length + ' 门课',
      dialogTitle: '导出课表数据',
    });
    toastSave(r, '课表数据（' + Math.round(text.length / 1024) + ' KB）');
  }

  const scheme = s.data.schemes.find(function (x) { return x.id === term.periodSchemeId; }) || s.data.schemes[0];
  const importRef = React.useRef<HTMLInputElement>(null);
  const icsRef = React.useRef<HTMLInputElement>(null);

  const permState = !n ? 'warn'
    : n.permission === 'granted' ? 'ok'
    : n.permission === 'default' ? 'warn'
    : n.permission === 'unknown' ? 'warn'
    : 'bad';

  return (
    <div>
      <Panel title="提醒通道" sub={n ? n.displayName : '检测中…'}>
        <div className="list-row">
          <div className={'dot ' + permState} />
          <div>
            <div className="lr-label">通知权限</div>
            <div className="lr-sub">{!n || n.probing ? '正在检测…' : PERM_TEXT[n.permission]}</div>
          </div>
          <div className="lr-right">
            {n && n.permission !== 'granted' && n.permission !== 'unsupported' && n.permission !== 'unknown' ? (
              <button className="btn sm primary" onClick={askPermission}>申请</button>
            ) : null}
          </div>
        </div>

        {/* 精确闹钟是 Android 的权限，网页版没有这一项，不摆一个永远亮不起来的灯 */}
        {isNativePlatform() ? (
        <div className="list-row">
          <div className={'dot ' + (n && n.exactAlarm === 'granted' ? 'ok' : n && n.exactAlarm === 'unsupported' ? 'warn' : 'bad')} />
          <div>
            <div className="lr-label">精确闹钟</div>
            <div className="lr-sub">
              {!n ? '—'
                : n.exactAlarm === 'granted' ? '已授权，提醒可以准到分钟'
                : n.exactAlarm === 'unsupported' ? '当前平台不需要这项授权'
                : '未授权。系统会把提醒延后几分钟到几十分钟，早八很容易迟到'}
            </div>
          </div>
          <div className="lr-right">
            {n && (n.exactAlarm === 'denied' || n.exactAlarm === 'unknown') ? (
              <button className="btn sm primary" onClick={askExactAlarm}>授权</button>
            ) : null}
          </div>
        </div>
        ) : null}

        <div className="list-row">
          <div className={'dot ' + (n && n.scheduled > 0 ? 'ok' : 'warn')} />
          <div>
            <div className="lr-label">已排入通知系统</div>
            <div className="lr-sub">
              {!n ? '—'
                : isNativePlatform()
                  ? n.scheduled + ' 条（未来 7 天滚动排程）'
                  : n.scheduled + ' 条（页面内的定时器，关掉页面即失效）'}
            </div>
          </div>
        </div>

        <div className="list-row">
          <div className={'dot ' + (n && n.survivesAppClose ? 'ok' : 'bad')} />
          <div>
            <div className="lr-label">{isNativePlatform() ? '关闭 App 后仍能提醒' : '关掉页面后仍能提醒'}</div>
            <div className="lr-sub">
              {n && n.survivesAppClose
                ? '是，已交给系统闹钟'
                : isNativePlatform() ? '否，仅页面开着时有效' : '否，浏览器不允许网页在关闭后自己唤醒'}
            </div>
          </div>
        </div>

        {n && n.channels.length > 0 ? (
          <div className="list-row">
            <div className="dot ok" />
            <div>
              <div className="lr-label">通知渠道</div>
              <div className="lr-sub">{n.channels.join(' · ')}</div>
            </div>
          </div>
        ) : null}

        {n && n.lastError ? (
          <div className="list-row">
            <div className="dot bad" />
            <div>
              <div className="lr-label">最近一次失败</div>
              <div className="lr-sub">{n.lastError}</div>
            </div>
          </div>
        ) : null}

        {n ? <div className="panel-desc">{n.note}</div> : null}

        <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
          <button className="btn primary block" disabled={busy} onClick={testNotify}>
            {busy ? '发送中…' : '发一条测试通知'}
          </button>
        </div>
        <div className="panel-desc" style={{ paddingTop: 0 }}>
          提醒排不出去、或者想逐步排查卡在哪一步，去下面的<b>排查工具</b>。
        </div>
      </Panel>

      <WidgetPanel />

      {isNativePlatform() ? (
      <Panel
        title="后台提醒可靠性"
        sub={rel ? (rel.batteryUnrestricted ? '已放行' : '需要设置') : '仅 Android'}
        desc="Android 上「App 关掉后还能准点提醒」靠的是系统闹钟。但系统为了省电会拦它，各家手机厂商的策略还不一样 —— 下面两项不设置的话，提醒可能被推迟几十分钟，或者清理后台后就再也不响。"      >
        <div className="list-row">
          <div className={'dot ' + (rel && rel.batteryUnrestricted ? 'ok' : 'bad')} />
          <div>
            <div className="lr-label">电池优化白名单</div>
            <div className="lr-sub">
              {!rel ? '当前平台不支持检测'
                : rel.batteryUnrestricted ? '已放行，系统不会冻结本应用'
                : '未放行。系统可能把闹钟推迟，甚至直接冻结后台'}
            </div>
          </div>
          <div className="lr-right">
            {rel && !rel.batteryUnrestricted ? (
              <button className="btn sm primary" disabled={relBusy} onClick={function () {
                setRelBusy(true);
                Reliability.openBatterySettings().catch(function () { /* 用户可能取消 */ })
                  .then(function () { setTimeout(refreshReliability, 1500); setRelBusy(false); });
              }}>去设置</button>
            ) : null}
          </div>
        </div>

        <div className="list-row">
          <div className="dot warn" />
          <div>
            <div className="lr-label">自启动 / 后台运行</div>
            <div className="lr-sub">
              {rel && rel.manufacturer ? '检测到 ' + rel.manufacturer + ' 设备，需要在系统里手动允许' : '国产 ROM 需要手动允许，否则清理后台后提醒会消失'}
            </div>
          </div>
          <div className="lr-right">
            <button className="btn sm" disabled={!rel} onClick={function () {
              Reliability.openAutoStartSettings().catch(function () { /* 忽略 */ });
            }}>去设置</button>
          </div>
        </div>

        <div
          className="list-row tap" style={{ cursor: 'pointer' }}
          onClick={function () {
            if (!rel) { showToast('当前平台没有系统设置页', 'info'); return; }
            Reliability.openAppDetails().catch(function () { showToast('打不开系统设置', 'warn'); });
          }}
        >
          <div>
            <div className="lr-label">打开系统应用设置</div>
            <div className="lr-sub">通知、权限、存储等都在这里，找不到入口时从这进</div>
          </div>
          <div className="lr-right">›</div>
        </div>

        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={refreshReliability}>
          <div>
            <div className="lr-label">重新检测</div>
            <div className="lr-sub">设置完回到这里点一下，确认已经放行</div>
          </div>
          <div className="lr-right">↻</div>
        </div>
      </Panel>
      ) : (
        <WebReminderPanel />
      )}

      <Panel title="默认提醒规则" sub={offsets.length ? offsets.map(function (o) { return o + ' 分钟'; }).join(' + ') : '已关闭'} desc="没有单独设置过的课程都用这一套；在课程详情里可以按课程覆盖。">
        <div className="chip-row">
          {REMIND_OPTIONS.map(function (m) {
            const on = offsets.indexOf(m) >= 0;
            return (
              <button
                key={m}
                className={on ? 'chip on' : 'chip'}
                onClick={function () {
                  const next = on ? offsets.filter(function (x) { return x !== m; }) : offsets.concat([m]).sort(function (a, b) { return b - a; });
                  setReminderRule('global', null, next, next.length > 0);
                  patchPrefs({ reminderOffsets: next });
                }}
              >课前 {m} 分钟</button>
            );
          })}
        </div>
        <SwitchRow
          label="每日课表摘要" sub="前一天晚上提醒明天的课"          on={s.prefs.dailyBrief}
          onChange={function (v) { patchPrefs({ dailyBrief: v }); }}
        />
        <div className="chip-row">
          {[20, 21, 22].map(function (h) {
            return (
              <button
                key={h}
                className={s.prefs.briefHour === h ? 'chip on' : 'chip'}
                onClick={function () { patchPrefs({ briefHour: h }); }}
              >{h}:00 发送</button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="操作保护"
        sub={s.prefs.studioLocked !== false ? '外观已锁' : '外观已解锁'}
        desc="针对误触做的几层保护。改错了大部分操作都能用提示条上的「撤销」还原。"      >
        <SwitchRow
          label="外观锁定"
          sub="外观页默认只读，需要先点「解锁」才能改；离开页面或 3 分钟不动会自动锁回去"
          on={s.prefs.studioLocked !== false}
          onChange={function (v) { patchPrefs({ studioLocked: v }); }}
        />
        <SwitchRow
          label="危险操作二次确认"
          sub="删除课程、清空课表、导入覆盖时先弹窗确认"          on={s.prefs.confirmDestructive !== false}
          onChange={function (v) { patchPrefs({ confirmDestructive: v }); }}
        />
      </Panel>

      <Panel title="学期" sub={term.totalWeeks === undefined ? '不设结束' : term.totalWeeks + ' 周'} desc="开学第一周的周一决定所有课程的日期映射。总周数留空 = 学期不设结束，课表可以一直往后翻。">
        <div className="list-row">
          <div>
            <div className="lr-label">开学第一周周一</div>
            <div className="lr-sub">{term.startDate}</div>
          </div>
          <div className="lr-right">
            <div style={{ width: 152 }}>
              <DateField title="开学第一周周一" clearable={false} value={dateDraft} onChange={setCommitDate} />
            </div>
          </div>
        </div>
        <div className="list-row">
          <div>
            <div className="lr-label">总周数</div>
            <div className="lr-sub">留空表示不设结束</div>
          </div>
          <div className="lr-right">
            <input className="input" type="number" min={1} max={MAX_WEEK} placeholder="不限" style={{ width: 82 }} value={weeksDraft}
              onChange={function (e) { setWeeksDraft(e.target.value); }} onBlur={commitTerm} />
          </div>
        </div>
      </Panel>

      <Panel
        title="作息与节次"
        sub={scheme.name}
        desc="课程只记录「第几节」，具体几点由作息方案决定。切换冬夏令时不用重录任何课程。"      >
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openScheme}>
          <div>
            <div className="lr-label">作息方案与节次时间</div>
            <div className="lr-sub">
              {s.data.schemes.length} 套方案 · 当前 {scheme.periods.length} 节，第 1 节 {scheme.periods[0] ? scheme.periods[0].start : '--:--'} 开始            </div>
          </div>
          <div className="lr-right">›</div>
        </div>
      </Panel>

      <Panel title="课表数据" sub={s.data.courses.length + ' 门课 · ' + s.data.sessions.length + ' 个时段'} desc="数据存在这台设备的浏览器里，随时可以导出带走。">
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={exportTimetable}>
          <div>
            <div className="lr-label">导出课表数据</div>
            <div className="lr-sub">完整 JSON，包含课程、时段、调课记录与提醒规则</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void shareWeekImage(); }}>
          <div>
            <div className="lr-label">把本周课表导出成图片</div>
            <div className="lr-sub">生成一张长图，可以直接发微信 / QQ 给同学</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void exportIcsNow(); }}>
          <div>
            <div className="lr-label">导出为 ICS 日历</div>
            <div className="lr-sub">手机自带日历、Google Calendar、Outlook 都能直接导入</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { if (icsRef.current) icsRef.current.click(); }}>
          <div>
            <div className="lr-label">从 ICS 导入</div>
            <div className="lr-sub">读入教务系统或其他课表 App 导出的 .ics 文件</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <input
          ref={icsRef} type="file" accept=".ics,text/calendar" style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            if (f) void importIcsFromFile(f);
            e.target.value = '';
          }}
        />
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openImportSheet}>
          <div>
            <div className="lr-label">从 Excel / CSV 导入</div>
            <div className="lr-sub">读教务系统导出的表格，自动认列、预览确认后再写入</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div
          className="list-row tap" style={{ cursor: 'pointer' }}
          onClick={function () { if (importRef.current) importRef.current.click(); }}
        >
          <div>
            <div className="lr-label">导入课表数据</div>
            <div className="lr-sub">选择之前导出的 JSON，会覆盖当前课表</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <input
          ref={importRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            const n = s.data.courses.length;
            /* 先把 input 清空，再把文件交给异步流程 —— 否则同一个文件选第二次不触发 */
            e.target.value = '';
            if (!f) return;
            void (async function () {
              if (await confirmDanger('导入会覆盖当前的 ' + n + ' 门课，继续吗？', '覆盖导入')) {
                await importTimetableFromFile(f);
              }
            })();
          }}
        />
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openShare('export'); }}>
          <div>
            <div className="lr-label">生成分享码</div>
            <div className="lr-sub">把课表压成一段文本发给同学，对方粘贴即可还原</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openShare('import'); }}>
          <div>
            <div className="lr-label">从分享码导入</div>
            <div className="lr-sub">粘贴同学发来的分享码，覆盖当前课表</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openExport}>
          <div>
            <div className="lr-label">导出为表格 / 文档</div>
            <div className="lr-sub">CSV 与 Markdown 格式，由插件提供（可在下面管理）</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void exportThemeNow(); }}>
          <div>
            <div className="lr-label">导出当前外观</div>
            <div className="lr-sub">主题包，含壁纸图片，可发给同学直接导入</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div
          className="list-row tap" style={{ cursor: 'pointer' }}
          onClick={function () {
            if (s.data.courses.length === 0) { showToast('课表本来就是空的', 'info'); return; }
            const n = s.data.courses.length;
            void (async function () {
              if (await confirmDanger('清空全部 ' + n + ' 门课？清空后可以点提示条上的「撤销」还原。', '清空')) clearAllCourses();
            })();
          }}
        >
          <div>
            <div className="lr-label" style={{ color: 'var(--c-danger)' }}>清空全部课程</div>
            <div className="lr-sub">保留外观与学期设置，只删课程数据</div>
          </div>
          <div className="lr-right">›</div>
        </div>
      </Panel>

      <PluginsPanel />

      <Panel>
        <SwitchRow
          label="排查工具"
          sub="显示提醒排程、权限状态、存储占用等排查面板。平时不需要打开。"
          on={s.prefs.debug === true}
          onChange={function (v) { patchPrefs({ debug: v }); }}
        />
      </Panel>

      {s.prefs.debug ? (
        <React.Fragment>
          <div className="section-title">调试</div>
          <DebugSection n={n} rel={rel} />
        </React.Fragment>
      ) : null}

      <Panel title="关于">
        <div className="list-row">
          <div>
            <div className="lr-label">课表助手</div>
            <div className="lr-sub">版本 {APP_VERSION || '?'} · 本地优先 · 无广告 · 无追踪</div>
          </div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openManual(); }}>
          <div>
            <div className="lr-label">使用说明书</div>
            <div className="lr-sub">从第一次打开讲到换机迁移，随时可查</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openChangelog}>
          <div>
            <div className="lr-label">更新日志</div>
            <div className="lr-sub">每个版本改了什么，都在这里</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { patchPrefs({ privacySeen: false }); }}>
          <div>
            <div className="lr-label">隐私说明</div>
            <div className="lr-sub">数据只在本机 · 无广告 · 无追踪 · 随时可导出带走</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        {!isNativePlatform() && ANDROID_RELEASE_URL ? (
          <a
            className="list-row tap" style={{ cursor: 'pointer' }}
            href={ANDROID_RELEASE_URL} target="_blank" rel="noreferrer noopener"
          >
            <div>
              <div className="lr-label">Android 版</div>
              <div className="lr-sub">需要关掉也能提醒，或者想要桌面小组件，就装这个版本；数据可以导出带走</div>
            </div>
            <div className="lr-right">›</div>
          </a>
        ) : null}
        <div className="panel-desc">
          {isNativePlatform()
            ? '所有数据只保存在这台设备上，不会上传到任何服务器。提醒由系统闹钟负责，息屏或关闭应用后依然有效。随时可以在「课表数据」里导出完整备份。'
            : '这是网页版：数据只保存在这个浏览器里，清除站点数据会一起清掉，不会上传到任何服务器。提醒靠页面内的通知，需要页面保持打开。换设备前请先在「课表数据」里导出完整备份。'}
        </div>
      </Panel>
    </div>
  );
}
