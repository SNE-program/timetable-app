import React from 'react';
import { Sheet } from './common';
import { Icon } from './icons';
import CloudPanel from './CloudPanel';
import MascotCloudSection from './MascotCloudSection';
import { closeCloudSheet, setTab, useApp } from '../app/store';

/**
 * 右上角那个云入口打开的弹层。
 *
 * 放在顶栏的理由很直接：课表备份与角色上云是**动作**，而设置页是**配置**。
 * 埋进设置里等于要用户先想到"这事在设置里"，而它其实是"我现在就想备份一下"。
 *
 * 内容与设置页里的「云备份」面板完全一致（同一个组件），只是换了个入口 ——
 * 两份界面各自维护，迟早会出现"设置里能点、这里点不动"。
 */
export default function CloudSheet() {
  const s = useApp();
  return (
    <Sheet
      title="云备份与角色"
      onClose={closeCloudSheet}
      right={<span className="panel-sub">{s.cloud.session ? s.cloud.session.user.email : '未登录'}</span>}
    >
      <div className="panel-desc" style={{ paddingTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="cloud" size={14} />
        默认完全本地；这里的每一项都要你按了才会联网。
      </div>

      <CloudPanel />

      <div className="section-title">云端角色</div>
      <MascotCloudSection />

      <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
        <button
          className="btn block"
          onClick={function () { closeCloudSheet(); setTab('settings'); }}
        >去设置页看完整选项</button>
      </div>
    </Sheet>
  );
}
