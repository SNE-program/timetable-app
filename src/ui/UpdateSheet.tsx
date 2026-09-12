import React from 'react';
import { Sheet } from './common';
import { APP_VERSION } from '../app/version';
import { isNativePlatform } from '../platform/nativeBridge';
import { closeUpdateSheet, installUpdate, useApp } from '../app/store';

/**
 * 更新面板。
 *
 * 说清楚三件事，一件都不能省：
 *   1. 现在是哪一版、新的是哪一版；
 *   2. **点下去会发生什么**（下载 → 系统弹窗让你确认安装 —— 安卓不允许应用自己静默安装）；
 *   3. 下载多大、进度到哪了。
 *
 * 网页版没有这一套：刷新就是最新版，所以那一支只给一句实话。
 */
export default function UpdateSheet() {
  const s = useApp();
  const u = s.update;
  const info = u.result && u.result.kind === 'newer' ? u.result.info : null;
  const native = isNativePlatform();
  const busy = u.progress !== null;

  return (
    <Sheet
      title={info ? '发现新版本 ' + info.version : '检查更新'}
      onClose={closeUpdateSheet}
      right={<span className="panel-sub">当前 v{APP_VERSION || '?'}</span>}
    >
      {info ? (
        <React.Fragment>
          <div className="list-row">
            <div className="dot ok" />
            <div>
              <div className="lr-label">v{info.version}</div>
              <div className="lr-sub">
                {info.publishedAt ? '发布于 ' + info.publishedAt.slice(0, 10) + ' · ' : ''}
                {native ? '下载后交给系统安装器，数据不会丢' : '网页版刷新一下就是最新版'}
              </div>
            </div>
          </div>

          {busy ? (
            <div className="check-progress">
              <div className="check-bar"><i style={{ width: (u.progress || 0) + '%' }} /></div>
              <span className="check-pct">{u.progress}%</span>
            </div>
          ) : null}

          <div className="check-actions" style={{ borderTop: 0, paddingTop: 6 }}>
            {native ? (
              <button className="btn sm primary" disabled={busy} onClick={function () { void installUpdate(); }}>
                {busy ? '下载中…' : '下载并安装'}
              </button>
            ) : null}
            {info.pageUrl ? (
              <a className="btn sm" href={info.pageUrl} target="_blank" rel="noreferrer noopener">查看更新说明</a>
            ) : null}
            <button className="btn sm ghost" disabled={busy} onClick={closeUpdateSheet}>稍后</button>
          </div>

          <div className="panel-desc" style={{ paddingTop: 6 }}>
            {native
              ? '下载完会自动弹出系统安装界面 —— 最后那一下「安装」需要你点，安卓不允许应用自己静默安装更新（那是应用商店才有的能力）。'
              : '网页版是打开即最新，不需要手动更新。想要「关掉也能提醒」的版本，装 Android 版。'}
          </div>
        </React.Fragment>
      ) : (
        <div className="panel-desc" style={{ paddingTop: 0 }}>
          {u.result && u.result.kind === 'error'
            ? u.result.message
            : '已是最新版本' + (APP_VERSION ? '（v' + APP_VERSION + '）' : '') + '。'}
        </div>
      )}

      {u.error ? (
        <div className="panel-desc" style={{ color: 'var(--c-danger)' }}>{u.error}</div>
      ) : null}
    </Sheet>
  );
}
