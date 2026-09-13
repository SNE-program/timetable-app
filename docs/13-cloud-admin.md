# 云端数据一览与「管理台」（v1.9.8 起）

这篇回答两个问题：**应用到底把什么存在网上**、**怎么方便地把它全看一遍**。

---

## 一、网上存了什么（实测，2026-09-13）

全部数据都在**项目自己的 Supabase 项目**里（`oglzpevmqpcmryznqaiu`），
没有任何第三方统计、广告或崩溃上报 SDK —— 这一点在说明书「隐私」一章里对用户是承诺。

### 1. 数据库（`public` 架构，4 张表）

| 表 | 列 | 存什么 | 当前行数 |
| --- | --- | --- | --- |
| `profiles` | `user_id`, `unlimited_mascots`, `created_at` | 每个账号一行；只用来标"云端角色额度不设限" | 2 |
| `timetables` | `user_id`, `payload`(jsonb), `app_version`, `device`, `created_at`, `updated_at` | **课表备份**：整份课表 + 外观 + 偏好的 JSON。一人一份（`user_id` 是主键） | 1（142 kB） |
| `mascots` | `id`, `user_id`, `name`, `is_public`, `path`, `size_bytes`, `created_at`, `updated_at`, `share_code` | **云端角色的元信息**：名字、是否公开、分享码、在存储里的路径与体积 | 2 |
| `mail_log` | `id`, `user_id`, `subject`, `sent_at` | 发信记录（每日摘要邮件用），只记主题与时间，**不记正文** | 0 |

另外 `auth.users` 里有**账号本身**（邮箱、注册时间、最后登录、会话刷新令牌等），
那是 Supabase Auth 自己管的表，应用代码不直接读它。

### 2. 对象存储（2 个桶）

| 桶 | 可见性 | 放什么 | 现在 |
| --- | --- | --- | --- |
| `app` | **公开**（任何人可下） | 安装包：`timetable-app.apk`（应用内更新与下载页都指向它）+ 每个版本的存档 | 13 个对象 / 120 MB |
| `mascots` | **私有** | 云端角色包（JSON，内含素材）。路径第一段是 `user_id`，读取由策略判定：本人，或"这个对象正在被分享" | 4 个对象 / 21 MB |

### 3. 函数与策略

5 个函数里有 4 个是 `SECURITY DEFINER`：`resolve_mascot_share`（凭码换一条记录）、
`mascot_is_shared`（这个对象是否正被分享）、`mascot_quota_check`（配额触发器）、
`profiles_autocreate`（注册时建资料行）。策略共 15 条（`public` 9 + `storage` 6），
**每一张表都开着 RLS**，且没有任何"任何人都能读全部"的策略。

### 4. 现在这一刻的实况

```
注册账号 2 · 不限额账号 1
云端备份 1 份（142 kB）· 云端角色 2 个（1 个公开、2 个分享中）
mascots 桶 4 个文件 / 21 MB  ← 其中 2 个是**孤儿**（见下）
app     桶 13 个文件 / 120 MB（免费额度 1 GB）
```

**已经发现的问题**：`mascots` 桶里有 2 个文件（5.7 MB + 4.6 MB）在 `mascots` 表里**没有对应记录** ——
多半是"上传成功、写元信息失败"留下的，或者角色从列表里删掉时对象没删干净。它们占着配额、
但应用里任何地方都看不到。管理台的 `overview` / `issues` 会直接把这种文件列出来。

---

## 二、三种查看方式（各有各的用处）

### 1. 应用内（用户视角）

云备份面板显示：备份时间、体积、设备、`describeBackup` 摘要（几门课 / 几个时段 / 几张图）；
角色面板显示：每个角色的名字、体积、分享码、是否公开。**看不到别人**，这是对的。

### 2. Supabase 控制台（手机也能用）

`https://supabase.com/dashboard/project/oglzpevmqpcmryznqaiu` —— 左侧：

- **Table Editor**：直接翻 `profiles` / `timetables` / `mascots`（`payload` 是 jsonb，可以在里面展开看）；
- **Authentication → Users**：账号列表、发确认邮件、改密码、看最后登录；
- **Storage**：两个桶的文件浏览（能预览/下载/删除）；
- **SQL Editor**：想怎么查就怎么查；
- **Reports / Usage**：带宽、存储、请求量的曲线。

控制台是**权威**（它就是数据库本身），但每次要翻五六层，而且它只给原始行、
不告诉你"哪些文件是孤儿""哪个账号占了最多空间"。所以有了下面这个。

### 3. 本机管理台 `scripts/admin.mjs`（推荐日常用）

```bash
node scripts/admin.mjs overview     # 一屏概览 + 待处理项（孤儿文件、记录与文件不一致）
node scripts/admin.mjs users        # 账号（邮箱默认打码；--full 看全）
node scripts/admin.mjs backups      # 云端备份清单（体积 / 应用版本 / 设备 / 更新时间）
node scripts/admin.mjs mascots      # 云端角色（名称 / 归属 / 公开 / 分享码 / 声明体积 vs 实际文件）
node scripts/admin.mjs shares       # 正在分享的分享码
node scripts/admin.mjs storage      # 两个桶的占用 + 安装包清单
node scripts/admin.mjs activity     # 最近发生的事（备份 / 角色变动 / 发信）时间线
node scripts/admin.mjs issues       # 只看待处理项
node scripts/admin.mjs sql "select …"   # 任意只读 SQL（写操作必须显式 --write）
node scripts/admin.mjs web          # 本机只读仪表盘：http://127.0.0.1:8787
```

输出支持 `--json`（喂给别的脚本）与 `--csv`（丢进表格）。

**为什么不做成网站上的 `/admin` 页面**：那需要把 `service_role` 或者"能读所有人数据"的权限
放进浏览器 —— 服务端密钥一进前端就等于公开，管理页本身又天然是攻击面。
本机脚本用**项目级 Personal Access Token**（`sbp_…`）走管理 API，密钥只在你电脑上：

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # 或者让它自己读仓库根的 权限合集.txt（已在 .gitignore）
```

### 安全设计（三条硬约束）

1. **默认只读**：`sql` 命令只放行 `select / with / show / explain`，写语句必须显式加 `--write`；
2. **邮箱默认打码**（`32********@qq.com`）—— 终端里的内容经常被截图发出去，`--full` 才显示完整；
3. **密钥永不打印**，也不进产物：应用代码里只有 `anon` 公钥，`service_role` 从来没有进过前端
   （`src/cloud/schema.test.ts` 里有一条断言守着这件事）。

---

## 三、日常该看什么（建议的巡检清单）

| 频率 | 看什么 | 命令 |
| --- | --- | --- |
| 每次发版后 | 安装包是否就位、旧包要不要清 | `storage` |
| 每周 | 有没有孤儿文件、记录与文件是否一致 | `issues` |
| 有新用户时 | 谁注册了、有没有备份成功 | `users` / `activity` |
| 想给某人开额度时 | 确认账号 id | `users --full`（然后在控制台改 `profiles.unlimited_mascots`） |
| 排查"下载失败" | 记录在、文件不在 | `issues` |

**清理孤儿文件的正确姿势**：先用 `issues` 看到路径，确认它不是正在使用的角色，再删：

```bash
node scripts/admin.mjs sql "select name from storage.objects where bucket_id='mascots' and name='<路径>'"
# 确认无误后（这一步会真的删，且没有回收站）：
node scripts/admin.mjs sql "delete from storage.objects where bucket_id='mascots' and name='<路径>'" --write
```

> 说明：通过 SQL 删 `storage.objects` 行会让对象从存储里消失，但**不会**同时清理底层的物理文件；
> 更稳妥的做法是在控制台 **Storage → mascots** 里勾选文件点删除（它走的是官方接口）。
> 管理台只负责"找到它"，删除动作交给控制台。

---

## 四、边界（这个工具不做什么）

- **不写业务数据**：不会替你改课表、改角色、改账号 —— 那些应该走应用或控制台；
- **不绕过 RLS 去"修"数据**：它是只读观察窗，唯一的写入口是显式 `--write` 的 `sql`；
- **不常驻**：`web` 只绑 `127.0.0.1`，页面里没有密钥，关掉终端就没了。