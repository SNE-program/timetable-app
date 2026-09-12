import React from 'react';
import { Sheet } from './common';
import { syncPromptFor } from '../cloud/syncAsk';
import { closeSyncAsk, syncPromptAct, useApp } from '../app/store';

/**
 * 登录之后的同步询问。
 *
 * 登录完必然面对"云端那份和本机这份谁说了算"，而这**猜错就是丢数据** ——
 * 所以不自动合并、不替用户选，把两个方向摆出来让他点。
 * 两边都空时不弹（没什么可同步的）。
 */
export default function SyncSheet() {
  const s = useApp();
  const c = s.cloud;
  const prompt = syncPromptFor({
    localCourses: s.data.courses.length,
    cloudHasBackup: !!c.backup,
  });
  const busy = c.busy === 'backup' || c.busy === 'restore';

  if (prompt.kind === 'none') return null;

  return (
    <Sheet
      title={prompt.title}
      onClose={closeSyncAsk}
      right={<span className="panel-sub">{c.session ? c.session.user.email : ''}</span>}
    >
      <div className="panel-desc" style={{ paddingTop: 0 }}>{prompt.lead}</div>

      {c.backup ? (
        <div className="list-row">
          <div className="dot ok" />
          <div>
            <div className="lr-label">云端这份</div>
            <div className="lr-sub">{c.backup.summary} · 更新于 {c.backup.updatedAt.slice(0, 16).replace('T', ' ')}</div>
          </div>
        </div>
      ) : null}
      <div className="list-row">
        <div className="dot warn" />
        <div>
          <div className="lr-label">本机这份</div>
          <div className="lr-sub">
            {s.data.courses.length} 门课 · {s.data.sessions.length} 个时段 · {s.data.tasks.length} 项任务
          </div>
        </div>
      </div>

      <div className="check-actions" style={{ borderTop: 0, paddingTop: 6 }}>
        {prompt.primary ? (
          <button
            className="btn sm primary" disabled={busy}
            onClick={function () { void syncPromptAct(prompt.primary!.action); }}
          >{busy ? '处理中…' : prompt.primary.text}</button>
        ) : null}
        {prompt.secondary ? (
          <button
            className="btn sm" disabled={busy}
            onClick={function () { void syncPromptAct(prompt.secondary!.action); }}
          >{prompt.secondary.text}</button>
        ) : null}
        <button className="btn sm ghost" disabled={busy} onClick={closeSyncAsk}>先不动</button>
      </div>

      <div className="panel-desc" style={{ paddingTop: 6 }}>
        「恢复」与「备份」都能在提示条上撤销或重新来一次；本机数据在没有点之前不会被动。
        自动登录、云端角色这些都在右上角的云图标里。
      </div>
    </Sheet>
  );
}
