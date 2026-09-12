# 竞品调研：大学课表 App 现状、痛点与机会

> 调研时间：2025 年。方式：网络检索公开资料（App Store / 应用市场页面、开源仓库、社区讨论、媒体报道）。
> 说明：本机网络出口受限，部分页面正文无法抓取，结论以可检索到的标题、摘要与公开信息为主，信源见文末。

---

## 一、国内市场

| 产品 | 形态 | 亮点 | 短板 / 用户吐槽 |
| --- | --- | --- | --- |
| **超级课程表（早八必备）** | iOS/Android，课表 + 校园社交 | 用户量最大；教务导入覆盖广；"蹭课"社交起家 | 广告与推广位多、功能臃肿；社区有"吃相难看"的讨论（LINUX DO） |
| **WakeUp 课程表** | 课表工具，主打极简 | 曾被公认"简洁无广告的清爽王者"；支持多种导入、桌面小组件、日历订阅 | 被作业帮收购后**开始出现开屏广告**，媒体报道与社区教程开始教用户回退版本 / 去广告 / 换开源替代 |
| **课程格子** | 课表 + 校园社交（计划 FM 团队） | 早期爆款，社交属性强 | 定位漂移后边缘化 —— 说明纯社交留不住人，**提醒与效率才是刚需** |
| **拾光课程表**（开源，Android） | 开源、无广告、极简 | 支持教务导入，社区口碑好 | 生态小；无主题系统；无 AI |
| **Nexio / 易课表 / SleepDown / 轻课表 / 不揪 / 极简课程表** | 轻量课表 | 极简、桌面小组件、Watch 端、课表分享 | 功能单一，多为个人或小团队产品 |
| **Class Widgets**（开源，Windows） | 桌面常驻课表组件 | 桌面悬浮、**提供插件 API**（有插件开发文档） | 仅桌面端，不覆盖移动场景 |
| **高校微信小程序**（where-to-learn、云小智、口袋矿大等） | 免安装校园服务 | 课表识别、空闲教室查询 | 强依赖各校后端与教务系统，无法通用 |

### 关键信号
1. **WakeUp 的变质是本领域最重要的一课**：一个工具类 App 的核心资产是"干净、可控"，一旦塞广告，用户立刻迁移，且迁移教程会自发传播。
2. **超级课程表的护城河是导入覆盖率 + 社交，而不是体验**：它的差评集中在广告和臃肿。
3. **开源极简路线可以活**（拾光课程表），但都在"功能单一"上止步，**没人做主题系统，没人做插件生态**。

---

## 二、海外市场

| 产品 | 亮点 | 启示 |
| --- | --- | --- |
| **iStudiez Pro** | 老牌学生计划器：课表 + 作业 + 成绩一体，被称"传奇" | 但界面陈旧、迭代慢，说明**长期维护比一时功能更重要** |
| **ClassUp / Class Timetable / Weeklie / Smart Timetable / My Class Schedule** | 精致的小组件与提醒，普遍订阅制 | 小组件是海外课表 App 的核心战场 |
| **すごい時間割（日本）** | 出勤率管理 + 精细视觉 | **本地化细节**（出勤、迟到、公休）能构成差异化 |
| **MIT sipb/hydrant** | 学期选课规划，与选课数据打通 | "选课阶段"是被忽视的场景 |

### 开源 / 学生项目
- **ClassSync**（React Native + React + Rust）：学生端 + 管理端 + 后端全栈。
- **susunjadwal**：SSO 认证 + 课表爬取，面向单一学校。
- **SchedU**（Flutter）：**明确支持 JSON 与 AI 导入课程** —— 证明"AI 导入"已被独立开发者验证。
- 普遍问题：绑定单一学校、无插件机制、无主题体系。

### AI 方向的现状
- **CourseSync-AI**：LLM 解析教学大纲 + 工作量分析 + 智能排课。
- **UCLA BruinBot、UBC IntelliAgents、Duke OIT**：AI 学术助手 / 选课规划问答。
- 国内也有演示：用视觉模型把高校课表截图转成课程提醒与学习计划。
- **结论：AI 目前集中在"导入识别"和"选课规划"两头，面向个人日常的 AI 课表助手仍是空白。**

---

## 三、教务导入的真实生态

教务系统千校千面（正方、强智、URP、自研），社区因此长出庞大的**油猴脚本导出 ICS** 生态：WMU 正方教务导出、厦门大学课程表 ICS 导出助手、BISTU 教务导出、SUAT 导出为 ICS、Wemust Chrome 插件……

**结论：导入功能不能靠"内置一千所学校的爬虫"**（维护地狱 + 合规风险 + 一改版就全挂）。正确做法是 **ICS / Excel / 截图 / 分享码 + 可插拔的 Importer 插件**，让用户与社区自带适配器。

---

## 四、痛点聚类（7 条）

1. **广告与信任透支**：曾经的清爽工具被收购后加开屏广告，用户对"免费工具"高度警惕。
2. **导入碎片化且学期性重复劳动**：每学期都要重新和教务系统搏斗。
3. **课表模型被粗暴简化**：单双周、连堂、调课/停课/补课、多校区多作息（冬夏令时）、临时换教室 —— 大多数 App 处理粗糙，一遇到真实教务数据就出错。
4. **提醒不够聪明也不可定制**：通常只有全局"提前 X 分钟"，没有按课程定制、没有课前一天的"明日课表"摘要、没有错过补偿。
5. **UI 完全同质化**：**没有任何主流产品允许用户 DIY 界面** —— 而这正是本项目用户明确提出的诉求。
6. **生态封闭**：除 Class Widgets 外，几乎没有课表 App 提供插件能力，用户无法自己扩展。
7. **AI 停在门外**：只在"识别导入"层面做实验，没有真正融入日常使用。

---

## 五、机会点：我们要占的三个位

### 机会 1 · DIY 主题引擎（直接回应用户诉求）
Design Token + 主题包（JSON，可导入导出、可社区分享）+ 卡片布局模板 + 实时预览 DIY 面板。
**竞品空白度：几乎 100%。**

### 机会 2 · 插件化架构
五类扩展点：Importer（数据源）/ Widget（展示）/ Channel（通知渠道）/ Theme（主题）/ AIProvider（模型），配权限清单与宿主 API。
**参照 Class Widgets 已验证的插件路线，但做到全平台。**

### 机会 3 · 分层落地的 AI（不喧宾夺主）
AI 是插件层而非核心：截图导入 → 自然语言录入 → 日程问答 → 学习计划 → 选课冲突建议 → 受控工具调用的 Agent。
**关键差异化：AI 的输出必须经过 Schema 校验 + diff 预览 + 用户确认，永不直接写库。**

### 附加立场
本地优先、无广告、数据可完整导出、可选自建同步 —— 直接对冲"被收购即变质"的用户焦虑。

---

## 信源

- 超级课程表 App Store 页面与用户评论：https://apps.apple.com/cn/app/id573868981
- 超级课程表社区讨论（广告与体验）：https://linux.do/t/topic/1850956
- WakeUp 课程表：https://baike.baidu.com/item/WakeUp%E8%AF%BE%E7%A8%8B%E8%A1%A8/67878555
- WakeUp 开屏广告与替代路线报道：https://post.smzdm.com/p/a825leo7/
- WakeUp 被收购后加广告：https://post.smzdm.com/p/apqx2ndw/
- 课程格子：https://baike.baidu.com/item/%E8%AF%BE%E7%A8%8B%E6%A0%BC%E5%AD%90
- 拾光课程表（开源，教务导入）：https://github.com/XingHeYuZhuan/shiguangschedule
- 拾光课程表介绍：https://zhuanlan.zhihu.com/p/2074015414057752521
- Class Widgets（开源桌面课表 + 插件 API）：https://github.com/Class-Widgets/Class-Widgets
- Class Widgets 插件文档：https://deepwiki.com/Class-Widgets/Class-Widgets
- SchedU（Flutter，支持 AI 导入课程）：https://github.com/gnahz77/SchedU
- ClassSync（React Native + Rust）：https://github.com/Priyansh6747/ClassSync
- susunjadwal（SSO + 课表爬取）：https://gitcode.com/gh_mirrors/su/susunjadwal-backend
- CourseSync-AI（LLM 解析大纲 / 排课）：https://github.com/AsmSafone/CourseSync-AI
- MIT hydrant（选课规划）：https://github.com/sipb/hydrant
- UCLA BruinBot：https://www.dts.ucla.edu/newsroom/smarter-course-planning-with-bruinbot
- UBC IntelliAgents：https://eml.ubc.ca/projects/intelliagents/
- Duke OIT：https://oit.duke.edu/story/let-ai-help-organize-your-schedule/
- 厦大课表导出 ICS 脚本：https://greasyfork.org/en/scripts/522668
- 正方教务导出课表脚本：https://greasyfork.org/ckb/scripts/552731
- 校园服务小程序（课表同步 / 空闲教室）：https://github.com/yuer-you/where-to-learn-WeChatAPP
- iStudiez Pro 回顾：https://www.coursesync.biz/post/the-istudiez-pro-legacy-what-made-it-a-legendary-planner-for-students
