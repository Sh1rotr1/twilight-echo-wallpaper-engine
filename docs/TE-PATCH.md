# Twilight Echo 本体接入说明

插件本体通过 HTTP 提供壁纸数据：

```text
http://127.0.0.1:3100
```

场景/网页/视频的画面需要应用把 `we-background.js` 注入渲染器，并放行该地址。插件本身不会修改本体；以下修改由应用侧完成。

## 1. 新增渲染桥文件

把本包中的：

```text
patch/we-background.js
```

桥文件里有一行 `var BRIDGE_VERSION = 9`，这是安装器判断“是否需要覆盖”的唯一依据：
宿主内置桥没有该常量（视为 0）或低于 9 时，`bridge/install.mjs` 会覆盖成插件桥。
v9 桥包含：主窗口图层、视频/网页/场景、播放页背景（`.playing-music .backdrop`）、
迷你播放器图层与 720P/30fps 降级，以及轮播卡片与切页触发。宿主若自己维护桥，请同步这些能力，否则不要改版本号。

版本历史：v4 迷你播放器与画质降级；v5 播放页背景；v9 轮播（列表、定时/切页、预览图淡入）。

放到 `resources/app.asar` 内的：

```text
out/renderer/we-background.js
```

文件内包含底层层、视频/iframe、暗化、X/Y/Z、缩放、壁纸属性面板和交互模式。

## 2. 修改 out/renderer/index.html

在 `</head>` 前加入：

```html
<script type="module" src="./we-background.js"></script>
```

同时把本地端口加入 meta CSP 的以下指令：

```text
img-src
media-src
frame-src
connect-src
```

示例：

```text
img-src 'self' data: blob: cover: background: theme-asset: twilight-media: http://127.0.0.1:3100
media-src 'self' blob: twilight-audio: twilight-media: http://127.0.0.1:3100
frame-src 'self' plugin-ui: http://127.0.0.1:3100
connect-src ... http://127.0.0.1:3100
```

## 3. 修改 out/main/index.js 的 CSP 响应头

应用会覆盖 index.html 的 meta CSP，因此主进程里的 `contentSecurityPolicyForUrl`（或等价函数）也必须放行：

```text
http://127.0.0.1:3100
```

需要追加的指令：

```text
frame-src 'self' plugin-ui: http://127.0.0.1:3100
img-src 'self' data: blob: cover: background: theme-asset: twilight-media: http://127.0.0.1:3100
media-src 'self' blob: twilight-audio: twilight-media: http://127.0.0.1:3100
```

`connect-src` 在 1.3.1 已包含 `http://127.0.0.1:3100`；若后续版本移除，也需要补回。

## 4. 为什么需要

- `<iframe src="http://127.0.0.1:3100/...">` 受 `frame-src` 限制
- 视频/音频受 `media-src` 限制
- 封面和贴图受 `img-src` 限制
- 属性面板与状态轮询受 `connect-src` 限制

只改 meta CSP 不够；主进程响应头会覆盖它。

## 5. 插件侧行为

- 插件启动后监听 `127.0.0.1:3100`
- 桥轮询 `/api/state` 并创建 `#te-we-bg`
- 场景使用 `/scene-live` + `/scene-files`
- 网页使用 `/web/<id>/...`
- 属性使用 `/api/props/<id>`
- 视频使用 `/media/<id>`

不需要修改 Vue 设置页；桥会在“设置 → 外观”中查找“背景与材质”并插入“动态壁纸”块。

## 6. 轮播（v9）依赖

- 轮播 UI 由桥注入到“动态壁纸”卡片，调用插件 2.3.0 的 `/api/playlist`、`/api/playlist/action`、`/api/playlist/page`、`/api/playlist/context`；宿主只需放桥，不需要额外接口。
- 切页触发读取站内导航的 `.menu-item[aria-current="page"]`（`data-page-id`）和播放页 `.playing-music`；导航结构若变化，改桥内 `pageSignature()` 即可，插件侧无需改动。
- 窗口隐藏 / 全屏 / 交互模式由桥自行判断并上报，宿主不需要配合。
- 桥与插件版本需匹配：桥 v9 + 插件 2.3.0 才有轮播；旧插件配新桥会多请求 404，不影响原壁纸播放。
