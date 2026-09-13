import type { TabKey } from './store';
import type { IconName } from '../ui/icons';

/**
 * 底部标签栏的五个页面。
 *
 * 原先定义在 App.tsx 里（只有界面用得到）；命令表（快捷键 1–5 切页）也要用它，
 * 所以搬到这里 —— 两处各写一份的话，加一个页面就会漏掉一边的快捷键。
 */
export const TABS: { key: TabKey; icon: IconName; label: string }[] = [
  { key: 'week', icon: 'calendar', label: '本周' },
  { key: 'today', icon: 'sun', label: '今日' },
  { key: 'tasks', icon: 'tasks', label: '任务' },
  { key: 'studio', icon: 'palette', label: '外观' },
  { key: 'settings', icon: 'settings', label: '设置' },
];