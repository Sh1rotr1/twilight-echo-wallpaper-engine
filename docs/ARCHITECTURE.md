# 架构说明

## 1. 总览

```text
Wallpaper Engine 项目
  ├─ project.json
  ├─ scene.pkg / scene.json
  ├─ *.mp4 / *.webm
  └─ web 项目文件
        │
        ▼
插件宿主（index.mjs，utilityProcess）
  ├─ 扫描库 / 去重
  ├─ 本地 HTTP 服务 127.0.0.1:3100
  ├─ 状态持久化（plugin settings）
  ├─ 只读读取宿主桥版本（lib/host-bridge.mjs）
  └─ 设置面板 / 外观设置块的数据源
        │
        ▼
宿主渲染桥（Twilight Echo 官方 app.asar）
  ├─ #te-we-bg 固定最底层
  ├─ 视频 / iframe / img
  ├─ CSS 3D：translate3d(X%,Y%,Zpx) scale(zoom)
  └─ 每 2s 轮询 /api/state
        │
        ├─ 视频：<video> 原文件 / Range
        ├─ 网页：<iframe> /web/<id>/...
        └─ 场景：<iframe> /scene-live/... → WebWallGL 3.x
```

插件**不写宿主**。`lib/host-bridge.mjs` 只读 `resources/app.asar` 的
`out/renderer/we-background.js`，确认 `BRIDGE_VERSION >= 5`，不做任何修改。

## 2. 模块

| 路径 | 职责 |
|---|---|
| `plugin.json` | 清单、权限、apiVersion |
| `index.mjs` | 扫描、路由、状态、设置面板 |
| `lib/host-bridge.mjs` | 只读读取宿主桥版本（不写、不备份） |
| `lib/asar-lite.cjs` | 自带 asar 读取（无 npm 依赖） |
| `lib/webwallgl/index.html` | WebWallGL 适配页 |
| `lib/webwallgl/renderer.js` | URL 参数 → `createScene` |
| `lib/webwallgl/engine/webwallgl.global.min.js` | WebWallGL 3.x 引擎 |
| `lib/webwallgl/default-wallpaper/` | 适配页失败兜底 |
| `lib/we-props.js` | 壁纸属性解析（DSH 同款） |
| `lib/scene-manifest.js` | 旧场景解析（兼容保留） |
| `lib/scene-player.js` | 旧场景播放器（兼容保留） |
| `lib/vendor-jpeg-js/` | 旧场景 JPEG 解码 |

## 3. HTTP 路由（127.0.0.1:3100）

| 路由 | 说明 |
|---|---|
| `GET /api/state` | 当前壁纸、rev、fit、scrim、quality、X/Y/Z、zoom、paused、interactive、scene |
| `GET /api/wallpapers` | 壁纸列表（最多 500），含当前 selected / state |
| `POST /api/apply` | `{id, fit, scrim, quality, offsetX, offsetY, offsetZ, zoom}` |
| `POST /api/layout` | 只更新 X/Y/Z/zoom，实时滑杆用 |
| `GET /api/props/<id>` | 壁纸属性定义 + 用户覆盖值 |
| `POST /api/props` | 写入单个属性覆盖值 |
| `POST /api/props/reset` | 清除该壁纸全部覆盖值 |
| `POST /api/control` | `pause` / `resume` / `stop` / `interact` / `mini-cover` / `playback-bg` |
| `GET /media/<id>` | 视频原文件，Range |
| `GET /preview/<id>` | 预览图 |
| `GET /web/<id>/*` | 网页壁纸文件，HTML 注入静音脚本与属性桥 |
| `GET /web/*` | 无 id 的网页根路径别名 |
| `GET /scene-files/<id>/*` | `project.json` / `scene.pkg` / 松散场景文件 |
| `GET /scene-live/*` | WebWallGL 适配页与引擎 |
| `GET /diag` | 适配页诊断信标，204 |
| `GET /api/bridge-boot` | 宿主桥启动 beacon，204 |
| `POST /api/bridge-diag` | 宿主桥诊断上报；只在错误时写日志 |
| `GET /api/bridge-error` | 宿主桥轮询失败上报 |

## 4. 状态字段

持久化在插件 settings 的 `state`：

```text
selected      当前壁纸 id
rev           状态版本，桥用它判断是否需要重建
q             列表筛选词
extraDir      额外壁纸目录（; 分隔）
autoApply     启动恢复
lastProject   上次 project.json
lastTitle     上次标题
scrim         暗化 0/20/35/50
fit           cover / contain / fill
quality       original / 1080 / 720
paused        暂停
interactive   网页交互模式
offsetX/Y/Z   -100..100 / -100..100 / -1000..1000
zoom          50..200（百分比）
userProps     每张壁纸的属性覆盖值 { [壁纸ID]: { [属性名]: 值 } }
miniCover     迷你播放器是否使用壁纸背景（默认 true）
playbackBg    播放页是否使用壁纸背景（默认 true）
```

## 5. 渲染桥

### 图层

```text
#te-we-bg   position: fixed; inset: 0; z-index: 0
#app        position: relative; z-index: 1
```

### 媒体

- `video`：`muted`、`loop`、`autoplay`、`playsinline`
- `web`：iframe，`sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"`，自动静音
- `scene`：iframe → `/scene-live/`，WebWallGL 读取 `scene.pkg`

### 布局

- X/Y/Z、缩放由桥的 `applyLayout()` 写 CSS transform；`/api/layout` 120ms 去抖。
- 画质只影响视频栅格/场景 FPS，不改源文件。

### 壁纸属性

- 宿主桥读 `/api/props/<id>` 生成控件，写入 `/api/props`。
- 网页壁纸的 iframe 内注入 `te-prop` / `te-props` / `te-props-reset` 消息桥。

## 6. 数据兼容

- 升级插件不会清空壁纸选择、额外目录与 `userProps`。
- 宿主桥低于 v5 或缺失时插件只报状态，不修改宿主。
