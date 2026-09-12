import type { PluginManifest } from './types';

/**
 * 内置插件 —— 也就是计划书里说的"官方示例插件"。
 *
 * 这几条导出格式**本身就是通过插件 API 提供的**，不是另写一套。
 * 这么做是有意的：官方插件吃自己的狗粮，接口设计得不好用会第一时间暴露出来，
 * 而不是等第三方来踩。
 *
 * 内置插件在设置页里和第三方插件并排显示，可以停用，但不能卸载。
 */
export const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    format: 'timetable-plugin',
    version: 1,
    id: 'builtin.csv-week',
    name: '当前周 CSV',
    author: '内置',
    pluginVersion: '1.0.0',
    description: '把本周课表导成 CSV 表格，Excel、WPS、Numbers 都能直接打开。',
    permissions: ['read:timetable'],
    capabilities: [
      {
        type: 'export',
        id: 'csv-week',
        name: '本周课表（CSV）',
        hint: '一行一节课，中文用 UTF-8 BOM 写，Excel 打开不会乱码',
        format: 'csv',
        scope: 'week',
        columns: ['date', 'weekday', 'period', 'start', 'end', 'course', 'teacher', 'location'],
      },
    ],
  },
  {
    format: 'timetable-plugin',
    version: 1,
    id: 'builtin.md-term',
    name: '整学期 Markdown',
    author: '内置',
    pluginVersion: '1.0.0',
    description: '把整个学期逐周展开成一张 Markdown 表格，适合粘进笔记或文档。',
    permissions: ['read:timetable'],
    capabilities: [
      {
        type: 'export',
        id: 'md-term',
        name: '整学期课表（Markdown）',
        hint: '按周逐周列出；学期不设结束时只导出前 20 周，避免无穷大',
        format: 'markdown',
        scope: 'term',
        columns: ['week', 'weekday', 'date', 'period', 'course', 'teacher', 'location'],
      },
    ],
  },
  {
    format: 'timetable-plugin',
    version: 1,
    id: 'builtin.course-list',
    name: '课程清单',
    author: '内置',
    pluginVersion: '1.0.0',
    description: '按课程去重后的清单：教师、教室、上课时间一目了然，也可以用来检查录漏了什么。',
    permissions: ['read:timetable'],
    capabilities: [
      {
        type: 'export',
        id: 'course-list-csv',
        name: '课程清单（CSV）',
        hint: '一门课一行，含该课用到的全部教室与时段',
        format: 'csv',
        scope: 'courses',
        columns: ['course', 'teacher', 'location', 'period', 'note'],
      },
      {
        type: 'export',
        id: 'course-list-md',
        name: '课程清单（Markdown）',
        hint: '按课程分小节，比表格更好读',
        format: 'markdown',
        scope: 'courses',
        columns: ['course', 'teacher', 'location', 'period', 'note'],
        grouped: true,
      },
    ],
  },
];
