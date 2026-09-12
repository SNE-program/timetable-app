# 主题包规范（含图片）

> 对应实现：`src/theme/themeFile.ts` · `src/theme/tokens.ts` · `src/theme/wallpaper.ts` · `src/theme/image.ts`
> 版本：format `timetable-theme` / version `1`

---

## 1. 为什么要有这个格式

用户提出的两条硬需求：

1. **界面布局可以在恰当的地方放图片，不一定是纯色。**
2. **布局配置可以导入导出，把图片一起带走，别人拿到文件直接导入就能用。**

所以主题不能只是一组颜色，"图片"必须是一等公民，而且必须是**自包含**的 —— 导出后不依赖任何外部文件或网络。

---

## 2. 图片可以出现在哪些位置

| 位置 | 字段 | 说明 |
| --- | --- | --- |
| 应用背景（壁纸） | `theme.wallpaper` | 全局背景，可调模糊度与压暗程度 |
| 课程卡片 | `Course.image` | 每门课单独配图，卡片上叠压暗层保证文字可读 |
| 今日「下一节课」大卡 | `Course.image` | 复用该课程的配图，做成沉浸式头图 |
| 桌面小组件 | 沿用 `theme.wallpaper` | 正式版落地 |
| 空状态插图 | 预留 | 主题包可携带 |

**内置 7 张程序化壁纸**：极光 / 霓虹 / 纸纹 / 网格纸 / 樱花 / 深海 / 水墨。
全部由 SVG 在运行时现场生成（渐变 + 高斯模糊色块 + `feTurbulence` 噪点），因此**不依赖任何网络资源**，离线可用、体积极小、可无限调参。

---

## 3. 图片处理管线

用户上传的图片不会原样存储：

1. 解码 → 2. 等比缩放到长边 ≤ 1920px（课程图 1200px）→ 3. 画到 canvas → 4. 导出 WebP（质量 0.82，浏览器不支持则回退 JPEG/PNG）→ 5. base64 存入主题

| 约束 | 值 | 原因 |
| --- | --- | --- |
| 壁纸长边上限 | 1920 px | 手机全屏足够，体积可控 |
| 课程图长边上限 | 1200 px | 卡片尺寸远小于此 |
| 压缩质量 | 0.82 | 肉眼无损与体积的平衡点 |
| 格式 | WebP 优先 | 同画质下比 JPEG 小约 30% |

压缩后一张壁纸通常在 80–250 KB，可以安全地放进浏览器本地存储，也方便发微信。

---

## 4. 文件格式

扩展名：`.timetheme.json`（是纯 JSON，双击能看、能改、能版本管理）

~~~json
{
  "format": "timetable-theme",
  "version": 1,
  "exportedAt": "2025-11-20T10:00:00.000Z",
  "meta": { "id": "glass", "name": "毛玻璃", "author": "内置", "description": "半透明面板叠在极光上", "createdAt": "" },
  "assets": [
    {
      "name": "自定义壁纸",
      "field": "wallpaper.custom",
      "mime": "image/webp",
      "bytes": 184320,
      "bytesText": "180.0 KB"
    }
  ],
  "theme": {
    "meta": { "id": "glass", "name": "毛玻璃", "author": "内置", "description": "", "createdAt": "" },
    "modePref": "light",
    "accent": "#3D6BFF",
    "lightBg": "#EDF1FA",
    "darkBg": "#0D1017",
    "cardStyle": "glass",
    "cardOpacity": 0.72,
    "courseSaturation": 1,
    "radius": 20,
    "font": "system",
    "fontScale": 1,
    "density": "comfortable",
    "showTeacher": true,
    "showWeekend": true,
    "panelAlpha": 0.72,
    "glassBlur": 22,
    "wallpaper": {
      "kind": "custom",
      "presetId": "aurora",
      "custom": "data:image/webp;base64,UklGR....",
      "blur": 0,
      "scrim": 0.12
    },
    "courseColors": []
  }
}
~~~

### 字段说明

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `modePref` | light / dark / auto | auto 跟随系统 |
| `accent` | hex | 主色，**12 色课程色板由它推导** |
| `lightBg` / `darkBg` | hex | 两种模式各自的底色 |
| `cardStyle` | solid / gradient / glass / outline | 课程卡质感 |
| `cardOpacity` | 0.3 – 1 | 卡片不透明度 |
| `courseSaturation` | 0 – 1.4 | 课程色饱和度倍率（0 即黑白课表） |
| `radius` / `fontScale` | 数值 | 圆角、字号缩放 |
| `font` | system / serif / mono / rounded | 字体族 |
| `density` | compact / comfortable / cozy | 行高与间距 |
| `panelAlpha` / `glassBlur` | 0.3–1 / 0–40 | 面板通透度与毛玻璃强度 |
| `wallpaper.kind` | none / preset / custom | 无 / 内置 / 用户图片 |
| `wallpaper.custom` | data URI | **图片本体，随文件走** |
| `wallpaper.blur` / `scrim` | 0–30 / 0–0.95 | 背景模糊、压暗（或提亮）程度 |
| `courseColors` | 12 个 hex 或 空数组 | 空数组 = 按主色自动生成 |

### 关于 assets 字段
`assets` 只是一份**清单**（告诉人这个包里带了哪些图、多大），**图片本体存在 `theme.wallpaper.custom` 里**，避免同一张图存两份。这样文件结构简单，图片也永远跟着配置走。

---

## 5. 导入流程与容错

导入时**不信任任何输入**，逐字段校验并归一化：

| 情况 | 处理 |
| --- | --- |
| 不是合法 JSON | 报错「文件不是合法的 JSON，可能不是主题包」 |
| `format` 不匹配 | 报错「文件格式不是课表主题包」 |
| 版本高于当前应用 | 警告但继续导入，忽略不认识的字段（向前兼容） |
| 颜色不是合法 hex | 回退默认值并给出提示 |
| 数值越界 | 夹紧到允许区间 |
| 枚举值不合法 | 回退默认值 |
| `kind = custom` 但图片数据缺失 | 警告并回退为「无壁纸」，不会白屏 |
| `courseColors` 不足 12 色 | 警告并改为按主色自动生成 |
| 没有 `format` 字段（裸 theme 对象） | 宽容接受，当作旧格式导入 |

导入成功后自动跳转到「外观」页并弹出提示，附带提示条数。

---

## 6. 安全边界

- **主题是数据，不是代码**：没有 JS，没有任意 CSS 注入，最多是受限的取值域参数。
- 图片只走 data URI，**不加载远程 URL** —— 避免导入别人的主题后被动联网、泄露 IP。
- 所有数值都有上下界，防止出现 4000px 圆角之类把界面搞坏的组合。
- 一键「恢复默认外观」永远可用。

---

## 7. 三种导入方式（都要好用）

1. 「外观」页的 **导入主题包** 按钮；
2. **把文件直接拖到屏幕任意位置**，松手即导入；
3. 未来：把主题包塞进**分享码**（压缩 + base64url 短码），扫码即用。

拖拽时会全屏提示「松手即可应用 · 图片设为壁纸，主题包直接导入」，并根据文件类型自动判断意图。

---

## 8. 与正式版的衔接

原型已按此规范完整实现（导出、导入、校验、内置壁纸、图片压缩）。
正式版迁移到 Capacitor + SQLite 时：

- 主题 JSON 结构**不变**，直接复用；
- 图片从 localStorage 迁到 SQLite 的 BLOB 或应用私有目录文件；
- 增加 ZIP 容器（`.tpack`，store 模式）作为可选格式，方便解压替换图片后再打包；
- 主题包签名与来源标记，用于社区主题的信任分级。
