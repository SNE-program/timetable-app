import React from 'react';
import {
  clearAllCourses, confirmDanger, exportIcsNow, exportThemeNow, importIcsFromFile, importTimetableFromFile,
  openChangelog, openCloudSheet, openExport, openHistory, openImportSheet, openManual, openScheme,
  openShare, patchPrefs,
  setNotifyStatus, shareWeekImage, toastSave, setReminderRule, setTerm, showToast, updateLine, useApp,
  checkUpdateNow,
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
import { isNativePlatform } from '../platform/nativeBridge';
import { DOWNLOAD_PAGE } from '../app/meta';
import { cloudConfigured } from '../cloud/config';
import DebugSection from './DebugSection';
import { countRender } from '../app/renderCount';

const REMIND_OPTIONS = [30, 15, 10, 5];

const PERM_TEXT: Record<string, string> = {
  granted: '已允许',
  denied: '已被拒绝。可以点「申请」重新请求，或去系统设置里打开',
  default: '还没申请',
  unknown: '暂时读不到（系统没有响应），展开下面的排错项看看卡在哪一步',
  unsupported: '当前环境不支持',
};

/**
 * 设置页。
 *
 * ## 这一版把它重新排过：常显的只有"此刻要知道的"
 *
 * 以前这里是十几块面板一路平铺：提醒通道、小组件、可靠性、默认规则、操作保护、
 * 学期、作息、课表数据（12 行）、云备份、插件、排查工具、关于 ——
 * 手机上一屏只看得到两块半，想找一样东西得从头翻到尾。
 *
 * 现在：
 *   - **合并**：提醒相关的四块并成一块；学期与作息并成一块；
 *   - **收起**：一次性动作（导入导出）、排错细节、进阶外观，默认收起来；
 *     收起时**不渲染正文**，顺带省一份挂载；
 *   - **去重**：云备份原来在设置里有一整套面板、右上角又有一个弹层（同一组件两份入口），
 *     现在设置里只留一行入口，登录、备份、恢复、改密码全在弹层里做；
 *     「隐私说明」原来是把首次启动那屏再放一遍，现在直接翻到说明书的隐私一章。
 */
export default function SettingsView() {
  countRender('SettingsView');
  const s = useApp();
  const term = s.data.term;
  const offsets = s.prefs.reminderOffsets;
  const n = s.notify;
  const native = isNativePlatform();
  const [dateDraft, setDateDraft] = React.useState(term.startDate);
  const [weeksDraft, setWeeksDraft] = React.useState(term.totalWeeks === undefined ? '' : String(term.totalWeeks));
  const [busy, setBusy] = React.useState(false);
  const [rel, setRel] = React.useState<ReliabilityInfo | null>(null);
  const [relBusy, setRelBusy] = React.useState(false);

  const refreshReliability = React.useCallback(function () {
    if (!isReliabilitySupported()) { setRel(null); return; }
    withDeadline(Reliability.check(), 12000, '系统可靠性检测').then(function (r) { setRel(r.ok ? r.value : null); });
  }, []);

  /*
   * 可靠性检测要过原生桥，只在**安卓**上跑，而且放到空闲时跑 ——
   * 设置页一打开就跟首屏抢桥，是这一页最没必要的开销之一。
   */
  React.useEffect(function () {
    if (!native) return;
    let idle: number | null = null;
    const run = function (): void { refreshReliability(); };
    try {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === 'function') { idle = ric(run, { timeout: 1500 }); return function () { /* 一次性 */ }; }
    } catch (e) { /* 退化到下面的 setTimeout */ }
    idle = window.setTimeout(run, 400);
    return function () { if (idle !== null) window.clearTimeout(idle); };
  }, [native, refreshReliability]);

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

  const remindSub = !n ? '检测中…'
    : n.permission === 'granted'
      ? (offsets.length ? offsets.map(function (o) { return o + ' 分钟'; }).join(' + ') : '已关闭')
      : '通知权限未开启';

  return (
    <div>
      {/* ------------------------------ 提醒 ------------------------------ */}
      <Panel
        title="提醒"
        sub={n ? n.displayName : '检测中…'}
        desc="课前提醒、每日摘要都在这里。排程细节与国产 ROM 的省电设置收在下面，平时不用管。"
      >
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

        <div className="list-row">
          <div>
            <div className="lr-label">默认提醒</div>
            <div className="lr-sub">{remindSub} —— 单门课可以在课程详情里单独设</div>
          </div>
        </div>
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
              >课前 {m} 分</button>
            );
          })}
        </div>

        <SwitchRow
          label="每日课表摘要"
          sub={s.prefs.dailyBrief ? '前一天晚上 ' + s.prefs.briefHour + ':00 提醒明天的课' : '已关闭'}
          on={s.prefs.dailyBrief}
          onChange={function (v) { patchPrefs({ dailyBrief: v }); }}
        />
        {s.prefs.dailyBrief ? (
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
        ) : null}

        <Panel title="排程与可靠性" sub={native ? (rel ? (rel.batteryUnrestricted ? '已放行' : '需要设置') : '检测中…') : '网页版的限制'} collapsible>
          {native ? (
            <React.Fragment>
              <div className="list-row">
                <div className={'dot ' + (n && n.exactAlarm === 'granted' ? 'ok' : n && n.exactAlarm === 'unsupported' ? 'warn' : 'bad')} />
                <div>
                  <div className="lr-label">精确闹钟</div>
                  <div className="lr-sub">
                    {!n ? '—'
                      : n.exactAlarm === 'granted' ? '已授权，提醒可以准到分钟'
                      : n.exactAlarm === 'unsupported' ? '当前平台不需要这项授权'
                      : '未授权。系统会把提醒延后几分钟到几十分钟'}
                  </div>
                </div>
                <div className="lr-right">
                  {n && (n.exactAlarm === 'denied' || n.exactAlarm === 'unknown') ? (
                    <button className="btn sm primary" onClick={askExactAlarm}>授权</button>
                  ) : null}
                </div>
              </div>

              <div className="list-row">
                <div className={'dot ' + (n && n.scheduled > 0 ? 'ok' : 'warn')} />
                <div>
                  <div className="lr-label">已排入通知系统</div>
                  <div className="lr-sub">{!n ? '—' : n.scheduled + ' 条（未来 7 天滚动排程）'}</div>
                </div>
              </div>

              <div className="list-row">
                <div className={'dot ' + (n && n.survivesAppClose ? 'ok' : 'bad')} />
                <div>
                  <div className="lr-label">关闭 App 后仍能提醒</div>
                  <div className="lr-sub">{n && n.survivesAppClose ? '是，已交给系统闹钟' : '否，仅页面开着时有效'}</div>
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

              <div className="check-actions" style={{ borderTop: 0, paddingTop: 4 }}>
                <button className="btn sm" onClick={function () {
                  if (!rel) { showToast('当前平台没有系统设置页', 'info'); return; }
                  Reliability.openAppDetails().catch(function () { showToast('打不开系统设置', 'warn'); });
                }}>系统应用设置</button>
                <button className="btn sm ghost" onClick={refreshReliability}>重新检测</button>
              </div>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div className="list-row">
                <div className="dot warn" />
                <div>
                  <div className="lr-label">页面要保持打开</div>
                  <div className="lr-sub">
                    提醒由这个页面的定时器负责。关掉标签页、或系统把浏览器彻底休眠之后，提醒不会响 ——
                    这是浏览器的限制。想要关掉也响，装 Android 版。
                  </div>
                </div>
              </div>
              <div className="list-row">
                <div className="dot warn" />
                <div>
                  <div className="lr-label">后台标签页会被限速</div>
                  <div className="lr-sub">切到别的标签页后定时器会被放慢（几秒到几分钟）。课前把它留在前台最稳。</div>
                </div>
              </div>
              <div className="list-row">
                <div className={'dot ' + (n && n.scheduled > 0 ? 'ok' : 'warn')} />
                <div>
                  <div className="lr-label">已排入的提醒</div>
                  <div className="lr-sub">{!n ? '—' : n.scheduled + ' 条（页面内的定时器，关掉页面即失效）'}</div>
                </div>
              </div>
            </React.Fragment>
          )}

          {n && n.note ? <div className="panel-desc">{n.note}</div> : null}

          <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
            <button className="btn block" disabled={busy} onClick={testNotify}>
              {busy ? '发送中…' : '发一条测试通知'}
            </button>
          </div>
        </Panel>
      </Panel>

      {/* 小组件只有安卓有；网页版不摆一块"为什么没有"的说明，想要就去下载页 */}
      {native ? <WidgetPanel /> : null}

      {/* ------------------------------ 学期与作息 ------------------------------ */}
      <Panel
        title="学期与作息"
        sub={(term.totalWeeks === undefined ? '不设结束' : term.totalWeeks + ' 周') + ' · ' + scheme.name}
        desc="开学第一周的周一决定所有课程的日期映射；几点上课由作息方案决定，切冬夏令时不用重录课程。"
        collapsible
      >
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
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openScheme}>
          <div>
            <div className="lr-label">作息方案与节次时间</div>
            <div className="lr-sub">
              {s.data.schemes.length} 套方案 · 当前 {scheme.periods.length} 节，第 1 节 {scheme.periods[0] ? scheme.periods[0].start : '--:--'} 开始
            </div>
          </div>
          <div className="lr-right">›</div>
        </div>
      </Panel>

      {/* ------------------------------ 课表数据 ------------------------------ */}
      <Panel
        title="课表数据"
        sub={s.data.courses.length + ' 门课 · ' + s.data.sessions.length + ' 个时段'}
        desc="数据只存在这台设备上。导入会覆盖当前课表（会先问你一句，事后也能撤销）。"
        collapsible
      >
        <div className="section-title">导入</div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openImportSheet}>
          <div>
            <div className="lr-label">从 Excel / CSV 导入</div>
            <div className="lr-sub">读教务系统导出的表格，自动认列、预览确认后再写入</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { if (icsRef.current) icsRef.current.click(); }}>
          <div>
            <div className="lr-label">从 ICS 日历导入</div>
            <div className="lr-sub">教务系统或其他课表 App 导出的 .ics 文件</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openShare('import'); }}>
          <div>
            <div className="lr-label">从分享码导入</div>
            <div className="lr-sub">粘贴同学发来的分享码</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div
          className="list-row tap" style={{ cursor: 'pointer' }}
          onClick={function () { if (importRef.current) importRef.current.click(); }}
        >
          <div>
            <div className="lr-label">从备份文件导入</div>
            <div className="lr-sub">之前导出的 JSON</div>
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
        <input
          ref={importRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            const cnt = s.data.courses.length;
            /* 先把 input 清空，再把文件交给异步流程 —— 否则同一个文件选第二次不触发 */
            e.target.value = '';
            if (!f) return;
            void (async function () {
              if (await confirmDanger('导入会覆盖当前的 ' + cnt + ' 门课，继续吗？', '覆盖导入')) {
                await importTimetableFromFile(f);
              }
            })();
          }}
        />

        <div className="section-title">导出与分享</div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={exportTimetable}>
          <div>
            <div className="lr-label">导出完整备份（JSON）</div>
            <div className="lr-sub">课程、时段、调课、任务、出勤、外观与提醒规则，换机就靠它</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openShare('export'); }}>
          <div>
            <div className="lr-label">生成分享码</div>
            <div className="lr-sub">压成一段文本发给同学，对方粘贴就能还原</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void shareWeekImage(); }}>
          <div>
            <div className="lr-label">导出本周课表图片</div>
            <div className="lr-sub">一张长图，直接发微信 / QQ</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void exportIcsNow(); }}>
          <div>
            <div className="lr-label">导出为 ICS 日历</div>
            <div className="lr-sub">手机自带日历、Google Calendar、Outlook 都能导入</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openExport}>
          <div>
            <div className="lr-label">导出为表格 / 文档</div>
            <div className="lr-sub">CSV 与 Markdown，由插件提供</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void exportThemeNow(); }}>
          <div>
            <div className="lr-label">导出当前外观</div>
            <div className="lr-sub">主题包（含壁纸图片），同学导入就能用</div>
          </div>
          <div className="lr-right">›</div>
        </div>

        <div className="section-title">危险</div>
        <div
          className="list-row tap" style={{ cursor: 'pointer' }}
          onClick={function () {
            if (s.data.courses.length === 0) { showToast('课表本来就是空的', 'info'); return; }
            const cnt = s.data.courses.length;
            void (async function () {
              if (await confirmDanger('清空全部 ' + cnt + ' 门课？清空后可以点提示条上的「撤销」还原。', '清空')) clearAllCourses();
            })();
          }}
        >
          <div>
            <div className="lr-label" style={{ color: 'var(--c-danger)' }}>清空全部课程</div>
            <div className="lr-sub">保留外观、任务与学期设置，只删课程数据</div>
          </div>
          <div className="lr-right">›</div>
        </div>
      </Panel>

      {/* ------------------------------ 保护 ------------------------------ */}
      <Panel
        title="防误触与撤销"
        sub={s.history.undo > 0 ? '可撤销 ' + s.history.undo + ' 步' : (s.prefs.studioLocked !== false ? '外观已锁' : '外观已解锁')}
        collapsible
      >
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openHistory}>
          <div>
            <div className="lr-label">操作历史</div>
            <div className="lr-sub">
              {s.history.undo > 0
                ? '最近 ' + s.history.undo + ' 步改动都在这里，可以退回任意一步（刚才：' + (s.history.lastLabel || '—') + '）'
                : '还没有可撤销的改动；这里能看到最近的改动并退回任意一步'}
            </div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <SwitchRow
          label="外观锁定"
          sub="外观页默认只读，要先点「解锁」才能改；离开页面或 3 分钟不动会自动锁回去"
          on={s.prefs.studioLocked !== false}
          onChange={function (v) { patchPrefs({ studioLocked: v }); }}
        />
        <SwitchRow
          label="危险操作二次确认"
          sub="删除课程、清空课表、覆盖导入时先弹窗确认"
          on={s.prefs.confirmDestructive !== false}
          onChange={function (v) { patchPrefs({ confirmDestructive: v }); }}
        />
      </Panel>

      {/* ------------------------------ 云（可选） ------------------------------ */}
      {cloudConfigured() ? (
        <Panel
          title="云备份与云端角色"
          sub={s.cloud.session ? s.cloud.session.user.email : '未登录'}
          desc="可选功能：登录后可以把课表备份到项目自己的服务器、把角色传到云端共享。不登录就完全不联网。"
        >
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openCloudSheet}>
            <div>
              <div className="lr-label">打开云备份</div>
              <div className="lr-sub">
                {s.cloud.session
                  ? (s.cloud.backup ? '登录中 · 云端有备份 · 也可以在这里传角色' : '登录中 · 云端还没有备份')
                  : '登录 / 注册 · 备份与恢复 · 云端角色'}
              </div>
            </div>
            <div className="lr-right">›</div>
          </div>
        </Panel>
      ) : null}

      <PluginsPanel />

      {/* ------------------------------ 关于 ------------------------------ */}
      <Panel title="关于" sub={'v' + (APP_VERSION || '?')}>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openManual(); }}>
          <div>
            <div className="lr-label">使用说明书</div>
            <div className="lr-sub">第一次打开到换机迁移，每一处功能都写了</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openChangelog}>
          <div>
            <div className="lr-label">更新日志</div>
            <div className="lr-sub">每一版改了什么</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        <div
          className="list-row tap" style={{ cursor: 'pointer' }}
          onClick={function () { void checkUpdateNow(true); }}
        >
          <div>
            <div className="lr-label">检查更新</div>
            <div className="lr-sub">{updateLine()}</div>
          </div>
          <div className="lr-right">{s.update.checking ? '…' : '›'}</div>
        </div>
        {native ? (
          <SwitchRow
            label="启动时自动检查更新"
            sub="只读一个静态文件，不带任何标识；关掉之后不会再为这件事联网"
            on={s.prefs.autoCheckUpdate !== false}
            onChange={function (v) { patchPrefs({ autoCheckUpdate: v }); }}
          />
        ) : null}
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openManual('privacy'); }}>
          <div>
            <div className="lr-label">隐私说明</div>
            <div className="lr-sub">数据在哪、什么时候联网 —— 说明书里那一章</div>
          </div>
          <div className="lr-right">›</div>
        </div>
        {!native ? (
          <a className="list-row tap" style={{ cursor: 'pointer' }} href={DOWNLOAD_PAGE}>
            <div>
              <div className="lr-label">获取 Android 版</div>
              <div className="lr-sub">关掉应用也能提醒、还能放桌面小组件；数据导过去就行</div>
            </div>
            <div className="lr-right">›</div>
          </a>
        ) : null}
        <div className="panel-desc">
          {native
            ? '数据只保存在这台设备上，提醒交给系统闹钟。'
            : '这是网页版：数据只保存在这个浏览器里，清除站点数据会一起清掉。'}
          {cloudConfigured() ? '云备份是可选的，不登录不会上传任何东西。' : '不会上传到任何服务器。'}
        </div>
      </Panel>

      {/* ------------------------------ 排查 ------------------------------ */}
      <Panel>
        <SwitchRow
          label="排查工具"
          sub="提醒排程、权限状态、存储占用等排查面板。平时不用打开。"
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
    </div>
  );
}
