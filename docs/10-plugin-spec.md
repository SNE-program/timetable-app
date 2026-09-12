# 插件规范 v1

> 版本：v1（对应应用 0.9.4+） · 示例包见 [`examples/plugin-teacher-contact.tbplugin.json`](../examples/plugin-teacher-contact.tbplugin.json)

---

## 1. 设计立场：插件是"声明"，不是"代码"

计划书 M2 想要的是「第三方不改核心即可扩展」。最直觉的做法是让插件包带 JS
然后 `import()` 执行它。**这条路我没有走**，原因不是懒：

| 问题 | 说明 |
| --- | --- |
| 破坏安全承诺 | 应用里没有 eval、没有远程代码、没有第三方 SDK —— 这是"无广告无追踪"能被验证的前提。开一个执行任意代码的口子，前面所有保证都变成口头承诺 |
| 技术上也不顺 | Capacitor 的 WebView 里动态 import 本地文件要走 `_capacitor_file_`，跨源会被拦；绕过去就得降级 CSP |
| 权限令牌拦不住 | 用户装插件时没有能力判断它会不会偷课表。令牌能拦"读没读"，拦不住"读到之后发去哪儿" |

所以 v1 的插件是**纯数据**：只能从宿主已经实现好的能力里挑，配置参数。
换来一件很重要的事 —— **装任何插件都不可能让应用做它本来不会做的事**。

代价是表达力有限，这一点必须诚实承认。将来若真要做代码插件，正确做法是放到
独立进程 / 独立 WebView 里加沙箱，而不是在主上下文里 eval，那是另一个量级的工程。

---

## 2. 插件包格式

一个 `.json` 文件（扩展名习惯用 `.tbplugin.json`，但不是必须）。

```json
{
  "format": "timetable-plugin",
  "version": 1,
  "id": "example.teacher-contact",
  "name": "教师联系方式表",
  "author": "示例",
  "pluginVersion": "1.0.0",
  "description": "给用户看的一句话说明",
  "permissions": ["read:timetable"],
  "capabilities": [ /* 见下 */ ]
}
```

### 字段约束

| 字段 | 约束 |
| --- | --- |
| `format` | 必须是 `"timetable-plugin"` |
| `version` | 目前只支持 `1` |
| `id` | `^[a-z0-9][a-z0-9._-]{1,63}$`，全局唯一；不能与内置插件（`builtin.*`）冲突 |
| `name` | 非空 |
| `permissions` | 目前只有 `read:timetable` |
| `capabilities` | 1–8 个 |

---

## 3. 能力：`export`

目前唯一开放的能力类型。

```json
{
  "type": "export",
  "id": "teacher-contact-csv",
  "name": "教师联系方式（CSV）",
  "hint": "显示在名称下面的一行小字",
  "format": "csv",
  "scope": "courses",
  "columns": ["course", "teacher", "location", "period", "note"],
  "grouped": false
}
```

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `format` | `csv` \| `markdown` | CSV 会写 UTF-8 BOM（不加 Excel 打开中文全乱码），用 CRLF 换行并遵循 RFC4180 转义 |
| `scope` | `week` \| `term` \| `courses` | 当前周 / 整学期逐周展开 / 按课程去重 |
| `columns` | 见下表 | 顺序就是输出顺序，1–12 列 |
| `grouped` | 布尔，可选 | 仅 `markdown` + `scope: courses` 时有效：按课程分小节而不是画表格 |

### 可用的列

| 列名 | 表头 | 内容 |
| --- | --- | --- |
| `date` | 日期 | `2026-09-10` |
| `weekday` | 星期 | `周四` |
| `week` | 周次 | `第 7 周` |
| `period` | 节次 | `3-4`（单节时是 `3`） |
| `start` | 开始 | `10:15` |
| `end` | 结束 | `11:00` |
| `course` | 课程 | 课程名 |
| `teacher` | 教师 | 可能为空 |
| `location` | 教室 | 可能为空 |
| `building` | 教学楼 | 可能为空 |
| `note` | 备注 | 实验 / 考试 / 体育 |

`scope: courses` 时只有 `course` / `teacher` / `location` / `period` / `note` 有意义
（这时 `period` 是该课程全部上课时段的汇总，`location` 是全部教室的汇总）。

---

## 4. 权限

| 权限 | 说明 | 哪个能力需要 |
| --- | --- | --- |
| `read:timetable` | 读取课表内容（课程、教师、教室、时间） | `export` |

**未在 `permissions` 里声明的权限，对应的能力会被直接拒绝安装** ——
不允许"用到才说要"。

安装后权限默认是**未授予**的（内置插件除外），要在「设置 → 插件」里手动勾上才生效。
撤销权限或停用插件时，它提供的导出格式会立刻从菜单里消失。

---

## 5. 校验规则（安装时全部会跑）

一条不过就装不上，并且会明确告诉你是哪一条：

- 不是合法 JSON / 不是对象
- `format` 不是 `timetable-plugin`
- `version` 不是 1
- `id` 不符合字符集要求，或与内置插件冲突
- 缺少 `name`
- 出现不认识的权限
- 能力数量为 0 或超过 8
- 能力类型不认识（目前只支持 `export`）
- 能力 `id` 为空或在同一插件内重复
- 能力缺少 `name`
- `format` 不是 `csv` / `markdown`
- `scope` 不是 `week` / `term` / `courses`
- `columns` 为空、超过 12 列，或含不认识的列名
- 能力需要的权限没在 `permissions` 里声明

---

## 6. 内置插件

这三个本身就是用同一套接口实现的（吃自己的狗粮）：

| id | 名称 | 提供 |
| --- | --- | --- |
| `builtin.csv-week` | 当前周 CSV | 本周课表（CSV） |
| `builtin.md-term` | 整学期 Markdown | 整学期课表（Markdown） |
| `builtin.course-list` | 课程清单 | 课程清单（CSV）+ 课程清单（Markdown） |

内置插件可以停用，但**不能卸载**，也不能被第三方同名覆盖。

---

## 7. 存储

安装状态存在 `localStorage['timetable.plugins.v1']`：

```json
{
  "installed": [ /* 非内置插件的清单 */ ],
  "disabled": ["builtin.csv-week"],
  "granted": { "example.teacher-contact": ["read:timetable"] }
}
```

数据坏了会退回空状态（只剩内置插件），不会导致应用打不开。
