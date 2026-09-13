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

/**
 * 目前开放两类能力；接口是联合类型，加新能力时不用改调用方。
 *
 *   export  —— 导出一种格式（列 + 范围都是声明式的）
 *   command —— 在应用里注册一条**命令**（可以绑快捷键），动作只能是调用本插件的某个能力
 *
 * 命令这一类的意义：它是"插件能出现在界面上、能被用户主动触发"的最小入口。
 * 没有它，插件就只是导出菜单里的一行字 —— 用户根本感知不到装过什么。
 * 而它仍然是**零代码**的：命令只是把已有动作包一层，插件无法借它执行任何新逻辑。
 */
export type CapabilityType = 'export' | 'command' | 'settings' | 'import';

export interface ExportCapability {
  type: 'export';
  /** 插件内唯一 */
  id: string;
  name: string;
  /** 在界面上给用户的一句话说明 */
  hint?: string;
  /**
   * 输出格式：
   *   csv      Excel / 表格（带 BOM，Excel 打开不乱码）
   *   markdown 表格，适合笔记软件
   *   json     自描述（列 id + 中文标签 + 行），适合再加工
   *   text     一行一条的纯文本，适合直接粘进聊天
   */
  format: 'csv' | 'markdown' | 'json' | 'text';
  /**
   * 导出范围：
   *   week       某一周（默认当前周）
   *   day        今天
   *   term       整个学期（按周逐周展开）
   *   courses    课程清单（按课程去重）
   *   tasks      任务 / DDL 清单
   *   attendance 出勤记录
   *
   * 每个范围认识哪些列见 core/exporters.ts 的 SCOPE_COLUMNS；
   * 安装时会校验"这个范围里这些列有没有意义"，没意义的组合直接拒 ——
   * 比装上去导出一堆空列要好查得多。
   */
  scope: 'week' | 'day' | 'term' | 'courses' | 'tasks' | 'attendance';
  /** 列，顺序就是输出顺序 */
  columns: ExportColumn[];
  /** markdown + courses 时，是否按课程分小节（比表格更好读） */
  grouped?: boolean;
  /** 导出文件的文件名（不含扩展名）；不写就用应用的默认名字 */
  fileName?: string;
  /**
   * 从**用户设置**里取列（指向本插件某个 settings 能力的 multi 字段 key）。
   *
   * 这是"插件可配置"的关键一步：以前列写死在清单里，用户想少导一列
   * 就得让作者重发一份插件包。现在插件声明"用户可以选哪些列"，
   * 用户在设置页勾选，导出时按勾的结果走。
   *
   * 校验很严：这个 multi 字段的可选项**必须全部是当前 scope 认得的列** ——
   * 于是无论用户怎么勾，导出的列都不可能越界。
   */
  columnsFrom?: string;
  /** 从用户设置里取文件名（指向本插件某个 settings 能力的 text 字段 key） */
  fileNameFrom?: string;
}

export interface CommandCapability {
  type: 'command';
  /** 插件内唯一（与其它能力同一个命名空间） */
  id: string;
  name: string;
  hint?: string;
  /**
   * 这条命令做什么。**只允许指向本插件已声明的能力** ——
   * 写成一个受限的联合类型，将来就算加新动作，也必须先在宿主里实现好。
   */
  action: { kind: 'export'; capabilityId: string };
  /** 建议的默认键位（形如 'mod+shift+e'）。与内置键位冲突时以内置为准，插件不会抢到键 */
  keys?: string[];
}

/**
 * 一个可配置的字段。
 *
 * 只有四种类型，**有意做得这么少**：一旦支持"自定义校验表达式""字段之间联动"，
 * 插件语言就诞生了 —— 而它一定会长成一门没人会调试的方言。
 * 四种类型覆盖了绝大多数真实需求：开关、名字、数字、多选。
 */
export type SettingField =
  | { key: string; type: 'bool'; label: string; hint?: string; default: boolean }
  | { key: string; type: 'text'; label: string; hint?: string; default: string; maxLength?: number; placeholder?: string }
  | { key: string; type: 'number'; label: string; hint?: string; default: number; min?: number; max?: number; step?: number }
  | { key: string; type: 'multi'; label: string; hint?: string; default: string[]; options: string[]; max?: number };

/** 用户在设置页填的值（按字段类型各是一种） */
export type SettingValue = boolean | string | number | string[];

/**
 * 插件自己的设置。
 *
 * 宿主负责**渲染表单**与**存值**，插件只声明"有哪些项、长什么样"。
 * 值存在本机（`timetable.pluginsettings.v1`），会进本地存储体检，
 * 也能被"清掉插件数据"一并清掉。
 */
export interface SettingsCapability {
  type: 'settings';
  /** 插件内唯一 */
  id: string;
  name: string;
  hint?: string;
  fields: SettingField[];
}

/**
 * 导入预设：**这是哪个学校导出来的表**。
 *
 * ## 为什么它是"预设"而不是"写权限"
 *
 * 起初的计划里，导入要配一个新权限 `write:timetable`。真做的时候发现不需要：
 * 插件在这里提供的**只是几个表头写法**（"我们学校的课程名称那一列叫『教学班名称』"），
 * 文件是用户自己选的、解析与预览是宿主做的、入库要用户点确认、之后还能撤销。
 * 插件从头到尾没有碰到数据 —— 为这样一件事弹一个写权限，只会让权限页变得像走过场，
 * 而"每次弹权限都该是真的有事"这条一旦被稀释，真正要紧的权限（读课表、联网）
 * 用户也会随手点同意。
 *
 * 它解决的痛点是真的：教务系统导出的表头五花八门，靠宿主内置的同义词永远追不完。
 */
export interface ImportCapability {
  type: 'import';
  /** 插件内唯一 */
  id: string;
  name: string;
  hint?: string;
  /**
   * 每个字段在这份文件里的**表头写法**（同义词，会与内置同义词一起参与匹配，
   * 且优先于内置 —— 见 core/courseImport.ts 的 scoreHeader）。
   */
  headers: Partial<Record<'name' | 'teacher' | 'day' | 'period' | 'weeks' | 'place', string[]>>;
  /** 表头固定在第几行（0 基）；不写就让宿主自己找 */
  headerRow?: number;
  /** 这份文件是"一行一个时段"，还是"课表矩阵"（行是节次、列是星期） */
  mode?: 'long' | 'matrix';
}

export type Capability = ExportCapability | CommandCapability | SettingsCapability | ImportCapability;

export type PluginPermission = 'read:timetable';

export const PERMISSION_LABEL: Record<PluginPermission, string> = {
  'read:timetable': '读取课表内容（课程、教师、教室、时间）',
};

/**
 * 哪种能力需要哪个权限。
 *
 * `settings` **不需要权限**：它只是插件自己的参数，存在本机、不出设备 ——
 * 为它加一个权限只会让权限页变得像走过场，而"每次弹权限都该是真的有事"这条
 * 一旦被稀释，真正要紧的权限（读课表、写课表、联网）用户也会随手点同意。
 */
export const CAPABILITY_PERMISSION: Partial<Record<CapabilityType, PluginPermission>> = {
  export: 'read:timetable',
  /* 命令目前只能触发导出，读的同样是课表内容 */
  command: 'read:timetable',
  /*
   * import 与 settings 都不需要权限：
   * import 只提供表头写法，文件由用户选、解析与入库由宿主做、预览要用户确认、事后可撤销；
   * settings 只是插件自己的参数。理由见上面 ImportCapability 的说明。
   */
};

export interface PluginManifest {
  /** 固定字符串，用来确认这确实是一个课表插件包 */
  format: 'timetable-plugin';
  version: 1;
  /**
   * 插件是按哪一版**宿主接口**写的。
   *
   * 不写视为 1（最早的版本）。宿主只接受 <= 自己支持的最高版本：
   * 比宿主新的插件一律装不上 —— 这比"装上之后列错位、导出空表"好得多，
   * 后者用户根本看不出是版本不匹配。应用将来加能力时把这个数字往上加。
   */
  apiVersion?: number;
  /** 最低要求的主程序版本（如 '1.10.0'）。宿主只做格式校验，比较在界面上做 */
  minAppVersion?: string;
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
