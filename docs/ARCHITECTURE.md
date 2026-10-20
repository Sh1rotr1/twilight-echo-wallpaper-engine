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
  └─ 设置面板 / 外观设置块的数据源
        │
        ▼
渲染桥（app.asar → out/renderer/we-background.js）
  ├─ #te-we-bg 固定最底层（z-index 0）
  ├─ #app 提升到 z-index 1
  ├─ video / iframe / img
  ├─ CSS 3D：translate3d(X%,Y%,Zpx) scale(zoom)
  └─ 每 2s 轮询 /api/state
        │
        ├─ 视频：<video> 原文件 / Range
        ├─ 网页：<iframe> /web/<id>/...
        └─ 场景：<iframe> /scene-live/... → WebWallGL 3.x
```

## 2. 模块

| 路径 | 职责 |
|---|---|
| `plugin.json` | 清单、权限、apiVersion |
| `index.mjs` | 扫描、路由、状态、设置面板 |
| `lib/webwallgl/index.html` | WebWallGL 适配页 |
| `lib/webwallgl/renderer.js` | URL 参数 → `createScene` |
| `lib/webwallgl/engine/webwallgl.global.min.js` | WebWallGL 3.x 引擎 |
| `lib/webwallgl/default-wallpaper/` | 适配页失败兜底 |
| `lib/we-props.js` | 壁纸属性解析（DSH 同款） |
| `lib/scene-manifest.js` | 旧场景解析（兼容保留） |
| `lib/scene-player.js` | 旧场景播放器（兼容保留） |
| `lib/vendor-jpeg-js/` | 旧场景 JPEG 解码 |
| `bridge/we-background.js` | 注入渲染桥（本体唯一新增文件） |
| `bridge/install.mjs` | 解包 → 注入 → 重打包 → 安装插件 |
| `themes/*.css` | 旧主题样式；当前不作为主路径 |

## 3. HTTP 路由（127.0.0.1:3100）

| 路由 | 说明 |
|---|---|
| `GET /api/state` | 当前壁纸、rev、fit、scrim、quality、X/Y/Z、zoom、paused、interactive、scene |
| `GET /api/wallpapers` | 壁纸列表（最多 500），含当前 selected / state |
| `POST /api/apply` | `{id, fit, scrim, quality, offsetX, offsetY, offsetZ, zoom}` |
| `POST /api/layout` | 只更新 X/Y/Z/zoom，实时滑杆用 |
| `GET /api/props/<id>` | 壁纸属性定义（project.json `general.properties`）+ 用户覆盖值 |
| `POST /api/props` | 写入单个属性覆盖值 |
| `POST /api/props/reset` | 清除该壁纸全部覆盖值 |
| `POST /api/control` | `pause` / `resume` / `stop` / `interact` |
| `GET /media/<id>` | 视频原文件，Range |
| `GET /preview/<id>` | 预览图 |
| `GET /web/<id>/*` | 网页壁纸文件，HTML 注入静音脚本与属性桥 |
| `GET /web/*` | 无 id 的网页根路径别名（兼容 `../assets` 等写法） |
| `GET /scene-files/<id>/*` | `project.json` / `scene.pkg` / 松散场景文件 |
| `GET /scene-live/*` | WebWallGL 适配页与引擎 |
| `GET /scene-video/<id>` | 旧场景内嵌 MP4 缓存（兼容保留） |
| `GET /diag` | 适配页诊断信标，204 |
| `GET /wallpaper-engine/scene-*` | 旧 manifest/runtime（兼容保留，不是主路径） |

## 4. 状态字段

持久化在插件 settings 的 `state`：

```text
selected      当前壁纸 id
rev           状态版本，bridge 用它判断是否需要重建
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
sceneVideo    旧场景视频缓存
sceneRuntime  旧 manifest 运行时（兼容保留）
userProps     每张壁纸的属性覆盖值 { [壁纸ID]: { [属性名]: 值 } }
```

## 5. 渲染桥

### 图层

```text
#te-we-bg   position: fixed; inset: 0; z-index: 0
#app        position: relative; z-index: 1
```

### 媒体

- `video`：`muted`、`loop`、`autoplay`、`playsinline`
- `iframe`：网页 / 场景；场景 `scene: true` 时不加 sandbox
- `img`：预览图兜底

### 变换

```css
translate3d(X%, Y%, Zpx) scale(zoom)
```

`#te-we-bg` 有 `perspective: 1200px`，仅改变合成，不重建 iframe。

### 设置块

`bridge/we-background.js` 在 `设置 → 外观` 里寻找 `背景与材质` 文案，插入“动态壁纸”块。升级后如果该文案变化，设置块不会出现，需要更新锚点。

## 6. 本体补丁

安装器只改一个文件：`resources/app.asar`。

内部补丁：

1. 新增 `out/renderer/we-background.js`
2. `out/renderer/index.html`
   - 加 `<script type="module" src="./we-background.js">`
   - meta CSP 加 `http://127.0.0.1:3100`
3. `out/main/index.js`
   - 响应头 CSP 的 `frame-src` / `img-src` / `media-src` 加 3100
   - 按指令名匹配，不写死版本字符串
4. 备份 `app.asar.te-we-backup`（当前版本原包）

## 7. 场景渲染

```text
/scene-live/index.html?type=scene
  &src=<壁纸ID>
  &mediaBase=/scene-files
  &fit=cover
  &sceneFps=30|60
  &muted=true
  &renderDpr=1
```

适配页：

- 加载 `engine/webwallgl.global.min.js`
- `createScene(host, { fit, fps, volume:0, renderDpr, onDiagnostic })`
- `inst.load(httpSource('/scene-files/<id>'))`
- 引擎自己读 `project.json` / `scene.pkg`
- 失败时挂 `default-wallpaper/`

## 8. 安装后的运行位置

```text
%APPDATA%\TwilightEcho\plugins\com.twilightecho.tool.wallpaper-engine\<version>\
```

插件私有数据：

```text
%APPDATA%\TwilightEcho\plugin-data\com.twilightecho.tool.wallpaper-engine\
  settings.json      含每张壁纸的属性覆盖值 userProps
  cache\
```

## 10. 迷你播放器

迷你播放器是独立窗口：

```text
index.html?window=mini-player
```

桥检测该 query 后：

- 把 `#te-we-bg` 插入 `.mini-player-root`，使用 `position:absolute`，继承圆角和 `overflow:hidden`
- 只在图层可见后隐藏 `.mini-window-fill` / `.mini-background-source` / `.mini-background-overlay` / `.mini-grain`
- 迷你窗口保持 `.mini-player-surface` 和所有控件
- 禁用网页交互模式
- 画质最高 720P，场景 30fps
- 主题/布局重建 `.mini-player-root` 时，MutationObserver 会把图层重新挂回

## 11. 壁纸属性（WE 用户属性）

- 来源：`project.json` 的 `general.properties`
- 解析：`lib/we-props.js`（order 浮点、combo 保留类型、localization、`editable:false`、file/directory 候选）
- 面板：布尔 / 颜色 / 滑杆 / 下拉 / 文件 / 文本；`group`/`text` 作分组标题；`condition` 只控制面板显隐
- 只对**已应用**壁纸加载；切换下拉候选不加载
- 改动即时 `postMessage({type:'te-prop', name, value})` 给 iframe，并 80ms 防抖写 `POST /api/props`
- 覆盖值存插件设置 `userProps`（按壁纸 ID），只存与默认值不同的项；`恢复默认` 清空该壁纸覆盖
- 场景加载完成后从 `/api/props/<id>` 回放覆盖值；网页壁纸由注入的属性桥接收 `te-prop` 并调用 `applyUserProperties`
- 视频壁纸不展示属性面板

## 9. 设计约束

- 不调用 WE 可执行文件，不改系统桌面壁纸
- 壁纸音轨不进入播放器；视频/网页静音
- 场景主路径是 WebWallGL；旧 manifest/player 只保留兼容
- 本体只替换 `app.asar`，不改 EXE/DLL/用户配置
- 外观交互逻辑（X/Y/Z、缩放、画质、应用）保持实时
