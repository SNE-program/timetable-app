import React from 'react';
import { Icon } from './icons';
import { closeCloudSheet, openMascotCenter, useApp } from '../app/store';

/**
 * 云弹层里的「云端角色」入口。
 *
 * ## 为什么只剩一行
 *
 * 这一块原来是一整套界面：上传输入框、分享码输入框、我的角色列表（每行四个按钮）、
 * 公开列表。而 1.9.6 起「角色中心」已经把这些全收进去了 ——
 * 于是同一件事有两个入口、两套排版、两种说法（云弹层里叫「使用」，中心里叫「用这个」）。
 *
 * 用户当时对角色功能的评价是「界面与功能十分混乱」，**重复入口本身就是混乱的来源**。
 * 现在这里只留一句状态 + 一个入口：要看角色，就去角色中心；
 * 云弹层负责的只是「课表备份」这一件事。
 */
export default function MascotCloudSection() {
  const s = useApp();
  const c = s.cloud;
  const me = c.session ? c.session.user.id : null;
  const mine = c.mascots.filter(function (m) { return !!me && m.user_id === me; });
  const publicN = c.mascots.filter(function (m) { return m.is_public; }).length;
  const sharedN = mine.filter(function (m) { return !!m.share_code; }).length;

  return (
    <div className="action-item tap" style={{ cursor: 'pointer' }} onClick={function () { closeCloudSheet(); openMascotCenter('pick'); }}>
      <div className="ai-head">
        <div className="ai-title">
          <Icon name="leaf" size={14} />
          <span>角色</span>
          {mine.length > 0 ? <span className="ai-tag">{mine.length} 个云端角色</span> : null}
          {sharedN > 0 ? <span className="ai-tag on">分享中 {sharedN}</span> : null}
          {publicN > 0 ? <span className="ai-tag on">公开 {publicN}</span> : null}
        </div>
        <div className="ai-meta">
          换一个 / 做一个 / 分享与获取 都在「角色中心」里（
          {c.session ? c.session.user.email : '未登录也能用分享码取别人的角色'}
          ）。
        </div>
      </div>
      <div className="ai-actions">
        <button className="btn sm primary" onClick={function (ev) { ev.stopPropagation(); closeCloudSheet(); openMascotCenter('pick'); }}>打开角色中心</button>
        <button className="btn sm ghost" onClick={function (ev) { ev.stopPropagation(); closeCloudSheet(); openMascotCenter('share'); }}>用分享码获取</button>
      </div>
    </div>
  );
}