import React from 'react';
import { Panel } from './common';
import { DOWNLOAD_PAGE } from '../app/meta';

/**
 * 网页版的提醒边界（只在网页版渲染）。
 *
 * Android 版这一块讲的是电池优化白名单、自启动、系统设置入口 —— 网页版
 * 一个都用不上。但"提醒靠不靠得住"必须照样讲清楚：浏览器里的网页没有
 * 系统闹钟可以托付，页面一关就彻底没机会了。与其把 Android 的说明删掉
 * 留一片空白，不如把真实的三条限制写在原来的位置。
 */
export default function WebReminderPanel() {
  return (
    <Panel
      title="网页版的提醒边界"
      sub="页面保持打开才有效"
      desc="浏览器里没有系统闹钟可以托付：网页一旦被关掉或休眠，就再也没有机会提醒你。下面几行是网页版真实的限制，考前值得看一眼。"
    >
      <div className="list-row">
        <div className={'dot warn'} />
        <div>
          <div className="lr-label">页面要保持打开</div>
          <div className="lr-sub">
            提醒由这个页面的定时器负责。关掉标签页、或者系统把浏览器彻底休眠之后，提醒不会响 ——
            这是浏览器的限制，不是应用出了故障。
          </div>
        </div>
      </div>

      <div className="list-row">
        <div className={'dot warn'} />
        <div>
          <div className="lr-label">后台标签页会被限速</div>
          <div className="lr-sub">
            切到别的标签页之后，浏览器会把定时器放慢：短则几秒，长则几分钟。
            课前十分钟把课表这一页留在前台，是最稳的用法。
          </div>
        </div>
      </div>

      <div className="list-row">
        <div className={'dot ok'} />
        <div>
          <div className="lr-label">不登录，也不同步</div>
          <div className="lr-sub">
            数据只存在这个浏览器里。换设备、换浏览器用「课表数据」里的导出与导入，不经过任何服务器。
          </div>
        </div>
      </div>

      <div className="list-row">
        <div>
          <div className="lr-label">需要关掉也响</div>
          <div className="lr-sub">
            Android 版把提醒交给系统闹钟：息屏、关掉应用、重启手机之后都照常提醒。
            两边的数据互通，导出 JSON 在手机上导入即可。
          </div>
        </div>
        <div className="lr-right">
          <a className="btn sm primary" href={DOWNLOAD_PAGE}>获取</a>
        </div>
      </div>
    </Panel>
  );
}
