import React from 'react';
import { Panel } from './common';
import WidgetPreview from './WidgetPreview';
import { showToast, useApp } from '../app/store';
import { buildWidgetPayload, pushWidgetData } from '../platform/widget';
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
      showToast(ok ? '已推送最新数据，小组件应该刷新了' : '推送失败，当前平台可能不支持', ok ? 'ok' : 'warn');
    } finally {
      setBusy(false);
    }
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