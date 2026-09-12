import React from 'react';
import { openManual, patchPrefs } from '../app/store';
import { isNativePlatform } from '../platform/nativeBridge';
import { cloudConfigured } from '../cloud/config';
import { Icon, type IconName } from './icons';

/**
 * 首次启动的隐私说明。
 *
 * 计划书第 12 节要求「首次启动给一页人话说明 —— 数据只在本机、不联网、
 * 无广告、可随时导出删除」。这不是走形式：这个品类的用户被"WakeUp 变质"
 * 伤过，上来先把立场讲清楚，比藏在设置里一段小字有用得多。
 *
 * 措辞刻意不用"我们承诺"这种话 —— 直接说系统实际做了什么。
 */
const POINTS: { icon: IconName; title: string; sub: string }[] = [
  {
    icon: 'lock',
    title: '数据只在这台设备上',
    sub: '不注册也能用，课表不会传到任何服务器。',
  },
  {
    icon: 'ban',
    title: '没有广告，也没有追踪',
    /*
     * 接上云备份之后，"一次网络请求都不发"这句话就不再准确了 ——
     * 它仍然默认成立（不登录就不会联网），但必须把条件说出来，
     * 否则用户以为"这东西永远不联网"，而某天点了备份才发现不是。
     */
    sub: isNativePlatform() ? '没有广告或统计 SDK，权限只申请通知、闹钟和震动。' : '没有广告或统计脚本。'
      + (cloudConfigured() ? '云备份默认关闭。' : ''),
  },
  {
    icon: 'archive',
    title: '随时可以完整带走',
    sub: '「设置 → 课表数据」能导出 JSON 备份与 ICS 日历。',
  },
  /*
   * 最后一条按运行环境说实话。
   *
   * 网页版做不到"关掉也能提醒"：浏览器不允许网页在关闭之后自己醒来，
   * 唯一可行的办法是页面保持打开。这个品类里最伤人的是含糊其辞 ——
   * 用户以为关了也会响，错过一节课，然后卸载。所以第一屏就讲清楚。
   */
  isNativePlatform()
    ? {
      icon: 'bell',
      title: '提醒交给系统闹钟',
      sub: '不用一直开着应用：息屏、重启之后照样响。',
    }
    : {
      icon: 'bell',
      title: '提醒需要页面保持打开',
      sub: '页面关掉就不会响 —— 浏览器不允许网页自己唤醒。想关掉也响就装 Android 版。',
    },
];

export default function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <div className="welcome-mark">课</div>
          <div>
            <div className="welcome-name">课表助手</div>
            <div className="welcome-tag">本地优先 · 无广告 · 无追踪</div>
          </div>
        </div>

        <div className="welcome-list">
          {POINTS.map(function (p) {
            return (
              <div className="welcome-item" key={p.title}>
                <span className="welcome-icon"><Icon name={p.icon} size={19} /></span>
                <div>
                  <div className="welcome-item-title">{p.title}</div>
                  <div className="welcome-item-sub">{p.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        <button className="btn primary block welcome-go" onClick={function () { patchPrefs({ privacySeen: true }); }}>
          知道了，开始用
        </button>
        <button
          className="btn block"
          style={{ marginTop: 8 }}
          onClick={function () { patchPrefs({ privacySeen: true }); openManual(); }}
        >
          先看使用说明书
        </button>
        <div className="welcome-foot">
          {isNativePlatform()
            ? '隐私说明与说明书在「设置 → 关于」里'
            : '数据只在这个浏览器里，清除站点数据会一起清掉 —— 记得导出备份'}
        </div>
      </div>
    </div>
  );
}
