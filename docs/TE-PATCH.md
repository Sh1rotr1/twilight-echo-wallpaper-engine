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
