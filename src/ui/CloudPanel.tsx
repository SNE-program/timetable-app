import React from 'react';
import { Panel } from './common';
import {
  cloudAvailable, cloudBackupLine, cloudBackupNow, cloudDeleteAccount, cloudDeleteBackup, cloudLoadInfo,
  cloudLogin, cloudLogout, cloudMailWeek, cloudRecover, cloudRegister, cloudRestoreNow, cloudServerHost,
  openCloudPassword, useApp,
} from '../app/store';

/**
 * 云备份面板（可选功能）。
 *
 * 三条写在这里的规矩：
 *
 * 1. **没配置 Supabase 就整块不渲染** —— 本地构建、以及不想用云备份的人，
 *    拿到的仍是那个"完全离线"的应用，界面上不会出现一个点不动的按钮。
 * 2. **默认什么都不发**。打开应用、切页面、改课表都不会联网；
 *    只有这里被按下的那几个按钮会发请求（注册 / 登录 / 忘记密码 / 备份 / 恢复 / 删除）。
 * 3. **把话说全**：备份里有什么、不含什么（角色）、会发到哪台服务器、
 *    图片太大时会退成"不含图片"、退出登录不影响本机数据 —— 一条都不能省。
 */
export default function CloudPanel() {
  const s = useApp();
  const c = s.cloud;
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const busy = c.busy !== '';
  const canSubmit = email.trim() !== '' && password.length >= 6 && !busy;

  if (!cloudAvailable()) return null;

  const sub = c.session
    ? (c.backup ? '已登录 · 云端有备份' : '已登录 · 云端还没备份')
    : '未登录';

  return (
    <Panel
      title="云备份"
      sub={sub}
      desc={'可选功能，默认关闭。只有你在下面按按钮时才会联网，备份发到你自己项目的服务器（'
        + cloudServerHost() + '）；不登录的话，这个应用与以前一样完全离线。'}
    >
      {c.session ? (
        <React.Fragment>
          <div className="list-row">
            <div className={'dot ok'} />
            <div>
              <div className="lr-label">{c.session.user.email}</div>
              <div className="lr-sub">云端备份：{cloudBackupLine(c.backup)}</div>
            </div>
            <div className="lr-right">
              <button className="btn sm" disabled={busy} onClick={function () { cloudLoadInfo(); }}>刷新</button>
            </div>
          </div>

          <div className="check-actions" style={{ borderTop: 0, paddingTop: 4 }}>
            <button className="btn sm primary" disabled={busy} onClick={function () { void cloudBackupNow(); }}>
              {c.busy === 'backup' ? '备份中…' : '立即备份到云端'}
            </button>
            <button className="btn sm" disabled={busy || !c.backup} onClick={function () { void cloudRestoreNow(); }}>
              {c.busy === 'restore' ? '恢复中…' : '从云端恢复'}
            </button>
            <button className="btn sm ghost" disabled={busy} onClick={cloudLogout}>退出登录</button>
          </div>

          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void cloudMailWeek(); }}>
            <div>
              <div className="lr-label">把本周课表发到我的邮箱</div>
              <div className="lr-sub">
                用 Resend 发一封纯文本邮件，只可能发到你自己这个地址；正文由本机算好后交给服务端
              </div>
            </div>
            <div className="lr-right">{c.busy === 'mail' ? '发送中…' : '›'}</div>
          </div>

          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={openCloudPassword}>
            <div>
              <div className="lr-label">修改密码</div>
              <div className="lr-sub">不用收邮件，直接在这里改</div>
            </div>
            <div className="lr-right">›</div>
          </div>

          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void cloudDeleteBackup(); }}>
            <div>
              <div className="lr-label">删除云端备份</div>
              <div className="lr-sub">只删服务器上那一份，账号与本机数据都不动</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void cloudDeleteAccount(); }}>
            <div>
              <div className="lr-label" style={{ color: 'var(--c-danger)' }}>注销账号并删除云端数据</div>
              <div className="lr-sub">删掉之后无法恢复；本机课表不受影响</div>
            </div>
            <div className="lr-right">›</div>
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div className="list-row">
            <div>
              <div className="lr-label">邮箱</div>
              <div className="lr-sub">用来登录与找回密码，只存在你的 Supabase 项目里</div>
            </div>
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <input
              className="input" type="email" inputMode="email" autoComplete="email"
              placeholder="you@example.com" value={email}
              onChange={function (e) { setEmail(e.target.value); }}
            />
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <input
              className="input" type="password" autoComplete="current-password"
              placeholder="密码（至少 6 位）" value={password}
              onChange={function (e) { setPassword(e.target.value); }}
            />
          </div>
          <div className="check-actions" style={{ borderTop: 0, paddingTop: 4 }}>
            <button className="btn sm primary" disabled={!canSubmit} onClick={function () { void cloudLogin(email, password); }}>
              {c.busy === 'signin' ? '登录中…' : '登录'}
            </button>
            <button className="btn sm" disabled={!canSubmit} onClick={function () { void cloudRegister(email, password); }}>
              {c.busy === 'signup' ? '注册中…' : '注册'}
            </button>
            <button
              className="btn sm ghost"
              disabled={busy || email.trim() === ''}
              onClick={function () { void cloudRecover(email); }}
            >忘记密码</button>
          </div>
        </React.Fragment>
      )}

      {c.notice ? <div className="panel-desc" style={{ paddingTop: 6 }}>{c.notice}</div> : null}
      {c.error ? (
        <div className="panel-desc" style={{ paddingTop: 6, color: 'var(--c-danger)' }}>{c.error}</div>
      ) : null}

      <div className="panel-desc" style={{ paddingTop: 8 }}>
        备份里包括：课表与时段、任务、出勤、学期与作息、提醒规则、外观，以及这些数据用到的图片；
        <b>不包括角色</b>（它有自己的角色包文件，请单独带走）。图片太大时只备份课表与设置，届时会明确提示。
        恢复会覆盖本机并记一步历史，可以撤销。
      </div>
    </Panel>
  );
}
