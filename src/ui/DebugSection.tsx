import React from 'react';
import {
  confirmDanger, setNotifyStatus, showToast, storageUsage, useApp, type StorageUsage,
} from '../app/store';
import { clearFiredLog } from '../app/reminderRuntime';
import { getNotifier } from '../platform';
import { Reliability, type ReliabilityInfo } from '../platform/reliability';
import type { NotifierStatus, NotifyItem, ProbeStep } from '../platform/types';
import { collectDiagnostics, copyText, withDeadline } from '../app/asyncAction';
import { APP_VERSION, BUILD_TIME } from '../app/version';
import { assetUsage } from '../storage';
import { formatBytes as fmtBytes } from '../theme/image';
import { Panel } from './common';
import DeviceCheckPanel from './DeviceCheckPanel';

/**
 * 调试面板。
 *
 * 这些都是**排查用**的东西：权限卡住时看卡在哪一步、排程不对时看真实排了什么、
 * 存储满了看是谁占的。对日常使用没有价值，却占了设置页一大半篇幅 ——
 * 所以收进「排查工具」，默认不显示。
 *
 * 保留在常规设置里的只有一件事：**通知能不能响**（测试通知按钮）。
 * 那是每个用户都会关心的，不该藏在调试里。
 */

/** 明天 / 后天 / 9/13 这种相对日期，排程清单里比绝对时间好读 */
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

/** 存储占用明细。数字本身没意义，能看出"谁占的"才有意义 */
function StorageRows() {
  const u = storageUsage();
  const au = assetUsage();
  const pct = Math.min(100, Math.round(u.total / u.limit * 100));
  return (
    <div>
      <div className="check-progress" style={{ paddingTop: 0 }}>
        <div className="check-bar"><i style={{ width: pct + '%' }} /></div>
        <span className="check-pct">{pct}%</span>
      </div>
      <div className="list-row">
        <div>
          <div className="lr-label">图片资产</div>
          <div className="lr-sub">
            {au.backend === 'sqlite' ? '存在 SQLite 里，不占本地存储配额'
              : au.backend === 'localStorage' ? 'SQLite 不可用，暂存在本地存储里'
              : '尚未初始化'}
          </div>
        </div>
        <div className="lr-right">{au.count} 张 · {fmtBytes(au.bytes)}</div>
      </div>
      {u.items.length === 0 ? (
        <div className="panel-desc">还没有任何数据。</div>
      ) : (
        u.items.map(function (it: StorageUsage) {
          return (
            <div className="list-row" key={it.key}>
              <div><div className="lr-label">{it.label}</div></div>
              <div className="lr-right">{fmtBytes(it.bytes)}</div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function DebugSection(props: { n: NotifierStatus | null; rel: ReliabilityInfo | null }) {
  const s = useApp();
  const [probeSteps, setProbeSteps] = React.useState<ProbeStep[] | null>(null);
  const [probeBusy, setProbeBusy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function runProbe(): Promise<void> {
    setProbeBusy(true);
    setProbeSteps([]);
    const collected: ProbeStep[] = [];
    try {
      const nt = getNotifier();
      if (!nt.probe) {
        setProbeSteps([{ name: '检查', ok: false, ms: 0, detail: '当前平台不支持环境检查' }]);
      } else {
        /* 每跑完一步立刻显示，卡住也能看到停在哪；整体 30 秒封顶 */
        const r = await withDeadline(nt.probe(function (st) {
          collected.push(st);
          setProbeSteps(collected.slice());
        }), 30000, '检查');
        if (!r.ok) {
          setProbeSteps(collected.concat([{ name: '整体超时', ok: false, ms: r.ms, detail: r.error }]));
        }
      }
    } catch (e) {
      setProbeSteps(collected.concat([{ name: '检查异常', ok: false, ms: 0, detail: (e as Error).message }]));
    } finally {
      setProbeBusy(false);
    }
  }

  async function resetSchedule(): Promise<void> {
    if (!props.rel) { showToast('当前平台不支持', 'warn'); return; }
    if (!(await confirmDanger('重置会取消所有已排入的通知，然后按当前课表重新排一遍。继续吗？', '重置'))) return;
    setBusy(true);
    try {
      const r = await withDeadline(Reliability.resetNotifications(), 10000, '重置通知排程');
      if (!r.ok) { showToast(r.error, 'error'); return; }
      clearFiredLog();
      const nt = getNotifier();
      const after = await withDeadline(nt.status(), 12000, '读取状态');
      if (after.ok) setNotifyStatus(after.value);
      showToast('已重置，下拉或重开应用即可重新排程', 'ok');
    } finally {
      setBusy(false);
    }
  }

  const upcoming: NotifyItem[] = s.upcoming;

  return (
    <React.Fragment>
      <Panel
        title="提醒排程"
        sub={probeSteps ? (probeSteps.every(function (x) { return x.ok; }) ? '全部通过' : '有失败项') : '未运行'}
        desc="提醒不响的时候，从这里看卡在哪一步。每一步都有自己的超时，不会一直转圈。"
      >
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
          <button className="btn primary" style={{ flex: 1 }} disabled={probeBusy} onClick={function () { void runProbe(); }}>
            {probeBusy ? '检查中…' : '逐步检查'}
          </button>
          <button
            className="btn ghost" style={{ flex: 1 }} disabled={busy}
            onClick={function () { clearFiredLog(); showToast('已清除发送记录，下次打开会重算补偿', 'ok'); }}
          >清除发送记录</button>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
          <button className="btn ghost block" disabled={busy} onClick={function () { void resetSchedule(); }}>
            {busy ? '处理中…' : '重置通知排程'}
          </button>
        </div>

        {probeSteps ? (
          <div className="card-block" style={{ margin: '0 14px 12px' }}>
            {probeSteps.map(function (st, i) {
              return (
                <div className="list-row" key={i}>
                  <div className={'dot ' + (st.running ? 'warn' : st.ok ? 'ok' : 'bad')} />
                  <div style={{ minWidth: 0 }}>
                    <div className="lr-label">{st.name}{st.running ? ' · 进行中' : ''}</div>
                    <div className="lr-sub">{st.detail}</div>
                  </div>
                  <div className="lr-right">{st.running ? '—' : st.ms + 'ms'}</div>
                </div>
              );
            })}
          </div>
        ) : null}
      </Panel>

      <Panel
        title="接下来的提醒"
        sub={upcoming.length + ' 条'}
        desc="这是真实排出去的计划：每条都会在你设定的时间点触发。改课表或改上面的设置，这里会立刻重排。"
      >
        {upcoming.length === 0 ? (
          <div className="panel-desc">
            {props.n && props.n.lastError
              ? '排程出错了，清单暂时读不到：' + props.n.lastError + ' —— 点上面的「逐步检查」看卡在哪一步。'
              : '未来 7 天没有需要提醒的课。加几门课，或者检查一下提醒设置。'}
          </div>
        ) : (
          upcoming.slice(0, 8).map(function (it) {
            return (
              <div className="list-row" key={it.fingerprint}>
                <div>
                  <div className="lr-label">{it.title}</div>
                  <div className="lr-sub">{it.body}</div>
                </div>
                <div className="lr-right">{whenLabel(it.at)}</div>
              </div>
            );
          })
        )}
        {upcoming.length > 8 ? (
          <div className="panel-desc">还有 {upcoming.length - 8} 条未显示</div>
        ) : null}
      </Panel>

      <DeviceCheckPanel n={props.n} rel={props.rel} />

      <Panel
        title="运行信息"
        desc="用于排查提醒、权限等异常。复制后可以反馈给开发者。"
      >
        <div className="list-row">
          <div style={{ minWidth: 0 }}>
            <div className="lr-label">版本与构建时间</div>
            <div className="lr-sub">{APP_VERSION || '未知'} · {BUILD_TIME || '未知'}</div>
          </div>
        </div>
        <div className="list-row">
          <div style={{ minWidth: 0 }}>
            <div className="lr-label">运行环境</div>
            <div className="lr-sub">
              {(() => {
                const cap = (window as any).Capacitor;
                const p = cap && cap.getPlatform ? cap.getPlatform() : 'web';
                return 'platform=' + p + ' · ' + window.innerWidth + 'x' + window.innerHeight;
              })()}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 14px' }}>
          <button
            className="btn primary" style={{ flex: 1 }}
            onClick={async function () {
              const text = collectDiagnostics({
                '通知状态': props.n ? JSON.stringify(props.n) : 'null',
                '已排程': upcoming.length + ' 条',
                '检查结果': probeSteps
                  ? probeSteps.map(function (x) { return (x.ok ? 'OK ' : 'FAIL ') + x.name + '(' + x.ms + 'ms) ' + x.detail; }).join(' | ')
                  : '未运行',
              });
              const ok = await copyText(text);
              showToast(ok ? '运行信息已复制，反馈问题时附上即可' : '复制失败，请手动截图', ok ? 'ok' : 'warn');
            }}
          >复制运行信息</button>
        </div>
      </Panel>

      <Panel
        title="本地存储"
        sub={fmtBytes(storageUsage().total) + ' / 约 ' + fmtBytes(storageUsage().limit)}
        desc="数据都存在这台设备上。浏览器给每个应用约 5MB 的本地存储，自定义壁纸和课程图片是大头 —— 占满了就存不下新改动了。"
      >
        <StorageRows />
      </Panel>
    </React.Fragment>
  );
}
