import React from 'react';
import { Sheet } from './common';
import { Icon } from './icons';
import { closeShareSheet, cloudUnshareMascot, showToast, useApp } from '../app/store';

/**
 * 分享码弹层。
 *
 * 三件事说清楚：码是多少（大号、等宽、可复制）、它能干什么（只有拿到的人能取到
 * 这一个角色）、以及怎么让它失效（停止分享，之前发出去的码立刻作废）。
 *
 * 复制走 navigator.clipboard（https 与 Capacitor 的 localhost 都是安全上下文）；
 * 拿不到剪贴板权限时退化成「选中这段字」，用户手动复制 —— 不弹系统对话框，也不假装成功。
 */
export default function MascotShareSheet() {
  const s = useApp();
  const info = s.cloud.shareSheet;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(function () { setCopied(false); }, [info ? info.code : '']);

  if (!info) return null;

  function copy(): void {
    const text = info ? info.code : '';
    const done = function (): void {
      setCopied(true);
      showToast('分享码已复制，发给同学即可', 'ok');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        void navigator.clipboard.writeText(text).then(done).catch(function () { select(); });
        return;
      }
    } catch (e) { /* 退化到手动选中 */ }
    select();
  }

  function select(): void {
    const el = inputRef.current;
    if (!el) return;
    try { el.focus(); el.select(); } catch (e) { /* 忽略 */ }
    showToast('已选中，长按复制即可', 'info');
  }

  /*
   * 停止分享：按 id 直接改，**不再要求那一行出现在当前列表里**。
   * 以前是从 s.cloud.mascots 里找那一行，找不到（列表还没刷新、或这个角色是从分享码取回来的）
   * 按钮就点了没反应 —— 用户看到的是一个假的按钮。
   */
  const infoId = info.id;
  const infoName = info.name;
  const row = s.cloud.mascots.filter(function (m) { return m.id === infoId; })[0];
  async function stopShare(): Promise<void> {
    const ok = await cloudUnshareMascot(row || { id: infoId, name: infoName });
    if (ok) closeShareSheet();
  }

  return (
    <Sheet
      className="picker-layer"
      title="分享码"
      onClose={closeShareSheet}
      right={<button className="btn sm" onClick={closeShareSheet}>关闭</button>}
    >
      <div className="list-row">
        <div>
          <div className="lr-label">{info.name}</div>
          <div className="lr-sub">把这个码发给同学，他在「云端角色 → 用分享码获取」里粘进去就能用</div>
        </div>
      </div>

      <div style={{ padding: '0 14px 10px' }}>
        <input
          ref={inputRef}
          className="input"
          readOnly
          value={info.code}
          onFocus={function (e) { try { e.target.select(); } catch (err) { /* 忽略 */ } }}
          style={{ textAlign: 'center', letterSpacing: '.24em', fontSize: 'var(--fs-xl)', fontWeight: 700, height: 46 }}
        />
      </div>

      <div className="check-actions" style={{ borderTop: 0, paddingTop: 0 }}>
        <button className="btn sm primary" onClick={copy}>
          <Icon name="clipboard" size={15} /> {copied ? '再复制一次' : '复制分享码'}
        </button>
        <button
          className="btn sm ghost"
          disabled={s.cloud.mascotsStage !== ''}
          onClick={function () { void stopShare(); }}
        >停止分享</button>
      </div>

      <div className="panel-desc" style={{ paddingTop: 6 }}>
        拿到码的人不需要有账号，也不需要知道你叫什么 —— 码本身就是凭据。
        <b>停止分享</b>之后这个码立刻失效，已经下载到别人手机上的角色不受影响。
      </div>
    </Sheet>
  );
}
