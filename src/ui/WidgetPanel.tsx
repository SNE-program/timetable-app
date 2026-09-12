import React from 'react';
import { Panel } from './common';
import { showToast, useApp } from '../app/store';
import { pushWidgetData } from '../platform/widget';
import { isNativePlatform } from '../platform/nativeBridge';
import { ANDROID_RELEASE_URL } from '../app/meta';

/**
 * 桌面小组件说明与手动同步。
 *
 * 加这个面板是因为：小组件在桌面上，而功能入口在应用里 ——
 * 用户装了应用但从来不知道有小组件，是这类功能最常见的死法。
 * 系统不允许应用自己往桌面加小组件，只能把路径写清楚让他自己加。
 *
 * 网页版没有对应能力（网页无法往桌面放任何东西），所以这里不摆一套
 * 做不到的说明，而是直接讲清楚为什么没有，以及想要的话去哪里拿。
 */
export default function WidgetPanel() {
  const s = useApp();
  const native = isNativePlatform();
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

  if (!native) {
    return (
      <Panel
        title="桌面小组件"
        sub="仅 Android 版提供"
        desc="不用打开应用就能看到下一节课和今天的安排。倒计时由桌面自己走，不会额外耗电。"
      >
        <div className="list-row">
          <div className={'dot warn'} />
          <div>
            <div className="lr-label">网页版为什么没有</div>
            <div className="lr-sub">
              桌面小组件是 Android 系统自己的能力，由系统进程直接绘制在桌面上。
              浏览器里的网页没法往桌面放任何东西，所以这一项没有可以照搬的实现。
            </div>
          </div>
        </div>
        <div className="list-row">
          <div>
            <div className="lr-label">想要的话怎么办</div>
            <div className="lr-sub">
              Android 版有 2×2 与 4×2 两种尺寸。两边的数据是互通的：在这里用
              「设置 → 课表数据 → 导出课表数据」导出 JSON，在手机上导入即可，不用重录。
            </div>
          </div>
        </div>
        {ANDROID_RELEASE_URL ? (
          <div className="check-actions" style={{ borderTop: 0, paddingTop: 4 }}>
            <a
              className="btn sm primary"
              href={ANDROID_RELEASE_URL}
              target="_blank"
              rel="noreferrer noopener"
            >获取 Android 版</a>
            <span className="panel-desc" style={{ padding: '0 0 0 10px' }}>会在新标签页打开项目主页</span>
          </div>
        ) : null}
      </Panel>
    );
  }

  return (
    <Panel
      title="桌面小组件"
      sub="2×2 / 4×2"
      desc="不用打开应用就能看到下一节课和今天的安排。倒计时由桌面自己走，不会额外耗电。"
    >
      <div className="list-row">
        <div>
          <div className="lr-label">怎么添加</div>
          <div className="lr-sub">回到桌面 → 长按空白处 → 小组件 → 找到「课表助手」→ 拖到桌面上。系统不允许应用自己添加，只能你来拖。</div>
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
