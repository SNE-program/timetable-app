# 课表 App 开发计划书

> 版本：v1.0 · 配套文档：[竞品调研](./01-competitor-research.md) · [总体设计](./02-architecture-design.md) · [核心数据模型](./03-core-data-model.ts)

---

## 0. 已确认的决策

| 决策项 | 结论 |
| --- | --- |
| 目标平台 | **Android 手机优先**（桌面悬浮、iOS、Web 均后置） |
| 技术栈 | **TypeScript monorepo + Capacitor**（Web 技术栈 + 原生桥接） |
| 交付顺序 | 本计划书 → 界面原型（可见可点）→ 按里程碑实现 |
| AI 策略 | 现在只预留接口与管线，M3 再真正接入 |

---

## 1. 项目目标（全部可验收）

### 1.1 功能目标
1. 用户能在 5 分钟内录入完整一学期课表（手动 / 拍照识别 / 导入）。
2. 单双周、连堂、调课停课补课、换教室、多作息全部正确表达与显示。
3. 每节课按时提醒，**准时率 ≥ 99%**（真机实测，含息屏与重启后）。
4. 界面可以自己改：换色、换圆角、换字体、换布局，并能导出主题分享。
5. 预留插件与 AI 接入点，第三方不改核心即可扩展。

### 1.2 非功能目标
| 指标 | 目标值 |
| --- | --- |
| 冷启动到课表可见 | ≤ 1.2 秒（中端机） |
| 提醒准时误差 | ≤ 30 秒 |
| 离线可用性 | 100%（除 AI 与同步外的全部功能） |
| core 包单测覆盖率 | 100%（时间引擎不容出错） |
| APK 体积 | ≤ 25 MB |
| 广告 / 追踪 SDK | **0 个** |

---

## 2. 范围界定

### 2.1 v1 范围内
课表录入与编辑 · 周视图与今日视图 · 提醒系统 · 主题 DIY · 导入导出 · 桌面小组件 · 插件框架（骨架 + 示例）· AI 接口预留

### 2.2 明确不做（v1）
| 不做 | 原因 |
| --- | --- |
| 校园社交 / 蹭课 | 竞品证明不是留存关键，且带来内容审核成本 |
| 内置教务系统爬虫 | 千校千面、维护地狱、合规风险（见调研第 3 节） |
| 云同步与账号 | 本地优先；等单机体验打磨好再加 |
| iOS / 桌面端 | 先在一个平台做透，core 保持平台无关以便将来迁移 |
| 广告与任何商业化 | 直接对冲"WakeUp 变质"的用户焦虑，是产品立场 |

---

## 3. 技术栈定稿

| 关注点 | 选型 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript（strict 模式） | 一套类型贯穿核心 / UI / 插件 / AI 契约 |
| 包管理 | pnpm workspaces + Turborepo | 多包共存、增量构建与缓存 |
| UI 框架 | React 18 + Vite | 生态最大，主题与 DIY 方案最成熟 |
| 样式 | Tailwind + CSS 自定义属性（Design Token） | **主题即变量注入，运行时热切换** |
| 动效 | Framer Motion | 手势与过渡（滑周、拖拽调课） |
| 状态 | Zustand（UI 状态）+ TanStack Query（异步） | 轻量、可预测 |
| 本地数据库 | SQLite（@capacitor-community/sqlite） | 移动端唯一靠谱的结构化本地库 |
| 数据访问 | 手写 DAO + zod 校验 | 比 ORM 少一层不确定性，迁移可控 |
| 移动壳 | Capacitor（创建时取最新稳定版） | 复用 Web 代码，同时拿到原生能力 |
| 本地通知 | @capacitor/local-notifications + 自定义原生补丁 | 需要 AlarmManager 精确闹钟才能保证准时 |
| 桌面小组件 | 原生 Kotlin（Jetpack Glance / RemoteViews） | Capacitor 无现成方案，需自写插件 |
| 测试 | Vitest（core）+ Playwright（UI）+ 真机手测清单 | 时间引擎必须锁死 |
| AI | 自研 Provider 适配层（OpenAI 兼容 / Ollama） | 不绑定厂商，可换可关 |
| 构建发布 | GitHub Actions → 签名 APK | 免费、可复现 |

> 说明：具体依赖版本在初始化当天按当时最新稳定版锁定，并写入 lockfile，不在文档里写死。

---

## 4. 仓库结构与包职责

~~~
课表APP/
├── packages/
│   ├── core/          # 【最重要】数据模型 + 时间引擎 + 冲突检测 + 提醒调度 + ChangeSet
│   ├── storage/       # SQLite schema、迁移、DAO、导入导出序列化
│   ├── theme/         # Design Token、主题包 schema、内置主题、自动色板生成
│   ├── ui/            # React 组件：周视图、今日、卡片、时间轴、设置面板
│   ├── plugin-sdk/    # 插件类型、manifest schema、示例模板、CLI 脚手架
│   ├── plugin-host/   # 插件加载、权限令牌、事件总线、宿主 API
│   ├── ai/            # AIProvider 适配、AITask 流水线、Schema 校验、提示词
│   └── platform/      # 通知/文件/权限 的抽象接口 + Capacitor 实现
├── apps/
│   └── mobile/        # Capacitor 应用（React UI + android/ 原生工程）
├── plugins/           # 官方示例插件：ics-import / bark-channel / theme-sakura
├── android-widget/    # Kotlin 桌面小组件模块
└── docs/              # 全部设计文档
~~~

### 4.1 各包边界（硬约束）

| 包 | 可以依赖 | 绝对不可以 |
| --- | --- | --- |
| core | 无（零依赖） | 引用 DOM、Capacitor、React、网络 |
| storage | core | 引用 UI |
| theme | 无 | 引用 React |
| ui | core, theme | 直接读 SQLite |
| plugin-host | core, storage, platform | 让插件拿到数据库句柄 |
| ai | core | 直接写数据库（只能产 ChangeSet） |

### 4.2 core 对外 API（先定接口，后填实现）
~~~ts
createEngine(input: EngineInput): TimeEngine
expandWeek(week) / expandDay(date) / nextEvent(now) / conflicts(date) / freeSlots(date)
applyChangeSet(set): Promise<{ result, undo }>
renderReminders(engine, rules): ScheduledNotification[]
timetableToPromptText(engine, range): string   // 供未来 AI 使用
~~~

---

## 5. 开发环境与初始化步骤

### 5.1 工具链
Node LTS · pnpm · JDK 17 · Android Studio（含 SDK 34+ 与平台工具）· Git

### 5.2 初始化顺序
1. 初始化 pnpm workspace 与 Turborepo 配置
2. 建 packages/core，先写类型与测试（**测试先行，因为时间引擎必须正确**）
3. 建 packages/ui 与 apps/mobile，接入 Vite + React + Tailwind
4. capacitor init → 添加 android 平台 → 真机跑通 Hello World
5. 接入 SQLite 与通知插件，打通"录入 → 存储 → 展示 → 提醒"最小闭环
6. 配 GitHub Actions 出 APK

### 5.3 签名与调试
生成 debug keystore；release 用本地 keystore 并加入 .gitignore；CI 通过 GitHub Secrets 注入。

---

## 6. Android 专项设计（本项目成败的关键）

> 跨平台框架最容易翻车的地方就是"提醒不准"。这一节是整套方案里技术含量最高的部分。

### 6.1 权限清单

| 权限 | 用途 | 时机 |
| --- | --- | --- |
| POST_NOTIFICATIONS | 发送通知（Android 13+ 运行时申请） | 首次设置提醒时 |
| SCHEDULE_EXACT_ALARM | 精确闹钟，保证准点提醒 | 首次设置提醒时，附人话解释 |
| RECEIVE_BOOT_COMPLETED | 重启后自动重排全部提醒 | 安装即声明 |
| VIBRATE | 震动提醒 | 安装即声明 |
| REQUEST_IGNORE_BATTERY_OPTIMIZATIONS | 引导用户加入电池白名单（国产 ROM 必需） | 检测到提醒延迟时引导 |

### 6.2 提醒调度策略（分层，避免滥用精确闹钟）
| 场景 | 机制 | 理由 |
| --- | --- | --- |
| 课前提醒（分钟级精度） | **AlarmManager setAlarmClock / setExactAndAllowWhileIdle** | 能穿透 Doze 模式，最可靠 |
| 每日课表摘要（21:00） | WorkManager 周期任务 | 精度要求低，省电 |
| 变更通知（调课/停课） | 即时本地通知 | 用户主动操作触发 |
| 桌面小组件刷新 | 变更时广播 + 每天定时兜底 | 无需实时 |

### 6.3 通知渠道设计
| 渠道 ID | 名称 | 重要度 | 用途 |
| --- | --- | --- | --- |
| class-reminder | 上课提醒 | 高（响铃+震动） | 课前 N 分钟 |
| daily-brief | 明日课表 | 默认 | 每晚摘要 |
| schedule-change | 课表变动 | 高 | 调课、停课、换教室 |
| silent-info | 其他提示 | 低（静默） | 插件、同步等 |

### 6.4 可靠性加固（逐条都要做）
1. **通知指纹去重**：hash(sessionId|date|offset|channel) 落库，杜绝重复提醒；
2. **开机自启重排**：监听 BOOT_COMPLETED，重建未来 7 天的全部闹钟；
3. **应用更新后重排**：MY_PACKAGE_REPLACED 同样重排；
4. **时区/时间变更重排**：TIMEZONE_CHANGED / TIME_SET 广播；
5. **错过补偿**：App 启动时回扫过去 10 分钟，补一条"刚刚错过"的提醒；
6. **国产 ROM 引导页**：一个"提醒健康检查"页，逐项显示权限与电池优化的红黄绿状态，一键跳转系统设置；
7. **只能排未来 N 天**：Android 对闹钟数量有限制，滚动排未来 7 天，App 每次打开续排。

### 6.5 桌面小组件
- 形态：2x2（下一节课 + 倒计时）、4x2（今日剩余课程列表）；
- 实现：原生 Kotlin（Glance）+ 一个自定义 Capacitor 插件负责数据桥与刷新；
- 数据：由 Web 层把"未来 7 天的展开课表"写入共享存储（SharedPreferences/JSON 文件），小组件只读，避免小组件里跑时间引擎；
- 点击行为：点卡片打开 App 对应课程详情。

### 6.6 存储方案
- 主库：SQLite，位于应用私有目录；
- 迁移：用递增版本的 migration 脚本，**每次升级前自动备份一份到本地**；
- 导出：完整 JSON 备份（可读、可迁移、可在未来同步）；
- 分享码：课表压缩 → base64url 短码，用于同学之间互相导入。

### 6.7 性能与体积
- core 的记忆化缓存，避免 UI 重算；
- 首屏只渲染当前周，其余周懒加载；
- 路由级代码分割；不引入重型 UI 库（如全套 Material），自己写组件以配合主题系统。

---

## 7. 数据层设计

### 7.1 表结构草案
~~~sql
CREATE TABLE term (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL,
  total_weeks INTEGER NOT NULL, period_scheme_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, source TEXT, confidence REAL
);

CREATE TABLE period_scheme (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, periods_json TEXT NOT NULL,
  notes TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, source TEXT
);

CREATE TABLE course (
  id TEXT PRIMARY KEY, term_id TEXT NOT NULL, name TEXT NOT NULL, teacher TEXT,
  credits REAL, color_token TEXT, tags_json TEXT, note TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, source TEXT, confidence REAL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY, term_id TEXT NOT NULL, course_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
  weeks_json TEXT NOT NULL,             -- WeekSelector，支持任意不规则周次
  location TEXT, building TEXT, teacher_override TEXT, kind TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, source TEXT, confidence REAL
);

CREATE TABLE override (
  id TEXT PRIMARY KEY, term_id TEXT NOT NULL, session_id TEXT NOT NULL, date TEXT NOT NULL,
  action TEXT NOT NULL, patch_json TEXT, reason TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, source TEXT
);

CREATE TABLE reminder_rule (
  id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_id TEXT,
  offsets_json TEXT NOT NULL, channels_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, weeks_json TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, source TEXT
);

CREATE TABLE notification_log (
  fingerprint TEXT PRIMARY KEY, event_key TEXT NOT NULL, channel_id TEXT NOT NULL,
  fired_at INTEGER NOT NULL
);

CREATE TABLE change_set (            -- 审计与撤销（AI / 导入 / 插件共用）
  id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT, ops_json TEXT NOT NULL,
  provenance_json TEXT, applied_at INTEGER, reverted_at INTEGER
);

CREATE TABLE plugin (
  id TEXT PRIMARY KEY, version TEXT, enabled INTEGER DEFAULT 1,
  manifest_json TEXT NOT NULL, granted_permissions_json TEXT
);

CREATE TABLE setting (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);

CREATE INDEX idx_session_term   ON session(term_id, day_of_week);
CREATE INDEX idx_session_course ON session(course_id);
CREATE INDEX idx_override_date  ON override(date, session_id);
CREATE INDEX idx_notif_fired    ON notification_log(fired_at);
~~~

### 7.2 备份与迁移原则
每次 schema 升级：先导出完整 JSON 备份 → 执行迁移 → 校验行数与抽样字段 → 失败自动回滚。
用户在设置里随时可导出/恢复，这是"数据属于用户"的产品承诺。

---

## 8. M0 任务拆解（地基，最重要的一段）

| 编号 | 任务 | 产出 | 验收标准 | 预估 |
| --- | --- | --- | --- | --- |
| M0-1 | 初始化 monorepo | workspace + Turborepo + TS 严格模式 + ESLint | 一条命令跑通全部包的 build 与 test | 0.5 天 |
| M0-2 | core 类型定义 | 数据模型全部类型 | 与 03 号文档一致，编译通过 | 0.5 天 |
| M0-3 | WeekSelector 解析 | 周次 → 日期集合 | 覆盖 all/range/list/单双周/不规则周，测试全绿 | 1 天 |
| M0-4 | 时间引擎 expandWeek/expandDay | 事件展开 | 跨月、跨年、闰年、作息切换全部正确 | 2 天 |
| M0-5 | Override 应用 | 停课/补课/换教室/改期 | 用例覆盖每一种 action | 1 天 |
| M0-6 | 冲突检测与 freeSlots | 冲突与空闲计算 | 时间重叠、跨楼赶不上、连堂识别 | 1 天 |
| M0-7 | storage 层 | schema + DAO + 迁移 | 增删改查 + 软删除通过集成测试 | 2 天 |
| M0-8 | Capacitor 壳 + 真机跑通 | Android 工程 | 真机安装启动 | 1 天 |
| M0-9 | 周视图 UI | 网格 + 节次轴 + 周次条 | 滑周、今日列高亮、课程卡正确 | 3 天 |
| M0-10 | 课程 CRUD 界面 | 添加/编辑/删除课程与安排 | 支持单双周与连堂选择器 | 2 天 |
| M0-11 | 提醒调度 | 规则解析 + 通知排程 + 指纹去重 | 真机息屏、重启、杀进程后仍准点 | 3 天 |
| M0-12 | 提醒健康检查页 | 权限与电池优化状态面板 | 红黄绿状态正确，可跳转系统设置 | 1 天 |

**M0 合计约 19 个工作日**，完成即可交付一个"能用、提醒准"的最小可用版本。

---

## 9. 里程碑与排期

| 里程碑 | 内容 | 预估 | 关键验收 |
| --- | --- | --- | --- |
| **M0 地基** | 见第 8 节 | ~4 周 | 单双周/连堂/调课全对；提醒真机准点率 ≥ 99% |
| **M1 好看好改** | 今日页 · 主题系统 · 6 套内置主题 · DIY 面板 · ICS/JSON 导入导出 · 桌面小组件 | ~4 周 | 用户能改出一套自己的界面并导出主题；别人扫码能用 |
| **M2 可扩展** | 插件 SDK · 插件宿主 · 3 个官方示例插件 · 分享码 | ~4 周 | 第三方插件不改核心即可安装并生效 |
| **M3 有 AI** | AIProvider 层 · 截图导入 · 自然语言录入 · 日程问答 | ~3 周 | 截图识别结果必须 diff 确认才入库；关掉 AI 一切正常 |
| **M4 深度** | 学习计划 · 选课冲突建议 · Agent · 同步（可选） | 持续 | — |

**排序理由**：先"准"，再"美"，再"能扩"，最后"聪明"。顺序颠倒的话，越聪明的功能越建在流沙上。

---

## 10. 测试策略

### 10.1 core 单元测试用例清单（必须全部覆盖）
- 周次：全周 / 1-16 周 / 单周 / 双周 / [1,2,3,7,8] 不规则 / 跨学期边界
- 时间：跨月、跨年、闰年 2 月、时区切换、作息方案切换周
- 连堂：3-4 节、5-8 节连堂、跨午休的连堂
- Override：停课、补课到另一天、换教室、改时间、多条 Override 同时作用于同一次课
- 冲突：时间重叠、同一天跨楼且间隔过短、连续 4 节无休息
- 提醒：指纹去重（同一提醒触发两次只发一条）、错过补偿、重启后重排一致性

### 10.2 真机提醒测试清单（每台测试机都跑一遍）
1. 息屏 30 分钟后提醒是否准点
2. 强制停止 App 后提醒是否仍然触发
3. 重启手机后提醒是否重建
4. 手动改系统时间后是否重排
5. 切换时区后是否正确
6. 开省电模式 / 后台限制后是否仍准点
7. 同一分钟内多个提醒是否都到达
8. 通知权限被拒绝时的降级表现

### 10.3 手动验收清单（每个里程碑结束时）
空课表引导 · 单双周显示 · 调课后显示"已调课"标记 · 主题切换无闪烁 · 深色模式对比度 · 大字号布局不破 · 横竖屏 · 低端机流畅度

---

## 11. 质量门禁（Definition of Done）

一个任务算完成，必须同时满足：
1. 有自动化测试，且 core 覆盖率不下降；
2. TypeScript strict 编译零错误；
3. 真机（至少一台 Android，最好含一台国产 ROM）实际验证；
4. 主题系统下切换 3 套主题与深浅色不破版；
5. 有对应的文档或注释更新；
6. 无新增广告、追踪或非必要权限。

---

## 12. 发布与分发

- **版本号**：语义化版本 + 构建号；
- **构建**：GitHub Actions 自动出 APK，tag 触发 release；
- **分发**：先自签 APK 直装（朋友间试用），需要时再考虑 Google Play；
- **隐私**：首次启动给一页人话说明 —— 数据只在本机、不联网、无广告、可随时导出删除。

---

## 13. 风险登记表

| 风险 | 触发信号 | 缓解措施 |
| --- | --- | --- |
| 提醒在国产 ROM 上失准 | 测试清单第 1/6 条不通过 | 引导电池白名单 + 前台服务兜底 + 应用内"提醒健康检查" |
| 时间引擎边界漏测 | 用户反馈"我的课显示错了" | 单测覆盖面优先 + 收集真实教务样本做黄金用例 |
| Capacitor 性能不够 | 低端机滑周卡顿 | 首屏只渲染当前周、虚拟化、避免重渲染 |
| 主题系统失控 | 用户 DIY 后界面破版 | Token 白名单 + 取值域校验 + 一键恢复默认主题 |
| 插件安全 | 用户导入的插件读取隐私 | 权限令牌 + 明确授权弹窗 + 先只开放官方审核插件 |
| 范围蔓延 | 里程碑一再延期 | 严格遵守第 2.2 节"不做清单"；AI 与插件在 M0/M1 只留接口 |
| 只做不改（做完就弃） | — | 数据可完整导出为通用 JSON/ICS，随时能迁走到别的工具 |

---

## 14. 下一步：界面原型的交付清单

计划书确认后，我会先做一个**可在手机上点、可切换主题**的高保真原型（React + Vite，先跑浏览器/真机 WebView，不进原生）：

| 页面 | 原型要体现的内容 |
| --- | --- |
| 本周课表页 | 节次轴、周次胶囊条、课程卡渐变、今日列高亮、左右滑周动画、非本周淡化 |
| 今日页 | 下一节课大卡 + 倒计时、时间轴、已过课程灰化 |
| 课程详情 | 信息区、周次一览、单独提醒设置、颜色选择 |
| 添加课程 | 单双周 / 连堂 / 教室 / 教师的完整表单 + 快速添加面板（拍照 / 手动 / 导入 / 分享码） |
| **主题 DIY 面板** | 实时预览：主色、圆角、字体、密度、卡片样式；一键切 6 套内置主题；导出/导入主题 |
| 设置页 | 提醒规则、权限健康检查、数据导出 |

原型的目的只有一个：**先确认审美方向，再动核心逻辑。**

---

## 15. 需要你提供的东西（可后补）

1. 你学校教务系统课表页面的**截图或 HTML**（决定第一个导入适配器长什么样）；
2. 你的**作息时间表**（第几节几点到几点，是否有冬夏令时）；
3. 你希望内置的**主题风格偏好**（例如：极简黑白 / 毛玻璃 / 手账纸质 / 霓虹）；
4. 手机上你打算提醒的**提前量**（例如课前 15 分钟 + 5 分钟）。
