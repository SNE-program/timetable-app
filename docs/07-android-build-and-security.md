# Android 构建与安全说明

> 版本：v0.5.0 · 构建日期见 APK 文件时间

---

## 1. 构建产物

| 项 | 值 |
| --- | --- |
| 文件 | 课表-v0.5.0.apk（工程根目录） |
| 原始路径 | android/app/build/outputs/apk/release/app-release.apk |
| 大小 | 3.67 MB |
| 包名 | app.timetable.mobile |
| 版本 | versionName 0.5.0 / versionCode 1 |
| minSdk / targetSdk | 24（Android 7.0）/ 36 |
| 签名方案 | APK Signature Scheme v2 |
| 证书 DN | CN=Timetable, OU=Personal, O=Personal, L=City, ST=State, C=CN |
| 证书 SHA-256 | A1:C3:6F:C4:61:C7:2A:16:81:DA:8A:D1:FC:ED:D6:ED:26:72:95:2D:2D:5D:74:2E:8B:27:34:99:CE:DD:C2:5A |
| APK SHA-256 | B27C1F493F1EC17931412332D957A5EEF5A08F23D3D9C7FAAF21AE98758A312E |

构建时使用的是 **release 构建 + 正式签名**，不是 debug 包。

---

## 2. 构建环境（一次性准备）

| 组件 | 位置 / 版本 |
| --- | --- |
| JDK | C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot |
| Android SDK | 工程内 .android-sdk（cmdline-tools + platform-tools + platforms;android-35 + build-tools;35.0.0） |
| Gradle | 由 wrapper 自动下载（8.14.3） |
| 路径放行 | android/gradle.properties 里加了 android.overridePathCheck=true |

> 注意：工程路径含中文（课表APP），Android Gradle Plugin 默认会拒绝构建。已显式放行；工程内没有原生代码，这样是安全的。若以后要加 NDK 原生模块，需要把工程挪到纯英文路径。

重新构建：

~~~
npm run sync:android
cd android
.\gradlew.bat assembleRelease
~~~

（需要先设置 ANDROID_HOME 指向 .android-sdk，JAVA_HOME 指向上面的 JDK）

---

## 3. 签名密钥（重要）

| 项 | 位置 |
| --- | --- |
| 密钥库 | android/keystore/timetable-release.jks |
| 密码与别名 | android/keystore.properties |

**这两样必须自己备份好。** 安卓要求「同一个包名的更新包必须用同一把钥匙签名」，密钥丢了以后就**再也无法覆盖安装新版本**，只能卸载重装（数据会没）。

两者都已加入 .gitignore，不会进版本库。

想换成自己的密钥：删掉这两个文件，用 keytool 重新生成同名文件即可。

---

## 4. 权限逐条说明

APK 里一共只声明了 6 个权限，每个都有明确用途：

| 权限 | 用途 | 说明 |
| --- | --- | --- |
| INTERNET | WebView 加载本地页面 | Capacitor 框架要求；应用本身不访问任何服务器 |
| POST_NOTIFICATIONS | 发送上课提醒 | Android 13+ 需要用户授权 |
| SCHEDULE_EXACT_ALARM | 让提醒准点到分钟 | 普通闹钟会被系统延迟，精确闹钟才能保证早八不迟到 |
| RECEIVE_BOOT_COMPLETED | 重启后自动重排提醒 | 否则重启一次所有提醒都没了 |
| VIBRATE | 提醒时震动 | |
| WAKE_LOCK | 息屏时也能弹出提醒 | |

**刻意没有申请**：读取通讯录、读取存储、定位、相机、后台定位、读取已安装应用列表、REQUEST_IGNORE_BATTERY_OPTIMIZATIONS。

---

## 5. 关于「会不会被当成病毒」

### 已经做的加固

1. **用 release 构建 + 正式签名**，不是 debug 包 —— debug 包带 android:debuggable，是安全软件的高频特征
2. **删掉了 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS** —— 这个权限属于「可能有害应用」类别，是误报重灾区。改为在应用内引导用户手动设置电池白名单
3. **不做代码混淆** —— 反直觉但正确：混淆后的代码特征和加壳木马相似，反而更容易被判毒
4. **零第三方 SDK**：没有广告、统计、推送、社交 SDK，没有网络请求
5. **Windows Defender 实测扫描：无威胁**
   ~~~
   Scanning 课表-v0.5.0.apk found no threats.
   ~~~
   全程实时保护开启，构建期间也没有任何告警

### 仍然可能被拦截的原因（实话）

| 原因 | 说明 |
| --- | --- |
| 没有应用商店信誉 | 侧载 APK 没有厂商白名单记录，Play Protect 会提示「未知开发者」 |
| 国产手机管家用自研引擎 | 腾讯/360/小米/华为/OPPO 的引擎对「未知来源 + 精确闹钟 + 开机自启」这个组合比较敏感 —— 而这恰好是**所有正经闹钟类应用**的特征 |
| 权限组合本身像闹钟 | 因为它就是闹钟类应用 |
| 首次见到这个包名 | 没有历史信誉积累 |

这些**不是代码问题**，任何自签名侧载的提醒类应用都会遇到。

---

## 6. 需要你配合的事

### 必须做

1. **备份签名密钥**：把 android/keystore/timetable-release.jks 和 android/keystore.properties 复制到安全的地方（比如网盘或密码管理器）。丢了就再也无法升级覆盖安装。
2. **安装时点「继续安装」**：手机会提示「未知来源」或 Play Protect 的「应用未经扫描」。选择「仍然安装」。
3. **关闭电池优化**：因为我们刻意没有申请那个权限，需要你手动去
   设置 → 应用 → 课表 → 电池 → 选择「无限制 / 允许后台活动」。
   不设置的话，国产 ROM 在息屏后可能延迟或吞掉提醒。
4. **允许通知权限**：首次打开后进「设置 → 提醒通道」，点「申请」把通知权限打开。

### 如果被手机管家报毒

先确认 APK 的 SHA-256 和上面表格里的一致（一致说明文件没被篡改）。然后：

- 在手机管家里把「课表」加入白名单/信任
- 或者提交误报申诉（腾讯手机管家、360、各家都有入口）
- 最稳妥的替代方案：用浏览器打开 127.0.0.1:5273 加入主屏幕当 PWA 用（但没有系统级提醒）

### 我可以帮你做的

告诉我你手机的品牌和报毒提示原文，我可以针对性地调整（比如进一步精简权限、换包名、加隐私说明页）。

---

## 7. 真机测试清单（还没做，需要你跑）

APK 能装能开之后，逐条验证提醒是否可靠：

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 设一个 3 分钟后的提醒，息屏等 | 准点响 |
| 2 | 在系统里「强制停止」应用后等提醒 | 仍然准点响 |
| 3 | 重启手机后等提醒 | 仍然准点响 |
| 4 | 手动改系统时间 | 提醒跟着重排 |
| 5 | 切换时区 | 时间正确 |
| 6 | 打开省电模式 | 仍然准点 |
| 7 | 两个提醒落在同一分钟 | 两条都到 |
| 8 | 拒绝通知权限 | 应用不崩，提示引导授权 |

第 1 条不通过，说明精确闹钟权限没拿到；第 2、3 条不通过，说明系统在杀后台。

---

## 8. 还没验证的部分（诚实说明）

- **APK 没有在真机上安装运行过** —— 本机没有安卓设备，只做到了「构建成功 + 签名验证 + 静态权限检查 + Defender 扫描」
- 提醒的准点率、息屏/杀进程/重启后的表现，全部**未经实测**
- 计划书里承诺的「提醒准点率 ≥ 99%」目前仍然只是设计目标
