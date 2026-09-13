import React from 'react';
import { Sheet } from './common';
import { closeHistory, historyEntries, redo, redoEntries, undo, undoTo, useApp } from '../app/store';

/**
 * 操作历史。
 *
 * ## 为什么需要它
 *
 * 只有顶栏那个 ↶ 的时候，撤销是个**没有说明的按钮**：你不知道它会退回哪一步，
 * 也不知道栈里还有几笔 —— 两步以上的回退就只能连点，点过头了连自己撤到哪儿了都不知道。
 * 这个面板把最近的改动按时间列出来，可以**直接退到某一步**。
 *
 * ## 两条自我约束
 *
 *   1. 只读历史，不改它 —— 条目是摘要（标签 + 时间），拿不到里面的快照；
 *   2. 一句话说清边界：历史只在本次运行期间保留（退出应用就没了），最多 40 步。
 */
export default function HistorySheet() {
  const s = useApp();
  const undoList = historyEntries(12);
  const redoList = redoEntries(6);

  function when(at: number): string {
    const d = new Date(at);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
      + ':' + ('0' + d.getSeconds()).slice(-2);
  }

  function sourceLabel(src: string): string {
    return src === 'import' ? '导入' : src === 'plugin' ? '插件' : src === 'ai' ? 'AI' : '';
  }

  return (
    <Sheet
      title="操作历史"
      onClose={closeHistory}
      right={s.history.undo > 0 ? (
        <button className="btn sm" onClick={function () { if (undo()) closeHistory(); }}>撤销一步</button>
      ) : null}
    >
      <div className="panel-desc" style={{ paddingTop: 0 }}>
        下面按时间倒序列出最近的改动。点任意一行，就撤销<b>那一步</b>：
        比它更晚的改动会一起撤掉，回到那一步之前。
        历史只在本次运行期间保留，最多 40 步。
      </div>

      <div className="section-title">可以撤销（{s.history.undo}）</div>
      {undoList.length === 0 ? (
        <div className="list-row"><div className="lr-sub">还没有可撤销的改动</div></div>
      ) : undoList.map(function (it) {
        return (
          <div className="list-row tap" key={it.id} style={{ cursor: 'pointer' }}
            onClick={function () { undoTo(it.id); }}
          >
            <div>
              <div className="lr-label">{it.label}</div>
              <div className="lr-sub">
                {when(it.at)}{sourceLabel(it.source) ? ' · ' + sourceLabel(it.source) : ''}
              </div>
            </div>
            <div className="lr-right">撤销</div>
          </div>
        );
      })}

      <div className="section-title">可以重做（{s.history.redo}）</div>
      {redoList.length === 0 ? (
        <div className="list-row"><div className="lr-sub">没有可重做的步骤</div></div>
      ) : (
        <React.Fragment>
          {redoList.map(function (it) {
            return (
              <div className="list-row" key={it.id}>
                <div>
                  <div className="lr-label">{it.label}</div>
                  <div className="lr-sub">{when(it.at)}</div>
                </div>
                <div className="lr-right">
                  <button className="btn sm" onClick={function () { redo(); }}>重做</button>
                </div>
              </div>
            );
          })}
        </React.Fragment>
      )}

      <div className="panel-desc" style={{ paddingBottom: 12 }}>
        顶栏的 ↶ 轻点是退一步，长按就是打开这里。
      </div>
    </Sheet>
  );
}
