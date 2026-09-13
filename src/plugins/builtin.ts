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
const BUILTIN_PLUGINS: PluginManifest[] = [
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

/**
 * 检查用的内置插件：`?devplugin=import`。
 *
 * 导入预设这条路（"这是哪个学校导出来的表"）在无头浏览器里验不了 ——
 * 无头环境装不了插件文件。所以这里造一个**故意对不上**的预设：
 * 它认的是另一所学校的表头，用在内置样例表上应该明确地"只认出 0 列"，
 * 于是"选错预设会不会被看出来"这件事变成可测的（见 diagnostics 的 ?importcheck=1）。
 * 生产路径完全不受影响：不带参数时它不出现。
 */
function devPlugin(): PluginManifest | null {
  let mode = '';
  try { mode = new URLSearchParams(window.location.search).get('devplugin') || ''; } catch (e) { return null; }
  if (mode === 'rule') {
    /*
     * 检查用的**规则**插件（?devplugin=rule）。
     *
     * 规则没有界面可点（它是"到点自己发通知"），无头环境里也等不到它真的响。
     * 所以给两条规则，让 `?rulecheck=1` 能把**真实数据**展开成排程项报出来：
     * 一条任务规则、一条每天固定时刻的规则，两条都走宿主的白名单与频率上限。
     */
    return {
      format: 'timetable-plugin',
      version: 1,
      apiVersion: 3,
      id: 'dev.rule',
      name: '检查用提醒规则',
      author: '检查',
      pluginVersion: '1.0.0',
      description: '两条规则：作业提前两小时、每天早上七点半报今天的课。用来检查规则排程与频率上限。',
      permissions: ['notify'],
      capabilities: [
        {
          type: 'rule',
          id: 'ddl-2h',
          name: '作业提前两小时',
          hint: '来自检查用插件',
          when: { event: 'task.dueSoon', minutes: 120 },
          then: { notify: { title: '还有两小时：{task.title}', body: '{task.course} · {task.due} 截止' } },
        },
        {
          type: 'rule',
          id: 'morning',
          name: '早上报今天的课',
          when: { event: 'daily.at', at: '07:30' },
          then: { notify: { title: '今天 {today.count} 节课', body: '第一节 {today.first} · {term.name} 第 {week} 周' } },
        },
      ],
    };
  }
  if (mode !== 'import') return null;
  return {
    format: 'timetable-plugin',
    version: 1,
    apiVersion: 2,
    id: 'dev.import-preset',
    name: '检查用导入预设',
    author: '检查',
    pluginVersion: '1.0.0',
    description: '另一所学校的表头写法，用来检查"选错预设会不会被看出来"。',
    permissions: [],
    capabilities: [
      {
        type: 'import',
        id: 'other-school',
        name: '另一所学校（检查用）',
        hint: '表头是「教学班名称 / 上课星期 / 起止节次」这一套',
        headers: {
          name: ['教学班名称'],
          day: ['上课星期'],
          period: ['起止节次'],
        },
        headerRow: 0,
      },
    ],
  };
}

/**
 * 内置插件列表。
 *
 * 走函数而不是直接导出常量，是为了让检查用的那条（`?devplugin=`）能挂进来，
 * 而**生产路径一行都不受影响**。
 */
export function builtinPlugins(): PluginManifest[] {
  const dev = devPlugin();
  return dev ? BUILTIN_PLUGINS.concat([dev]) : BUILTIN_PLUGINS.slice();
}
