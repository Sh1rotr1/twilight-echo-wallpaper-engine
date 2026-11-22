# AGENTS.md — 给后续 AI / 开发者的入口

本文件是此插件的**第一读文件**。先读这里，再读 `docs/ARCHITECTURE.md` 和 `docs/ADAPTING.md`。

## 项目是什么

Twilight Echo（Electron 音乐播放器）的 Wallpaper Engine 动态背景插件。

- 插件侧：扫描本机 WE 壁纸，起本地媒体服务 `127.0.0.1:3100`，提供设置面板。
- 本体侧：**不改**。Twilight Echo 2.0.2 自带 `out/renderer/we-background.js`（v5）和
  `index.html` 入口 / CSP。插件只读检查桥版本，按能力启用功能。
- 场景壁纸：`/scene-live` + WebWallGL 3.x 实时渲染，不用旧 manifest/scene-player 路线。

## 不要改的东西

- 外观页“动态壁纸”设置块的交互逻辑：壁纸选择、画质、填充/暗化、X/Y/Z、缩放、应用/暂停/交互/关闭。
- X/Y/Z / 缩放必须是**实时**的：滑杆走 `POST /api/layout`，不要改成“点应用才生效”。
- 不要重新引入旧的 `scene-manifest` / `scene-resource` / 旧 `scene-player` 作为主路径。
- 不要调用 `wallpaper32.exe` / `wallpaper64.exe`，不要改系统桌面壁纸。
- 不要把壁纸音轨接入播放器；视频和网页都必须静音。
- 壁纸属性（`project.json general.properties`）要保留检测、动态控件、条件显隐、按壁纸存覆盖值；
  覆盖值在插件设置 `userProps` 里，不要改成只存在内存。
- 壁纸属性只对**已应用**的壁纸显示和生效；切换下拉候选不能加载/预览属性，点“应用”后再加载。
- 壁纸属性调整必须实时：桥用 `postMessage({type:'te-prop'})` 直推 iframe，不能只靠轮询或“应用”按钮。
- **不要重新引入宿主补丁 / 自动打桥**。3.0.0 起插件对 `app.asar` 只读；桥能力由
  `lib/host-bridge.mjs` 判断。
- 轮播相关代码只允许在 `hostBridge.mode === 'enhanced'`（桥 ≥ v9）时出现；v5 原生模式不得显示
  轮播字段、不得启动定时器、不得执行“下一张”。
- 切页触发依赖宿主桥采样 `.menu-item[aria-current="page"]` + `data-page-id` 与 `.playing-music`；
  v5 桥没有这段逻辑，插件侧无法补。

## 快速命令

```powershell
# 只读检查当前安装是否兼容
node scripts/check-compat.mjs "D:\TwilightEcho"

# 构建 .tep
npm run build:tep
```

## 关键路径

```text
plugin.json                      插件清单（apiVersion 3）
index.mjs                        宿主侧：扫描、HTTP 服务、设置面板、桥能力判断
lib/host-bridge.mjs              只读读取 app.asar 内的桥版本（不写）
lib/asar-lite.cjs                自带 asar 读取（无 npm 依赖）
lib/webwallgl/                   WebWallGL 适配页 + 引擎
lib/we-props.js                  壁纸属性解析
lib/scene-manifest.js            旧场景解析（兼容保留）
lib/scene-player.js              旧场景播放器（兼容保留）
lib/vendor-jpeg-js/              旧场景 JPEG 解码
COMPATIBILITY.json               机器可读的版本/模式/路由
docs/ARCHITECTURE.md             数据流和状态字段
docs/ADAPTING.md                 宿主升级后的检查步骤
```

## 宿主能力判断（升级时先看这里）

1. `out/renderer/we-background.js` 的 `BRIDGE_VERSION`：
   - `>= 9`：增强模式，轮播字段 + 切页 + 淡入可用；
   - `5..8`：原生模式，只保留壁纸/属性/迷你/播放页；
   - `< 5` 或无文件：不支持，插件不工作，不要尝试修改本体。
2. `out/renderer/index.html` 必须有 `./we-background.js` 入口和 3100 的 meta CSP。
3. 主进程 CSP 的 `frame-src` / `img-src` / `media-src` / `connect-src` 必须放行 3100。
4. 外观页文案 `背景与材质` 仍是桥的插入锚点；若宿主同时存在另一个同名分类，
   卡片可能挂到外观页分类栏（宿主桥逻辑，插件侧无解）。
5. 跑 `scripts/check-compat.mjs`，看 `bridgeMode` / `issues`。
6. 启动应用，按 `docs/ADAPTING.md` 做真实 UI 验收。

## 已知边界

- 场景由 WebWallGL 重写渲染，复杂自定义 shader / 脚本仍可能与 WE 本体有差异。
- 宿主升级会覆盖 `app.asar`，但本插件不需要、也不会重打补丁；桥回退到 v5 时轮播自动消失。
- `scripts/check-compat.mjs` 依赖 `@electron/asar`；在源码工作区运行，不要假设插件安装目录里有它。
- 插件是信任式安装：`main` 运行在 utilityProcess，拥有与本机同级的文件访问能力。
