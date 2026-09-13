# 云备份（可选功能）

这个目录是**服务端**那一半：建表脚本与两个 Edge Function。
客户端那一半在 `src/cloud/`（无依赖的 Supabase 客户端 + 备份内容的组装与校验）。

## 它是可选的，而且是关着的

没有配置 Supabase 的构建里：

- 设置页不会出现「云备份」这块面板；
- 应用里**没有任何一处会发起网络请求** —— 这一条有测试守着
  （`src/cloud/client.test.ts` 里"没配置时一个请求都不发"）；
- 其余功能与以前完全一样（本地优先、离线可用）。

配置之后也只有**用户主动点按钮**才联网：注册 / 登录 / 忘记密码 / 立即备份 / 从云端恢复 /
把课表发到邮箱 / 删除云端数据。打开应用、切页面、改课表都不会上传任何东西。

---

## 现状（2026-09-12 已部署）

| 项 | 状态 |
| --- | --- |
| 建表 | 已执行，两张表 RLS 已开 |
| Edge Function | `send-mail` / `delete-account` 已部署（ACTIVE、verify_jwt=true）|
| Functions Secrets | `RESEND_API_KEY`、`MAIL_FROM` 已设置 |
| Auth SMTP | `smtp.resend.com:465`（用户 `resend`），发件人 `课表助手 <noreply@wzmssf.club>` |
| Site URL / 回调 | `https://timble.bond/` + 本地 5273 |
| 发件域名 | **`timble.bond`**（已验证并启用）|
| 邮件限额 | `rate_limit_email_sent` = **30/小时**（默认只有 2/小时，一小时内第三个同学就注册不了）|
| 邮件模板 | 已改成中文（确认邮箱 / 重置密码），署名「课表助手」|
| 邮件链接回跳 | 客户端会认 fragment 里的令牌并自动登录，见 `src/cloud/link.ts`；`type=recovery` 会打开「设置新密码」|

重新部署（改了函数源码之后）：

```bash
$env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
npx supabase functions deploy send-mail --project-ref oglzpevmqpcmryznqaiu --use-api
npx supabase functions deploy delete-account --project-ref oglzpevmqpcmryznqaiu --use-api
```

> 用 Management API 直接 POST `/v1/projects/{ref}/functions` 会 500（它要的是 CLI 打包后的 ESZIP），
> 所以走 CLI；`--use-api` 表示不用 Docker。

## 一次性部署（四步，首次照着做）

### 1. 建表

Supabase 控制台 → **SQL Editor** → 把 `supabase/schema.sql` 整段粘进去 → Run。

脚本是幂等的，重复跑不会报错。它会建两张表（`timetables` 一人一行、`mail_log` 发信记账）、
开行级安全（RLS）、给 `timetables` 建四条"只能碰自己那一行"的策略，
并且**不给 `mail_log` 建任何策略**（只有服务端能写）。

跑完最后那段自检查询应当返回两行，且"已开启RLS"都是 true。

### 2. 打开邮箱登录

控制台 → **Authentication → Providers → Email**：Enable 打开。

- **Confirm email 开着**（推荐）：注册后要去邮箱点确认链接才能登录。客户端已经处理了这条路径，
  会明确提示"去收件箱点一下"。
- 关掉的话注册即登录，适合自己先用起来，但任何人可以拿别人的邮箱注册。

**Authentication → URL Configuration**：

| 项 | 填什么 |
| --- | --- |
| Site URL | `https://timble.bond/` |
| Redirect URLs | 同上（再加本地调试地址 `http://localhost:5273/`）|

这一项必须填，否则"忘记密码"邮件里的链接跳不回应用。

### 3. 用 Resend 发邮件

Supabase 自带的 SMTP 每小时只允许几封，只够自己试。要发给同学，用 Resend 当它的自定义 SMTP：

**Authentication → Emails → SMTP Settings**：

| 字段 | 值 |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | 你的 Resend API key（`re_...`）|
| Sender email | `noreply@你的域名` |
| Sender name | `课表助手` |

> ⚠️ **必须先有一个能改 DNS 的域名**，并在 Resend 里把它验证通过（加 SPF / DKIM 记录）。
> `sne-program.github.io` 这类地址**不是域名**，Resend 不会批准；
> 没验证过域名时它只能把邮件发到"注册 Resend 用的那个邮箱"，同学收不到。
> 没有域名的替代方案：先关掉 Confirm email 用起来，等有域名了再打开。

### 4. 部署两个 Edge Function

装了 Supabase CLI 之后：

```bash
supabase link --project-ref oglzpevmqpcmryznqaiu
supabase functions deploy delete-account
supabase functions deploy send-mail
supabase secrets set RESEND_API_KEY=re_xxxxxxxx MAIL_FROM="课表助手 <noreply@你的域名>"
```

| 函数 | 干什么 | 为什么必须服务端 |
| --- | --- | --- |
| `delete-account` | 注销账号：删云端备份 + 删 auth 用户 | 删用户要 service_role，那把钥匙能绕过所有 RLS |
| `send-mail` | 把课表发到**调用者自己的**邮箱（Resend） | Resend key 只能放服务端；收件人只从 token 里取，绝不读请求体 |

Secret 只需要两个：`RESEND_API_KEY` 与 `MAIL_FROM`。
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 自动注入，不用手配。

> 这两个函数用的是 Deno，**不在主项目的 `tsc` 范围里**（`tsconfig.json` 的 include 只有 `src`），
> 所以本地的 `npx tsc --noEmit` 不会去检查它们；它们由 Supabase 在部署时编译。

---

## 前端怎么拿到配置

客户端需要两项：项目 URL 与 **anon key**。anon key 生来就是公开的
（每个 Supabase 前端应用都把它打进包里），数据安全靠的是 RLS，不是这把钥匙。
但 `service_role` key **绝不能**出现在前端 —— 有一条测试专门扫 `src/` 防止它被误加。

**线上（GitHub Actions）**：仓库 Settings → Secrets and variables → **Variables** 里加两项，
工作流会把它们传成构建变量：

| 变量名 | 值 |
| --- | --- |
| `SUPABASE_URL` | `https://oglzpevmqpcmryznqaiu.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...`（anon public）|

**本地**：

```powershell
$env:VITE_SUPABASE_URL = 'https://xxxx.supabase.co'
$env:VITE_SUPABASE_ANON_KEY = 'eyJ...'
npm run build
```

两项都为空时，构建出来的就是"完全离线"的版本（面板不出现）。

---

## 安全清单（改这里的代码时照着过一遍）

- [ ] 新建的表都 `enable row level security`，且策略只允许 `auth.uid() = user_id`；
- [ ] 客户端读不到、写不了 `mail_log`（`revoke` + 无策略）；
- [ ] 没有任何 key 写死在源码里（`src/cloud/schema.test.ts` 会扫）；
- [ ] Edge Function 不读请求体里的收件人 / 用户 id，身份一律来自 token；
- [ ] 发信有频率限制（现在是每小时 5 封、每天 20 封）；
- [ ] 备份有体积上限（客户端先算字节，数据库再兜一道 1 MB）。

## 常见问题

**注册后登录报"邮箱还没确认"** —— 去收件箱点确认链接；没收到就看垃圾邮件，
或到 Authentication → Users 里手动确认。

**忘记密码的邮件点开是空白页** —— 检查 Site URL / Redirect URLs 是否填了线上地址。

**Resend 报 domain is not verified** —— 发信域名还没验证通过，见第 3 步。

**备份失败说"服务器不收"** —— 备份超过 1 MB。客户端已经会自动退成"只备份课表与设置"，
如果连这也超了，说明课表本身异常大（几千条调课记录），先导出 JSON 检查一下。

**想彻底关掉云备份** —— 把仓库变量 `SUPABASE_URL` 清空重新构建即可；
面板会消失，应用回到完全离线的状态。数据库里的数据要自己到控制台删。
