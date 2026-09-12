import React from 'react';
import { Sheet } from './common';
import { closeCloudPassword, cloudSetPassword, useApp } from '../app/store';

/**
 * 设置 / 修改密码面板。
 *
 * 两个入口共用：邮件里的「重置密码」链接（进来时自动打开），以及登录后的「修改密码」。
 * 校验放在本地做（长度 ≥6、两次一致），但**真正的判定在服务器** ——
 * 这里只是省一次白跑的请求，不是安全边界。
 */
export default function PasswordSheet() {
  const s = useApp();
  const [pw1, setPw1] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const busy = s.cloud.busy !== '';

  const tooShort = pw1.length > 0 && pw1.length < 6;
  const mismatch = pw2.length > 0 && pw1 !== pw2;
  const ok = pw1.length >= 6 && pw1 === pw2 && !busy;

  return (
    <Sheet
      title="设置新密码"
      onClose={closeCloudPassword}
      right={<button className="btn sm primary" disabled={!ok} onClick={function () { void cloudSetPassword(pw1); }}>
        {busy ? '保存中…' : '保存'}
      </button>}
    >
      <div className="panel-desc" style={{ paddingTop: 0 }}>
        {s.cloud.session && s.cloud.session.user.email
          ? '正在为 ' + s.cloud.session.user.email + ' 设置新密码。'
          : '设置一个新密码，之后用邮箱加新密码登录。'}
        至少 6 位，建议别用生日或学号。
      </div>

      <div className="field">
        <div className="field-label">新密码</div>
        <input
          className="input" type="password" autoComplete="new-password"
          placeholder="至少 6 位" value={pw1}
          onChange={function (e) { setPw1(e.target.value); }}
        />
        {tooShort ? <div className="field-label" style={{ color: 'var(--c-danger)' }}>太短了，至少 6 位</div> : null}
      </div>

      <div className="field">
        <div className="field-label">再输一次</div>
        <input
          className="input" type="password" autoComplete="new-password"
          placeholder="两次输入要一致" value={pw2}
          onChange={function (e) { setPw2(e.target.value); }}
        />
        {mismatch ? <div className="field-label" style={{ color: 'var(--c-danger)' }}>两次输入不一样</div> : null}
      </div>

      {s.cloud.error ? (
        <div className="panel-desc" style={{ color: 'var(--c-danger)' }}>{s.cloud.error}</div>
      ) : null}

      <div className="panel-desc">
        密码只保存在你自己的 Supabase 项目里（服务端只存哈希）；应用本身不保存密码，登录状态存在本机，
        退出登录即可清掉。
      </div>
    </Sheet>
  );
}
