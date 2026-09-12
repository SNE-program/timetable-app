# 通知发不出去：排查记录与修复

> 问题：装到手机上之后，上课提醒完全不出现，点「发一条测试通知」也没反应。

---

## 根因：通知渠道从来没被创建过

**这是主要原因，而且是确凿的。**

Android 8.0（API 26）起，每条通知都必须归属一个「通知渠道」（NotificationChannel）。
**往一个不存在的渠道发通知，系统会静默丢弃 —— 不报错、不崩溃、不提示，什么都没有。**

看 Capacitor 插件源码 `LocalNotificationManager.kt:153`：

~~~kotlin
val channelId = localNotification.channelId ?: soundChannelId(localNotification) ?: DEFAULT_NOTIFICATION_CHANNEL_ID
val mBuilder = NotificationCompat.Builder(context, channelId)
~~~

它只认三种渠道来源：
1. 通知自带 `channelId` —— **优先级最高，直接采用**
2. 通知带了自定义 `sound` 时插件临时建的渠道
3. 兜底的 `"default"` 渠道（插件启动时自动创建）

而我们的代码**每一条通知都显式传了 `channelId: 'class-reminder'`**：

~~~ts
notifications: [{ id, title, body, channelId: 'class-reminder', ... }]
~~~

这个 `class-reminder` **从来没有被创建过**（插件的 `createChannel()` 只在 JS 显式调用时才建）。
于是走进分支 1 → 用一个不存在的渠道构造通知 → Android 直接丢弃。

倒霉的是兜底逻辑：**正因为我们传了 channelId，反而连插件自带的 default 渠道都用不上。**
不传 channelId 的话本来是可以正常弹出来的。

### 修复

在排程之前先把渠道建好（`ensureChannels()`，幂等，已存在就更新配置）：

| 渠道 id | 名称 | 重要度 | 用途 |
| --- | --- | --- | --- |
| class-reminder | 上课提醒 | 5（高，响铃+震动） | 每节课前 |
| ddl | 作业与截止 | 4 | 作业 / DDL |
| daily-brief | 明日课表 | 3 | 每晚摘要 |

不同类型走不同渠道，用户还能在系统设置里分别静音。

---

## 次要问题（一并修了）

### 2. 通知小图标资源不存在

`capacitor.config.ts` 和排程代码里写的 `smallIcon: 'ic_stat_icon_config_sample'` 是 Capcitor 官方示例里的名字，
**我们的工程里根本没有这个 drawable**（res 下只有启动图标和 splash）。

插件有兜底（找不到就用 `android.R.drawable.ic_dialog_info`），所以**不会导致通知发不出**，
但通知栏左侧会显示一个系统自带的通用感叹号图标，很丑。

修复：新增 `android/app/src/main/res/drawable/ic_stat_timetable.xml`（白色剪影日历图标），
并把 `smallIcon` 指向它。已验证编译进包：`resource 0x7f070062 drawable/ic_stat_timetable`。

### 3. 精确闹钟授权完全没处理

Android 12+（API 31）起，`SCHEDULE_EXACT_ALARM` 需要用户在系统设置里单独授权，否则
`setExactAndAllowWhileIdle` 会失效，系统把闹钟推迟到它觉得合适的时候 —— **可能延后几十分钟**。

我们声明了权限但从来没引导用户去授权，也没检查过状态。

修复：接入插件的 `checkExactNotificationSetting()` / `changeExactNotificationSetting()`，
在设置页显示状态并提供一键跳转。

### 4. 权限申请不是自动的

`POST_NOTIFICATIONS` 必须用户点「申请」才会请求。之前藏在设置页里，很容易被忽略。

修复：首页增加醒目的橙色横幅「上课提醒还没开启 → 去开启」。

### 5. 失败原因被吞掉

原来的实现用 try/catch 把错误吃掉，出问题完全看不到线索。

修复：`NotifierStatus` 增加 `lastError`，设置页显示「最近一次失败」。

---

## 修复后的诊断面板

「设置 → 提醒通道」现在会逐项显示真实状态：

| 项目 | 说明 |
| --- | --- |
| 通知权限 | 已允许 / 未申请 / 被拒绝 |
| 精确闹钟 | 已授权 / 未授权（会明确写出「可能延后几十分钟」） |
| 已排入通知系统 | 未来 7 天的排程条数 |
| 关闭 App 后仍能提醒 | Android 上是「是」 |
| 通知渠道 | 已创建的渠道 id 列表 |
| 最近一次失败 | 原始错误信息 |
| 发一条测试通知 | 走真实渠道，失败会显示原因 |

---

## 你安装后要做的三步

1. 打开 App → 首页橙色横幅点「去开启」→ 允许通知
2. 设置 → 提醒通道 → 「精确闹钟」那一行点「授权」→ 在系统页面允许「闹钟和提醒」
3. 回到设置页点「发一条测试通知」，确认通知栏出现「测试提醒」

三步都过了之后，再看「已排入通知系统」的条数是不是大于 0 —— 是的话排程就成功了。

如果「最近一次失败」有内容，把那行字发我，我能直接定位。

---

## 版本

| 版本 | 说明 |
| --- | --- |
| v0.5.0 | 有渠道 bug，通知发不出，**不要用** |
| v0.5.1 | 修复渠道、图标、精确闹钟、诊断面板 |

---

# 追加：两个后续问题

## A. 通知权限一直显示「正在检测…」

### 原因

界面上那行字是 `n ? PERM_TEXT[n.permission] : '正在检测…'` —— 显示「正在检测」说明 **`s.notify` 一直是 null**，
也就是负责探测状态的 `syncReminders()` **从来没有成功返回过**。

看原来的代码：

~~~ts
syncReminders(data, prefs).then(function (r) {
  if (alive) setNotify(r.status, r.upcoming);
}).catch(function () { /* 排程失败不影响主流程 */ });   // ← 错误被完全吞掉
~~~

`syncReminders` 里任何一步抛出异常（动态加载插件失败、系统调用被拒、数据字段缺失……），
都会被这个空 catch 吃掉，`setNotify` 永远不执行，界面就永远停在「正在检测」——
**而且看不到任何错误信息，完全无法排查。**

### 修复

1. **`syncReminders` 拆成内外两层**，外层整体 try/catch，**无论如何都返回一个可展示的状态对象**，把原始错误放进 `lastError`
2. **补发提醒的循环也加了 try/catch**（原来这里是裸露的 `await`，是当时最可能的抛出点）
3. **App 里的兜底 catch 不再吞错**，而是写入一个带 `lastError` 的错误状态
4. 设置页会直接显示 **「最近一次失败」** 那一行

现在最坏情况是显示一条红色错误，而不是永远转圈。

---

## B. 不开着 App 也要能提醒，还要做什么？

### 首先：这个能力本身是有的

Android 版用的是 **AlarmManager**（Capacitor 插件的 `schedule: { at, allowWhileIdle: true }`），
和浏览器版完全不同 —— **浏览器版关掉标签页就没了，Android 版关掉 App、息屏都会照常触发。**

而且插件自带开机恢复接收器，已验证打进包里：

~~~
com.capacitorjs.plugins.localnotifications.LocalNotificationRestoreReceiver
  ← BOOT_COMPLETED / LOCKED_BOOT_COMPLETED / QUICKBOOT_POWERON
~~~

### 但要真正可靠，还差三道系统设置

系统的省电策略会主动拦截后台闹钟。**三道都得过**：

| # | 设置项 | 不过会怎样 | 怎么过 |
| --- | --- | --- | --- |
| 1 | **通知权限** | 完全没有通知 | 应用内一键申请 |
| 2 | **精确闹钟** | 系统把闹钟推迟到"合适的时候"，可能晚几十分钟 | 应用内一键跳转系统页面 |
| 3 | **电池优化白名单** | 系统冻结后台，闹钟不触发 | **v0.5.2 新增一键跳转** |
| 4 | **自启动 / 后台运行** | 清理后台或重启后，闹钟全部消失 | **v0.5.2 新增一键跳转**（国产 ROM 特有） |

### v0.5.2 为此新增了一个原生插件

写了 `ReliabilityPlugin.java`，提供：

| 方法 | 作用 |
| --- | --- |
| `check()` | 通过 `PowerManager.isIgnoringBatteryOptimizations()` 真实检测是否已放行，并返回厂商名 |
| `openBatterySettings()` | 跳转电池优化白名单列表 |
| `openAutoStartSettings()` | 按厂商跳转自启动管理页 |
| `openAppDetails()` | 兜底跳应用详情页 |

自启动页覆盖：**小米/红米、华为/荣耀、OPPO/一加/realme、vivo/iQOO、魅族、三星、联想、乐视**，
逐个尝试内置的组件名，都不支持就退回应用详情页。

设置页新增「后台提醒可靠性」面板，逐项显示状态 + 「去设置」按钮 + 「重新检测」。

### 你的操作顺序

1. 打开 App → 首页橙色横幅 → **允许通知**
2. 设置 → 提醒通道 → **精确闹钟 → 授权** → 系统页允许「闹钟和提醒」
3. 设置 → 后台提醒可靠性 → **电池优化白名单 → 去设置** → 找到「课表」→ 选「不限制 / 允许」
4. 设置 → 后台提醒可靠性 → **自启动 / 后台运行 → 去设置** → 允许自启动（国产 ROM 才有这一页）
5. 回到设置页点 **「重新检测」**，确认电池那一项变成绿色的「已放行」
6. 点 **「发一条测试通知」** 确认能收到

### 关于电池白名单权限的取舍

应用**没有**申请 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 权限。
这个权限可以直接弹窗让用户一键授权，体验更好，但它属于「可能有害应用」类别，
是安全软件的高频误报点（上一版就是为了防误报才删掉的）。

所以现在的做法是：**不申请权限，但把用户送到系统设置页手动开**。
多两步操作，换取不被报毒。

如果你更在意省事、不在意可能的误报，可以告诉我，我把权限加回去。

### 还有一层：极端省电模式下仍然可能被拦

即使四项都设置好，某些 ROM 在「超级省电」「极限省电」模式下仍会拦截一切后台闹钟。
这是系统级行为，**任何第三方应用都无法绕过**。这种模式下唯一的办法是把应用加入该模式的例外名单。

### 如果还是不响，怎么排查

设置页「提醒通道 → 最近一次失败」会显示原始错误。把那一行发我即可定位。
另外可以看「已排入通知系统」的条数：
- **是 0** → 排程没成功（看失败原因）
- **大于 0 但收不到** → 排程成功了，是系统在拦截 → 回去做第 3、4 步
