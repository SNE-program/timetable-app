import React from 'react';
import { Panel } from './common';
import WidgetPreview from './WidgetPreview';
import { showToast, useApp } from '../app/store';
import { buildWidgetPayload, pushWidgetData, widgetDeviceState, type WidgetDeviceState } from '../platform/widget';
import { WIDGET_PRESETS, planForPreset } from '../platform/widgetLayout';

/**
 * 桌面小组件：说明 + 尺寸预览 + 手动同步（只在 Android 版渲染）。
 *
 * 加这个面板是因为：小组件在桌面上，而功能入口在应用里 ——
 * 用户装了应用但从来不知道有小组件，是这类功能最常见的死法。
 *
 * v1.9.6 起这里会**按当前课表画出四个尺寸的预览**。以前只有一句「2×2 / 4×2」的文字，
 * 用户既不知道放上去长什么样，也不知道拉大之后会怎样 —— 于是拖上去看到一个空白方块，
 * 就得出结论「这个组件没有任何用处」。现在先把话说清楚，再让他去拖。
 *
 * 网页版**不渲染这一块**：浏览器没法往桌面放任何东西，讲一遍"为什么没有"
 * 只是又一次告诉用户他做不到的事 —— 想要的人去「关于 → 获取 Android 版」。
 */
export default function WidgetPanel() {
  const s = useApp();
  const [busy, setBusy] = React.useState(false);
  /* 设备端状态：桌面上放了几个、最后一次推到什么时候、下次什么时候自己翻页 */
  const [dev, setDev] = React.useState<WidgetDeviceState | null>(null);
  React.useEffect(function () { void widgetDeviceState().then(setDev); }, []);
  const payload = React.useMemo(function () { return buildWidgetPayload(s.data, new Date()); }, [s.data]);
  const rowText = WIDGET_PRESETS.map(function (x) {
    const plan = planForPreset(x);
    const n = x.kind === 'next' ? plan.extraRows : plan.listRows;
    return x.label + ' 显示 ' + n + ' 节';
  }).join(' · ');

  async function syncNow(): Promise<void> {
    setBusy(true);
    try {
      const ok = await pushWidgetData(s.data);
      /*
       * 推完**立刻回读设备端状态**：以前只报"已推送"，而"推过去了"与"桌面真的画出来了"
       * 是两件事 —— 推送成功但桌面实例是 0，用户看到的还是那句"打开应用同步一次"。
       */
      const st = await widgetDeviceState();
      setDev(st);
      if (!ok) showToast('推送失败：当前平台可能不支持', 'warn');
      else if (st && st.instancesNext + st.instancesTimetable === 0) {
        showToast('数据已推过去，但桌面上还没有小组件 —— 先长按桌面空白处添加一个', 'warn');
      } else showToast('已推送最新数据，桌面应该刷新了', 'ok');
    } finally {
      setBusy(false);
    }
  }

  function ago(ms: number): string {
    if (!ms) return '还没有推送过';
    const d = new Date(ms);
    const mins = Math.floor((Date.now() - ms) / 60000);
    return d.toLocaleString() + (mins > 0 ? '（' + mins + ' 分钟前）' : '');
  }

  return (
    <Panel title="桌面小组件" sub="四个尺寸都能拉" collapsible>
      <div className="list-row">
        <div>
          <div className="lr-label">怎么添加</div>
          <div className="lr-sub">回到桌面 → 长按空白处 → 小组件 → 找到「课表助手」→ 拖到桌面上。系统不允许应用自己添加。</div>
        </div>
      </div>
      <div className="list-row">
        <div>
          <div className="lr-label">拖到桌面之后可以拉大</div>
          <div className="lr-sub">长按组件边缘拖动就能改大小 —— <b>拉大之后会自动多显示几节课</b>，不用重新添加：{rowText}。</div>
        </div>
      </div>
      <div className="section-title">放在桌面上会是这样</div>
      <WidgetPreview payload={payload} />
      {/*
       * 设备端体检。
       *
       * 小组件的状态在应用里原本完全看不见 —— 用户说"用不了"，
       * 而我这边连"桌面上到底放了几个"都不知道。这里把它摆在最显眼的地方：
       * 有实例、有推送时间、有数据条数、有下次自翻页时刻，四个数就能定位绝大多数问题。
       */}
      <div className="section-title">现在实际是什么状态</div>
      {!dev ? (
        <div className="list-row"><div className="lr-sub">读取中…（网页版没有桌面小组件）</div></div>
      ) : (
        <React.Fragment>
          <div className="list-row">
            <div>
              <div className="lr-label">桌面上的实例</div>
              <div className="lr-sub">
                下一节课（2×2或2×3）：{dev.instancesNext} 个 · 今天安排（4×2或更大）：{dev.instancesTimetable} 个
                {dev.instancesNext + dev.instancesTimetable === 0 ? ' —— 还没有添加，应用里看不到桌面' : ''}
              </div>
            </div>
          </div>
          <div className="list-row">
            <div>
              <div className="lr-label">最后一次推送</div>
              <div className="lr-sub">
                {ago(dev.updatedAt)} · 数据 {dev.payloadBytes} 字节 ·
                今天 {dev.todayCount} 节 · 接下来 {dev.upcomingCount} 节
                {dev.nextTitle ? ' · 下一节：' + dev.nextTitle : ''}
              </div>
            </div>
          </div>
          <div className="list-row">
            <div>
              <div className="lr-label">下一次自己翻页</div>
              <div className="lr-sub">
                {dev.scheduledAt ? new Date(dev.scheduledAt).toLocaleString() + '（上课、下课、跨零点时会自己重画）' : '还没排上（打开应用会自动排）'}
                {dev.error ? ' · 原生异常：' + dev.error : ''}
              </div>
            </div>
          </div>
        </React.Fragment>
      )}

      <div className="list-row">
        <div>
          <div className="lr-label">点哪里去哪里</div>
          <div className="lr-sub">点顶上的下一节课 → 打开那门课的详情；点下面任意一行 → 打开那一行对应的课。</div>
        </div>
      </div>
      <div className="check-actions" style={{ borderTop: 0, paddingTop: 4 }}>
        <button className="btn sm" disabled={busy} onClick={function () { void syncNow(); }}>
          {busy ? '推送中…' : '立即同步到小组件'}
        </button>
      </div>
    </Panel>
  );
}