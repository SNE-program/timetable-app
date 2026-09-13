import React from 'react';
import { planForPreset, previewRows, WIDGET_PRESETS } from '../platform/widgetLayout';
import type { WidgetPayload } from '../platform/widget';

/**
 * 小组件的**尺寸预览**：按桌面上真实会显示的内容，在应用里画一遍。
 *
 * ## 为什么要有它
 *
 * 用户看不到截图，也没法在装好之前知道小组件长什么样：选择器里是一个空白方块，
 * 拖到桌面之后如果数据还没同步，看到的又是一句占位文字 ——
 * 于是很自然会得出「这个组件没有任何用处」的结论。这里把四个常见尺寸都画出来，
 * 用的是**当前课表的真实内容**，并且注明「拉大会多显示几节」。
 *
 * 尺寸判据与桌面上的原生实现共用一套（src/platform/widgetLayout.ts ↔ WidgetSize.java），
 * 所以这里看到的行数，就是拖到桌面上真正会有的行数。
 */
export default function WidgetPreview(props: { payload: WidgetPayload }) {
  /* 预览要按"此刻"算，所以用一次渲染时的当前时间；分钟级刷新没有必要 */
  const now = Date.now();

  return (
    <div className="wgt-grid">
      {WIDGET_PRESETS.map(function (preset) {
        const plan = planForPreset(preset);
        const max = preset.kind === 'next' ? plan.extraRows : plan.listRows;
        const view = previewRows(props.payload, now, Math.max(0, max));
        const rows = view.rows;
        const empty = !view.next && rows.length === 0;
        return (
          <div className="wgt-item" data-size={preset.label} key={preset.label + preset.kind}>
            <div className="wgt-frame" data-size={preset.label}>
              <div className="wgt-card">
                <div className="wgt-term">{props.payload.term || '课表助手'}</div>
                {view.next ? (
                  <React.Fragment>
                    <div className="wgt-next">
                      <div className="wgt-next-main">
                        <div className="wgt-next-title">{view.next.title}</div>
                        <div className="wgt-next-sub">{[view.next.location, view.next.start + '-' + view.next.end].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="wgt-count">00:12</div>
                    </div>
                    {rows.length > 0 ? <div className="wgt-sep" /> : null}
                  </React.Fragment>
                ) : null}
                {rows.map(function (it) {
                  return (
                    <div className="wgt-row" key={it.courseId + it.startMs}>
                      <span className="wgt-time">{it.start}</span>
                      <span className="wgt-title">{it.title}</span>
                      {plan.narrow ? null : <span className="wgt-where">{it.location || it.period}</span>}
                    </div>
                  );
                })}
                {empty ? (
                  <div className="wgt-empty">打开应用同步一次</div>
                ) : null}
                {!empty && !view.next && rows.length === 0 ? <div className="wgt-empty">今天没有课了</div> : null}
              </div>
            </div>
            <div className="wgt-cap">
              <b>{preset.label}</b> · {preset.note}
              <div className="wgt-note">
                {plan.narrow ? '这个宽度下会收起「地点」，把位置让给课程名。' : '宽度够，时间 / 课程名 / 地点三列都在。'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}