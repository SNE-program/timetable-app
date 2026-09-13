import React from 'react';
import { Sheet } from './common';
import { closeShortcutSheet, useApp } from '../app/store';
import { COMMAND_GROUPS, allCommands, formatCombo } from '../app/commands';
import { isNativePlatform } from '../platform/nativeBridge';

/**
 * 快捷键说明。
 *
 * 内容**直接从命令表渲染**（app/commands.ts）—— 代码里加了命令，这一页自动多一行。
 * 这不是省事，而是防"说明和实际不一致"：手写一份列表，改代码时必然忘记同步，
 * 而一个写了不存在快捷键的帮助页，比没有帮助页更糟。
 *
 * 手机上也显示得出来（接了键盘的 Android 设备同样能用），只是顶部会多一句说明。
 */
export default function ShortcutSheet() {
  const s = useApp();
  /*
   * Mac 上把 mod 显示成 ⌘：用户按的是那个键，写成 Ctrl 会让人以为按错了。
   * 用平台判断而不是 UA 猜 —— navigator.platform 在安卓上也会返回 Linux 之类。
   */
  const mac = React.useMemo(function () {
    try { return /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent); }
    catch (e) { return false; }
  }, []);
  const list = allCommands();

  return (
    <Sheet title="快捷键" onClose={closeShortcutSheet}>
      <div className="panel-desc" style={{ paddingTop: 0 }}>
        {isNativePlatform()
          ? '这些键在任何有键盘的设备上都能用（安卓接上键盘也一样）。触屏上的快捷操作是长按与拖动 —— 见下面。'
          : '电脑上直接按；' + (mac ? '⌘' : 'Ctrl') + ' 是同一个键。手机上也有触屏的快捷操作 —— 见下面。'}
      </div>

      {COMMAND_GROUPS.map(function (g) {
        const rows = list.filter(function (c) { return c.group === g; });
        if (rows.length === 0) return null;
        return (
          <React.Fragment key={g}>
            <div className="section-title">{g}</div>
            {rows.map(function (c) {
              return (
                <div className="list-row" key={c.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="lr-label">{c.title}</div>
                    {c.hint ? <div className="lr-sub">{c.hint}</div> : null}
                  </div>
                  <div className="spacer" />
                  <div className="lr-right" style={{ display: 'flex', gap: 4 }}>
                    {c.keys && c.keys.length > 0 ? c.keys.map(function (k) {
                      return <span className="kbd" key={k}>{formatCombo(k, mac)}</span>;
                    }) : <span className="lr-sub">没有键位</span>}
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        );
      })}

      <div className="section-title">触屏上的快捷操作</div>
      <div className="list-row"><div><div className="lr-label">长按课表上的课</div><div className="lr-sub">打开「调整某一次课」：调课 / 停课 / 换教室</div></div></div>
      <div className="list-row"><div><div className="lr-label">长按课程卡片再拖</div><div className="lr-sub">拖到别的日子或别的节次松手即改；拖上 / 下边缘改这节课占几节</div></div></div>
      <div className="list-row"><div><div className="lr-label">拖着课表左右滑</div><div className="lr-sub">是翻周，不会误触发拖动 —— 只有先长按才进入拖动</div></div></div>
      <div className="list-row"><div><div className="lr-label">长按顶栏的 ↶</div><div className="lr-sub">打开操作历史，可以退回任意一步</div></div></div>

      <div className="panel-desc" style={{ paddingBottom: 10 }}>
        记不住也没关系：这一页随时能从 <b>设置 →「键盘与快捷操作」</b> 打开
        （电脑上也可以按 {formatCombo('mod+/', mac)}）。
      </div>
    </Sheet>
  );
}