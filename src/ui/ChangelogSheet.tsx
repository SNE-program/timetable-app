import React from 'react';
import { closeSheets } from '../app/store';
import { CHANGE_KIND_LABEL, CHANGELOG } from '../app/changelog';
import { APP_VERSION } from '../app/version';
import { isNativePlatform } from '../platform/nativeBridge';
import { Sheet } from './common';

/**
 * 更新日志。
 *
 * 内容全部来自 app/changelog.ts —— 那里是唯一的记录来源，
 * 界面上不做任何加工，避免"文档写了一套、应用里显示另一套"。
 */

/**
 * 把条目文本里的 **强调** 渲染成加粗。
 *
 * 条目是普通字符串（不是 JSX），但约定里允许用 `**` 标重点。
 * 不做这一步的话，用户在更新日志里看到的是一堆裸星号 ——
 * 这种细节在"发给同学用"的场景里格外显眼。
 */
function renderText(text: string): React.ReactNode[] {
  const parts = text.split('**');
  return parts.map(function (seg, i) {
    /* 奇数段就是被 ** 夹住的那一段 */
    return i % 2 === 1 ? <b key={i}>{seg}</b> : <React.Fragment key={i}>{seg}</React.Fragment>;
  });
}

export default function ChangelogSheet() {
  return (
    <Sheet
      title="更新日志"
      onClose={closeSheets}
      right={<span className="panel-sub">当前 {APP_VERSION || '?'}</span>}
    >
      <div className="panel-desc" style={{ padding: '0 0 6px' }}>
        这里记录每个版本你能感知到的变化。装的是哪个版本，在「设置 → 关于」里能看到。
      </div>

      {/*
        历史里有一批条目只属于 Android 版（系统闹钟、桌面小组件、电池优化）。
        网页版读者照着找会找不到，所以在最上面先说清楚，而不是逐条去改历史 ——
        更新日志是记录，不该为了迁就新平台被改写。
      */}
      {isNativePlatform() ? null : (
        <div className="panel-desc" style={{ padding: '0 0 6px' }}>
          这是网页版。下面的历史是完整记录，其中<b>「交给系统闹钟」「桌面小组件」「电池优化与自启动」</b>这几类是
          Android 版才有的能力 —— 网页版靠页面内的通知，需要页面保持打开。其余功能两边一致。
        </div>
      )}

      {CHANGELOG.map(function (e) {
        return (
          <div className="log-entry" key={e.version}>
            <div className="log-head">
              <span className="log-ver">v{e.version}</span>
              <span className="log-title">{e.title}</span>
              {e.date ? <span className="log-date">{e.date}</span> : null}
            </div>
            <div className="log-items">
              {e.items.map(function (it, i) {
                return (
                  <div className="log-item" key={i}>
                    <span className={'log-tag ' + it.kind}>{CHANGE_KIND_LABEL[it.kind]}</span>
                    <span className="log-text">{renderText(it.text)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="panel-desc" style={{ paddingTop: 14 }}>
        更完整的技术记录在仓库的 CHANGELOG.md 与 docs 目录里，面向维护者。
      </div>
    </Sheet>
  );
}
