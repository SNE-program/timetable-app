import React from 'react';
import { openManual, patchPrefs } from '../app/store';
import { isNativePlatform } from '../platform/nativeBridge';
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
    sub: '课表、任务、出勤记录都存在本机，不上传、不联网、不需要注册账号。',
  },
  {
    icon: 'ban',
    title: '没有广告，也没有追踪',
    sub: isNativePlatform()
      ? '不含任何广告或统计 SDK。应用申请的权限只有通知、闹钟和震动。'
      : '不含任何广告或统计脚本，页面不会向任何服务器发请求。',
  },
  {
    icon: 'archive',
    title: '随时可以完整带走',
    sub: '「设置 → 课表数据」能导出 JSON 备份与 ICS 日历，随时迁到别的工具。',
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
      sub: '不用一直开着应用。息屏、关掉应用、重启手机之后，该响的照样响。',
    }
    : {
      icon: 'bell',
      title: '提醒需要页面保持打开',
      sub: '浏览器不允许网页在关闭后自己唤醒，所以网页版只在标签页开着时准时提醒。'
        + '需要关掉也响，请装 Android 版（数据可以导出带走，不用重录）。',
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
            ? '隐私说明与使用说明书随时可以在「设置 → 关于」里再看一遍'
            : '数据只存在这个浏览器里：清除站点数据会一起清掉，记得在「设置 → 课表数据」导出备份'}
        </div>
      </div>
    </div>
  );
}
