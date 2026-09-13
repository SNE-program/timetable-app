import {
  canRedo, canUndo, closeSheets, getState, openAdd, openChangelog, openHistory, openManual, openMascotCenter,
  openSearch, openShortcutSheet, openTask, redo, setTab, setWeek, undo,
} from './store';
import { registerCommands, type Command } from './commands';
import { TABS } from './tabs';

/**
 * 内置命令表（见 commands.ts 的说明）。
 *
 * 挑选的标准：**高频 + 按错也不会造成损失**。所以这里没有"清空课表""删除课程"
 * 这类危险动作 —— 快捷键最大的风险是误触，危险动作不给键位。
 *
 * 键位沿用原来 App.tsx 里那一套（Ctrl+Z / Ctrl+Shift+Z / ←→ / 1–5 / /），
 * 老用户的手感不变，只是现在**能在界面上看到它们了**。
 */
export function installBuiltinCommands(): void {
  const list: Command[] = [
    {
      id: 'undo', title: '撤销', group: '基础', keys: ['mod+z'],
      hint: '退回上一步；提示条上的「撤销」也是这个动作',
      enabled: function () { return canUndo(); }, run: function () { undo(); },
    },
    {
      id: 'redo', title: '重做', group: '基础', keys: ['mod+shift+z', 'mod+y'],
      enabled: function () { return canRedo(); }, run: function () { redo(); },
    },
    {
      id: 'history', title: '操作历史', group: '基础', keys: ['mod+h'],
      hint: '按时间列出最近的改动，可以退回任意一步',
      run: function () { openHistory(); },
    },
    {
      id: 'search', title: '搜索课程 / 任务', group: '基础', keys: ['mod+k', '/'],
      run: function () { openSearch(); },
    },
    {
      id: 'close', title: '关闭当前弹层', group: '基础', keys: ['escape'],
      hint: '说明：输入框里按 Esc 也能关掉弹层（比如搜索框）',
      enabled: function () { return anySheetOpen(); }, run: function () { closeSheets(); },
    },
    { id: 'week-prev', title: '上一周', group: '导航', keys: ['arrowleft'], enabled: noSheet, run: function () { setWeek(getState().week - 1); } },
    { id: 'week-next', title: '下一周', group: '导航', keys: ['arrowright'], enabled: noSheet, run: function () { setWeek(getState().week + 1); } },
    {
      id: 'today', title: '回到今天', group: '导航', keys: ['t'], enabled: noSheet,
      run: function () { setTab('today'); },
    },
    {
      id: 'new-course', title: '新建课程', group: '课表', keys: ['mod+n'],
      run: function () { openAdd(); },
    },
    {
      id: 'new-task', title: '新建任务 / DDL', group: '课表', keys: ['mod+shift+n'],
      run: function () { openTask(null); },
    },
    {
      id: 'mascot-center', title: '角色中心', group: '课表', keys: ['mod+m'],
      hint: '换一个 / 做一个 / 分享与获取',
      run: function () { openMascotCenter(); },
    },
    {
      id: 'shortcuts', title: '显示这一页', group: '帮助', keys: ['mod+/', 'shift+/'],
      run: function () { openShortcuts(); },
    },
    {
      id: 'manual', title: '使用说明书', group: '帮助', keys: ['f1'],
      run: function () { openManual(); },
    },
    {
      id: 'changelog', title: '更新日志', group: '帮助',
      run: function () { openChangelog(); },
    },
  ];

  /* 1–5 切页：与底部标签栏一一对应 */
  TABS.forEach(function (t, i) {
    list.push({
      id: 'tab-' + t.key, title: '切到「' + t.label + '」', group: '导航', keys: [String(i + 1)],
      enabled: noSheet, run: function () { setTab(t.key); },
    });
  });

  registerCommands(list);
}

/** 弹层开着的时候不让 ←→ / 数字 / t 抢键：用户以为在弹层里操作，结果课表翻页了 */
function noSheet(): boolean { return !anySheetOpen(); }

function anySheetOpen(): boolean {
  const s = getState();
  return !!(s.searchSheet || s.addSheet || s.taskSheet || s.taskEditor || s.courseSheet || s.editSheet
    || s.overrideSheet || s.schemeSheet || s.importSheet || s.exportSheet || s.shareSheet || s.manualSheet
    || s.changelogSheet || s.update.sheet || s.cloud.sheet || s.cloud.passwordSheet || s.historySheet
    || s.mascotCenter || s.mascotEditor);
}

/** 快捷键说明：一个普通弹层，开关与其他弹层一样在 store 里 */
function openShortcuts(): void { openShortcutSheet(); }