import React from 'react';
import { Panel } from './common';
import { showToast, useApp } from '../app/store';
import { pushWidgetData } from '../platform/widget';

/**
 * 桌面小组件说明与手动同步（只在 Android 版渲染）。
 *
 * 加这个面板是因为：小组件在桌面上，而功能入口在应用里 ——
 * 用户装了应用但从来不知道有小组件，是这类功能最常见的死法。
 * 系统不允许应用自己往桌面加小组件，只能把路径写清楚让他自己加。
 *
 * 网页版**不渲染这一块**：浏览器没法往桌面放任何东西，讲一遍"为什么没有"
 * 只是又一次告诉用户他做不到的事 —— 想要的人去「关于 → 获取 Android 版」。
 */
export default function WidgetPanel() {
  const s = useApp();
  const [busy, setBusy] = React.useState(false);

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
    <Panel title="桌面小组件" sub="2×2 / 4×2" collapsible>
      <div className="list-row">
        <div>
          <div className="lr-label">怎么添加</div>
          <div className="lr-sub">回到桌面 → 长按空白处 → 小组件 → 找到「课表助手」→ 拖到桌面上。系统不允许应用自己添加。</div>
        </div>
      </div>
      <div className="list-row">
        <div>
          <div className="lr-label">两种尺寸</div>
          <div className="lr-sub">2×2 显示下一节课和倒计时；4×2 再多列出今天剩下的几节课。</div>
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
