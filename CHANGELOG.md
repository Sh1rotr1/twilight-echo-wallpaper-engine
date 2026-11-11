# Changelog

## 2.4.2 — 2026-11-11

适配 Twilight Echo **2.0.2**，并修原子替换的重试等待。

- 2.0.2 宿主桥仍是 v5，`bridge-adapt.mjs` 照常打回 v9；桥 / 入口 / CSP 三项锚点未变。
- **重试等待不再依赖 `cmd /c timeout`**（无控制台 stdio 下会失败）：改成 `Atomics.wait`
  同步睡眠，rename 被占用时重试 8 次再回退直接复制。
- 备份：`app.asar.te-we-backup-2.0.2` + `app.asar.te-we-backup`（均为 2.0.2 原始包）。
- 实测：`#te-we-bg` 正常挂载；外观页「动态壁纸」块可用；2.0.2 上轮播未改代码。


## 2.4.1 — 2026-11-10

自带**独立自愈**：不再依赖下载插件的适配器来修宿主桥。Twilight Echo 官方安装器每次升级都会整体
覆盖 `resources/app.asar`（宿主桥退回 v5、index.html 入口与 CSP 消失），现在插件自己发现、自己修。

- 新增 `lib/bridge-adapt.mjs`（CLI + 自愈入口）与 `lib/asar-lite.cjs`（自带 asar 读写，
  不依赖 @electron/asar / npm 依赖树）：
  - 只做壁纸需要的三处：`out/renderer/we-background.js`（v9）、`index.html` 入口与 meta CSP、
    `out/main/index.js` 响应头 CSP；不碰下载相关补丁。
  - 备份按版本命名 `app.asar.te-we-backup-<version>`，同时维护旧的 `app.asar.te-we-backup`；
    同版本号重发安装包时会刷新（先比对内容，未打补丁才覆盖）。
  - 写入用「临时文件 + rename」原子替换，宿主读不到半个 asar；回读校验桥版本/入口/CSP。
- `index.mjs` 激活 2.5 秒后只读检查：桥缺失或低于 v9 就用 core-node 的 `node.exe` 拉起
  `bridge-adapt.mjs --wait-exit`，**退出应用后自动重打**，只提示一次。
- 命令：
  `node lib/bridge-adapt.mjs [--app DIR] [--dry-run] [--json] [--revert] [--auto] [--wait-exit]`
- 2.4.0 的 `bridge/install.mjs` 保留（首次安装 + 装插件用），新逻辑对它是补充而不是替代。


## 2.4.0 — 2026-11-05

适配 Twilight Echo **2.0.0**。

- 清单：`version` → `2.4.0`，`engines.twilightEcho` → `>=2.0.0`；`apiVersion` 保持 3（2.0.0 仍兼容），
  权限不变。
- **宿主桥版本差**：2.0.0 内置的 `out/renderer/we-background.js` 是 v5（来自 2.2.0，含播放页背景与
  迷你播放器），**没有 v9 的轮播**。安装器现在把 v9 写回宿主，轮播卡片才出现；外观设置块、CSP、
  CSS 钩子在 2.0.0 上原样可用，无需额外补丁。
- `scripts/check-compat.mjs` 的 `requiredBridgeVersion` 改为读取 `patch/we-background.js` 的
  `BRIDGE_VERSION`（不再硬编码 5），2.0.0 + 宿主 v5 会明确报「渲染桥 v5 < v9」。
- `COMPATIBILITY.json` 增加 2.0.0 记录；首次在 2.0.0 上运行安装器会生成
  `resources/app.asar.te-we-backup`（当前 2.0.0 原包，供回滚）。
- 2.0.0 实测：`#te-we-bg` 正常挂载；导航仍为 `.menu-item[aria-current="page"]` + `data-page-id`，
  切页轮播的 `pageSignature()` 无需改动；外观页「背景与材质」锚点仍在。
- 补齐桥的 `GET /api/bridge-boot` beacon 与 `POST /api/bridge-diag` 诊断上报端点（只在
  `video.error / dataError` 时写日志），控制台不再出现这两个 404。
- 升级后仍需重跑 `node bridge/install.mjs "D:\TwilightEcho"`（宿主更新会覆盖 `app.asar`）。

## 2.3.0 — 2026-11-05

- 新增壁纸轮播
  - 在外观 → 动态壁纸卡片勾选列表，二选一：按时间自动换，或切换页面时换
  - 顺序循环 / 随机；至少 2 张才启用；`暂停时停表` 默认开启
  - 切换时用目标壁纸的预览图垫底，再淡入真实画面（`fadeMs`，默认 420ms）
  - 切页方式带 60 秒冷却（可调），只认内容页变化，设置页与弹窗不计
  - 窗口隐藏 / 全屏 / 交互模式时不参与切页触发
  - 新增 `/api/playlist`、`/api/playlist/action`、`/api/playlist/page`、`/api/playlist/context`
  - 桥版本 9；插件设置面板新增轮播开关、方式、间隔与「下一张」
- 包含 2.2.0 的播放页背景、迷你播放器背景与画质降级（该版本未单独发布）

## 2.2.0 — 2026-11-03

- 新增「播放页背景」并做成可开关（`playbackBg`，默认开启）
  - 播放页自身的 `.backdrop`（模糊封面 / 暗角 / 色调 / 流体层）不再盖住壁纸
  - 只保留一层 28% 暗角保证歌词可读，关闭开关后完全恢复宿主原本的播放页背景
  - 规则只作用于 `.playing-music .backdrop`，不再回写 `--te-app-bg` 等全局 token（避免连带打透明对话框）
- 迷你播放器背景恢复并做成可开关（`miniCover`，默认开启）
  - 适配 1.4 的 `.mini-player-root` 结构，图层挂进根节点并保留圆角裁剪
  - 只隐藏 `.mini-window-fill` / `.mini-background-source` / `.mini-grain`；保留 55% 的 `.mini-background-overlay`，保证小窗文字可读
- 迷你窗口画质降级：`MINI` 下视频最高 720P，场景 `sceneFps=30`，避免主窗口 + 迷你窗口同时按原画解码
- 渲染桥加 `BRIDGE_VERSION = 4`；安装器改为按版本号判断是否需要覆盖，不再用特性嗅探
- 外观页设置块新增「播放页」开关；插件设置面板新增「迷你播放器使用壁纸背景」「播放页使用壁纸背景」两项
- `check-compat` 输出 `bridgeVersion` / `requiredBridgeVersion`，低于 v4 时给出明确提示

## 2.1.3 — 2026-11-02

- 在 Twilight Echo `1.4.0-preview2` 上复测通过，不新增功能。
- `COMPATIBILITY.json` 记录 preview2，安装器与内置渲染桥行为不变。
- 发布流程改为推送 `v*` 标签即自动构建并发布 `.tep`。

## 2.1.2

- 适配 Twilight Echo `1.4.0-perview`
  - 1.4 已内置 `we-background.js` 与本地媒体 CSP
  - 安装器保留宿主桥并合并插件功能，自动创建缺失的 `app.asar` 备份
  - `check-compat` 支持 1.4 模板字符串 CSP、检测桥功能是否完整
- 本次不新增功能；迷你播放器背景、场景渲染、壁纸属性继续保留
- 歌词反相仍为实验性功能

## 2.1.1

- 修复部分场景类壁纸在特定窗口宽高比例下渲染异常的问题
  - 场景按固定比例渲染，再由窗口裁切
  - 拉宽或压缩主窗口、迷你播放器时，人物和前景图层不再消失或错位

## 1.0.2

- 修复部分场景类壁纸在特定窗口宽高比例下渲染异常的问题
  - 场景按固定比例渲染，再由窗口裁切
  - 拉宽或压缩主窗口、迷你播放器时，人物和前景图层不再消失或错位

## 1.0.1

- 修复动态壁纸覆盖桌面歌词背景的问题
  - 渲染桥只在主窗口和 `?window=mini-player` 中运行
  - `desktop-lyrics`、`dynamic-island`、`tray-player` 窗口直接跳过
- 迷你播放器支持动态壁纸：
  - 检测 `?window=mini-player`
  - 背景层插入 `.mini-player-root`，自动继承圆角和 `overflow: hidden`
  - 隐藏迷你播放器自带的纯色/封面/渐变背景
  - 迷你窗口最高 720P、场景 30fps，并禁用网页交互
- 外观页增加“使用当前壁纸覆盖迷你播放器背景”开关
  - 默认开启
  - 关闭后迷你播放器恢复自己的主题背景
  - 开关状态写入插件设置 `miniCover`
  - 迷你窗口轮询 `/api/state` 后立即恢复/移除背景层

## 1.0.0

- Web 壁纸兼容 Spine / WebGL 画布与项目根相对路径：
  - `/web/assets/...` 等由页面 `../assets/...` 解析出的路径映射回当前 web 项目根
  - 适配 `[碧蓝档案 | Blue Archive]对策委员会BD特典 All in One 可交互 画质增强` 这类 Web 壁纸
- 壁纸属性（参考 dsh-plugin-wallpaper-engine 的「壁纸属性」）：
  - 使用 `lib/we-props.js` 解析 `project.json` 的 `general.properties`
  - 支持 bool / color / slider / combo / file / directory / text/group 分组
  - `condition` 只控制面板显隐；order 浮点排序；combo 保留声明类型
  - 只对已应用壁纸加载；切换下拉候选不加载
  - 修改单个属性时 `postMessage({type:'te-prop'})` 立即生效，80ms 防抖写 `userProps`
  - 覆盖值按壁纸存在插件设置；提供“恢复默认”
- 场景切换为 WebWallGL 3.x 实时渲染：
  - `/scene-live` 适配页
  - `/scene-files` 提供 `project.json` / `scene.pkg`
  - 引擎：`webwallgl.global.min.js`
- 外观页新增独立“动态壁纸”设置块：
  - 壁纸、画质、填充/暗化
  - X / Y / Z、缩放（实时）
  - 应用 / 暂停 / 交互 / 关闭
- 视频、网页壁纸静音；网页可进入交互模式
- 壁纸按真实路径去重
- 安装器按 CSP 指令名追加 `127.0.0.1:3100`，适配 Twilight Echo 1.3.1 的 `frame-src 'self' plugin-ui:`
- 升级后用当前版本原包刷新 `app.asar.te-we-backup`

## 1.3.1 宿主适配

- `app.asar` 结构仍为 `out/main` + `out/renderer`
- `SettingsPage` 仍包含 `背景与材质` 锚点
- CSS 钩子仍为 `.app-background-layer` / `.settings-overlay-root` / `te-settings-surface`
- 重新打桥后外观设置块、场景 WebWallGL、视频、网页均可用
