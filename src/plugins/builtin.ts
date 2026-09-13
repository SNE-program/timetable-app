import type { PluginManifest } from './types';

/**
 * 内置插件 —— 也就是计划书里说的"官方示例插件"。
 *
 * 这几条导出格式**本身就是通过插件 API 提供的**，不是另写一套。
 * 这么做是有意的：官方插件吃自己的狗粮，接口设计得不好用会第一时间暴露出来，
 * 而不是等第三方来踩。
 *
 * 内置插件在设置页里和第三方插件并排显示，可以停用，但不能卸载。
 *
 * ## 第一个内置插件带上了"设置"（v1.9.13）
 *
 * 这不是为了好看：**接口设计得不好用，自己第一个就会踩到**。
 * 让内置的「当前周 CSV」吃自己那套设置能力（选列 + 文件名），
 * 于是"字段够不够表达真实需求""表单排得下吗"这类问题在发版前就暴露了。
 */
export const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    format: 'timetable-plugin',
    version: 1,
    id: 'builtin.csv-week',
    name: '当前周 CSV',
    author: '内置',
    pluginVersion: '1.0.0',
    description: '把本周课表导成 CSV 表格，Excel、WPS、Numbers 都能直接打开。可在下面自己选要哪些列。',
    permissions: ['read:timetable'],
    capabilities: [
      {
        type: 'settings',
        id: 'csv-week-prefs',
        name: '导出哪些列',
        hint: '改完立刻生效，不必重新安装插件；「恢复默认」可以随时回到这一组。',
        fields: [
          {
            key: 'columns',
            type: 'multi',
            label: '要导出的列',
            hint: '顺序固定，不按勾选先后',
            /*
             * 默认值与下面 export 里声明的 columns **完全一致** ——
             * 内置插件是"开箱即用"的东西：加了设置之后，什么都没改的用户
             * 导出来的文件必须和以前一模一样，否则这叫回归，不叫新功能。
             */
            default: ['date', 'weekday', 'period', 'start', 'end', 'course', 'teacher', 'location'],
            options: ['date', 'weekday', 'period', 'start', 'end', 'course', 'teacher', 'location'],
          },
          {
            key: 'fileName',
            type: 'text',
            label: '文件名',
            hint: '会自动接上 .csv；留空就用默认名',
            default: '本周课表',
            maxLength: 40,
          },
        ],
      },
      {
        type: 'export',
        id: 'csv-week',
        name: '本周课表（CSV）',
        hint: '一行一节课，中文用 UTF-8 BOM 写，Excel 打开不会乱码',
        format: 'csv',
        scope: 'week',
        columns: ['date', 'weekday', 'period', 'start', 'end', 'course', 'teacher', 'location'],
        /* 这两行就是"插件可配置"的全部：列与文件名改从用户设置里取 */
        columnsFrom: 'columns',
        fileNameFrom: 'fileName',
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
