import React from 'react';
import { showToast } from '../app/store';
import { testsFor, loadDeviceChecks, saveDeviceChecks, type DeviceTest } from '../app/deviceCheck';
import { getNotifier } from '../platform';
import { isNativePlatform } from '../platform/nativeBridge';
import type { NotifierStatus } from '../platform/types';
import { Reliability, type ReliabilityInfo } from '../platform/reliability';
import { collectDiagnostics, withDeadline } from '../app/asyncAction';
import { saveTextFile } from '../platform/saveFile';
import { assetUsage } from '../storage';
import { Panel } from './common';

/**
 * 提醒可靠性检查清单。
 *
 * Android 版是计划书 10.2 节的 8 项：息屏、强停、重启、改时间、换时区、
 * 省电模式、同一分钟多条、拒绝权限 —— 这些没法用单测覆盖，国产 ROM 的
 * 省电策略又千差万别，只能在一台台真机上跑。
 *
 * 网页版换成了另外三项，而且其中一项本身就是"关掉页面就不会响"。
 * 这不是自曝其短：这个品类里最伤人的是含糊其辞 —— 用户以为关了页面
 * 也会响，结果错过一节课，然后卸载。把边界写在勾选清单里最显眼。
 */
export default function DeviceCheckPanel(props: { n?: NotifierStatus | null; rel?: ReliabilityInfo | null }) {
  const native = isNativePlatform();
  const tests: DeviceTest[] = testsFor(native);
  const [done, setDone] = React.useState<string[]>(loadDeviceChecks);
  const [busy, setBusy] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);

  /**
   * 导出报告。
   *
   * 检查结果只有在真机上才有意义，而"逐条口述给开发者"既不现实也容易漏。
   * 这里把版本、运行环境、通知状态、以及各项勾选情况拼成一份文本，
   * 走系统分享面板（网页版走下载）发出去 —— 排查时能省掉大半来回确认。
   */
  async function exportReport(): Promise<void> {
    setReporting(true);
    try {
      let rel = props.rel || null;
      if (!rel && native) {
        try { rel = await withDeadline(Reliability.check(), 6000, '读取可靠性状态').then(function (r) { return r.ok ? r.value : null; }); } catch (e) { rel = null; }
      }
      const au = assetUsage();
      const n = props.n;
      /* 网页版没有电池白名单、厂商、强停这些概念，报告里也不该出现 */
      const head = native
        ? collectDiagnostics({
          '电池优化': rel ? (rel.batteryUnrestricted ? '已放行' : '未放行') : '未知',
          '厂商': rel ? rel.manufacturer + ' (SDK ' + rel.sdk + ')' : '未知',
          '通知权限': n ? n.permission : '未知',
          '精确闹钟': n ? n.exactAlarm : '未知',
          '已排入通知系统': n ? String(n.scheduled) + ' 条' : '未知',
          '关闭应用后仍能提醒': n ? (n.survivesAppClose ? '是' : '否') : '未知',
          '最近一次失败': n && n.lastError ? n.lastError : '无',
          '图片资产': au.count + ' 张 / ' + au.backend,
        })
        : collectDiagnostics({
          '运行环境': '浏览器（网页版）',
          '页面状态': typeof document !== 'undefined' && document.visibilityState === 'visible' ? '前台' : '后台或不可见',
          '通知权限': n ? n.permission : '未知',
          '已排入排程': n ? String(n.scheduled) + ' 条（浏览器定时器）' : '未知',
          '关掉页面后仍能提醒': '否（浏览器限制，非故障）',
          '最近一次失败': n && n.lastError ? n.lastError : '无',
          '图片资产': au.count + ' 张 / ' + au.backend,
        });

      const lines = [
        '课表助手 · 提醒可靠性检查报告',
        '生成时间: ' + new Date().toLocaleString(),
        '',
        '—— 运行环境 ——',
        head,
        '',
        '—— ' + tests.length + ' 项检查（' + done.length + ' / ' + tests.length + '）——',
      ];
      tests.forEach(function (t, i) {
        lines.push('[' + (done.indexOf(t.id) >= 0 ? 'x' : ' ') + '] ' + (i + 1) + '. ' + t.title);
      });
      lines.push('');
      lines.push(native
        ? '未通过或未验证的项，说明提醒在那种场景下可能不可靠。'
        : '未通过的项说明提醒可能不生效；网页版的边界已在上面写明。');
      lines.push('（这份报告由本机生成，不含任何课表内容。）');

      const r = await saveTextFile({
        fileName: '课表助手-检查报告.txt',
        text: lines.join('\n'),
        mime: 'text/plain;charset=utf-8',
        title: '课表助手 · 提醒可靠性检查报告',
        dialogTitle: '导出检查报告',
      });
      if (r === 'shared') showToast('报告已生成，选「保存到文件」或直接发出去', 'ok');
      else if (r === 'saved') showToast(native ? '报告已保存到「文档」目录' : '报告已下载到浏览器的下载目录', 'ok');
      else if (r === 'cancelled') showToast('已取消', 'info');
      else showToast('导出报告失败', 'error');
    } finally {
      setReporting(false);
    }
  }

  function toggle(id: string): void {
    const next = done.indexOf(id) >= 0 ? done.filter(function (x) { return x !== id; }) : done.concat([id]);
    setDone(next);
    saveDeviceChecks(next);
  }

  /** 排一条 10 秒后的通知 —— 留出切后台 / 锁屏的时间 */
  async function fireDelayed(): Promise<void> {
    setBusy(true);
    try {
      const nt = getNotifier();
      const r = await withDeadline(
        nt.fireNow({
          fingerprint: 'device-check@' + Date.now(),
          title: '测试通知 · 10 秒后送达',
          body: native
            ? '如果你是在锁屏或关掉应用之后看到这条，说明后台提醒是通的。'
            : '这条准时出现，说明当前页面的提醒是通的。',
          at: Date.now() + 10000,
          channel: 'class-reminder',
        }, 10000),
        20000, '发送测试通知'
      );
      showToast(
        r.ok && r.value
          ? (native ? '已排入，10 秒后到 —— 现在可以锁屏了' : '已排入，10 秒后到 —— 别关掉这个页面')
          : '发送失败：' + (r.ok ? '系统拒绝了' : r.error),
        r.ok && r.value ? 'ok' : 'warn'
      );
    } finally {
      setBusy(false);
    }
  }

  const total = tests.length;
  const n = done.length;
  const pct = total > 0 ? Math.round(n / total * 100) : 0;

  return (
    <Panel
      title="提醒可靠性检查"
      sub={n + ' / ' + total}
      desc={native
        ? '提醒能否穿透息屏、后台清理、重启与省电模式，只有在真机上才能确认。逐条完成后勾选，进度保存在本机。'
        : '网页版能做的和做不到的，都在下面这三条里。逐条确认后勾选，进度保存在本机。'}
    >
      <div className="check-progress">
        <div className="check-bar"><i style={{ width: pct + '%' }} /></div>
        <span className="check-pct">{pct}%</span>
      </div>

      {tests.map(function (t) {
        const on = done.indexOf(t.id) >= 0;
        return (
          <div className={'check-row' + (on ? ' done' : '')} key={t.id}>
            <button
              className={on ? 'task-check on' : 'task-check'}
              aria-pressed={on}
              aria-label={t.title}
              onClick={function () { toggle(t.id); }}
            >{on ? '✓' : ''}</button>
            <div className="check-main">
              <div className="check-title">{t.title}</div>
              <div className="check-how">{t.how}</div>
            </div>
          </div>
        );
      })}

      <div className="check-actions">
        <button className="btn sm" disabled={busy} onClick={function () { void fireDelayed(); }}>
          {busy ? '发送中…' : '10 秒后提醒我'}
        </button>
        <button className="btn sm" disabled={reporting} onClick={function () { void exportReport(); }}>
          {reporting ? '导出中…' : '导出报告'}
        </button>
        {n > 0 ? (
          <button
            className="btn sm ghost"
            onClick={function () { setDone([]); saveDeviceChecks([]); showToast('已清空检查进度', 'ok'); }}
          >清空进度</button>
        ) : null}
      </div>

      <div className="panel-desc" style={{ paddingTop: 4 }}>
        {native
          ? '任何一条没通过，都值得去「设置 → 提醒 → 排程与可靠性」里检查电池优化与自启动设置 —— 那两项不放行的话，国产 ROM 会在后台冻结应用，闹钟自然就哑了。'
          : '网页版的提醒依赖页面保持打开，所以「关掉页面」那一条永远打不上勾 —— 那条写在这里，是为了让你在考前就知道该开着哪个页面。'}
      </div>
    </Panel>
  );
}
