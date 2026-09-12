import type { ExportColumn } from '../core/exporters';

/**
 * 插件契约（v1）。
 *
 * ## 为什么是"声明式"插件，而不是可执行代码
 *
 * 计划书 M2 想要的是「第三方不改核心即可扩展」。最直觉的做法是让插件包带 JS
 * 然后 `import()` 执行它。这条路我没走，原因是它和这个产品的安全立场直接冲突：
 *
 *   1. 应用里没有 eval、没有远程代码、没有第三方 SDK —— 这是"无广告无追踪"承诺
 *      能被验证的前提。开一个能执行任意代码的口子，前面所有保证都变成口头承诺。
 *   2. Capacitor 的 WebView 里动态 import 一个本地文件要走 `_capacitor_file_`，
 *      跨源会被拦；绕过去就得降级 CSP，代价比收益大得多。
 *   3. 用户装插件时根本没有能力判断它会不会偷课表 —— 权限令牌也只能拦住
 *      "读没读"，拦不住"读到之后发去哪儿"。
 *
 * 所以 v1 的插件是**纯数据**：它只能从宿主已经实现好的能力里挑，
 * 配置参数（导出哪些列、导出哪一段），不能引入任何新代码。
 * 这换来一件很重要的事：**装任何插件都不可能让应用做它本来不会做的事**。
 *
 * 代价是表达力有限。将来如果真要做代码插件，正确做法是放到独立进程/WebView 里
 * 加沙箱，而不是在主上下文里 eval —— 那是另一个量级的工程。
 */

/** 目前只开放一类能力；接口留成联合类型，加新能力时不用改调用方 */
export type CapabilityType = 'export';

export interface ExportCapability {
  type: 'export';
  /** 插件内唯一 */
  id: string;
  name: string;
  /** 在界面上给用户的一句话说明 */
  hint?: string;
  format: 'csv' | 'markdown';
  /**
   * 导出范围：
   *   week    当前周
   *   term    整个学期（按周逐周展开）
   *   courses 课程清单（按课程去重）
   */
  scope: 'week' | 'term' | 'courses';
  /** 列，顺序就是输出顺序 */
  columns: ExportColumn[];
  /** markdown + courses 时，是否按课程分小节（比表格更好读） */
  grouped?: boolean;
}

export type Capability = ExportCapability;

export type PluginPermission = 'read:timetable';

export const PERMISSION_LABEL: Record<PluginPermission, string> = {
  'read:timetable': '读取课表内容（课程、教师、教室、时间）',
};

/** 哪种能力需要哪个权限 */
export const CAPABILITY_PERMISSION: Record<CapabilityType, PluginPermission> = {
  export: 'read:timetable',
};

export interface PluginManifest {
  /** 固定字符串，用来确认这确实是一个课表插件包 */
  format: 'timetable-plugin';
  version: 1;
  /** 反向域名风格，安装时用它去重与覆盖 */
  id: string;
  name: string;
  author?: string;
  description?: string;
  pluginVersion?: string;
  permissions: PluginPermission[];
  capabilities: Capability[];
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  /** 内置插件不能卸载，只能停用 */
  builtin: boolean;
  /** 用户实际授予的权限；能力只有在权限齐了之后才生效 */
  granted: PluginPermission[];
}
