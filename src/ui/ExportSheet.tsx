import React from 'react';
import { availableExports, closeSheets, currentWeekNumber, runPluginExport, useApp } from '../app/store';
import { Sheet } from './common';

/**
 * 导出格式选择。
 *
 * 列表内容全部来自**插件提供的导出能力** —— 内置的那三个 CSV / Markdown 格式
 * 也是走同一套接口，不是另写的分支。停用插件或撤销权限后，这里会立刻少一项。
 */
export default function ExportSheet() {
  useApp();   /* 订阅状态：插件一变就重算列表 */
  const list = availableExports();
  const week = currentWeekNumber();

  return (
    <Sheet
      title="导出课表"
      onClose={closeSheets}
      right={<span className="panel-sub">第 {week} 周</span>}
    >
      {list.length === 0 ? (
        <div className="panel-desc">
          当前没有任何可用的导出格式。去「设置 → 插件」看看是不是把内置插件停用了。
        </div>
      ) : (
        <div className="picker-list">
          {list.map(function (e) {
            return (
              <button
                key={e.pluginId + ':' + e.capability.id}
                type="button"
                className="picker-opt export-opt"
                onClick={function () { runPluginExport(e.pluginId, e.capability.id); }}
              >
                <span className="pk-label">
                  {e.capability.name}
                  {e.capability.hint ? <span className="export-hint">{e.capability.hint}</span> : null}
                </span>
                <span className="pk-sub">{e.pluginName}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="panel-desc" style={{ paddingTop: 12 }}>
        导出的是当前这台设备上的完整数据，不会联网。ICS 与 JSON 备份仍在「课表数据」里。
      </div>
    </Sheet>
  );
}
