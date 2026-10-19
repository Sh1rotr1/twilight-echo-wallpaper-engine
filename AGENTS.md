# AGENTS.md — 给后续 AI / 开发者的入口

本文件是此插件的**第一读文件**。先读这里，再读 `docs/ARCHITECTURE.md` 和 `docs/ADAPTING.md`。

## 项目是什么

Twilight Echo（Electron 音乐播放器）的 Wallpaper Engine 动态背景插件。

- 插件侧：扫描本机 WE 壁纸，起本地媒体服务，提供外观页设置块。
- 本体侧：只替换一个 `resources/app.asar`，注入 `out/renderer/we-background.js`，把页面固定在最底层。
- 场景壁纸：`/scene-live` + WebWallGL 3.x 实时渲染，不用旧 manifest/scene-player 路线。

## 不要改的东西

- 外观页“动态壁纸”设置块的交互逻辑：壁纸选择、画质、填充/暗化、X/Y/Z、缩放、应用/暂停/交互/关闭。
- X/Y/Z / 缩放必须是**实时**的：滑杆走 `POST /api/layout`，不要改成“点应用才生效”。
- 不要重新引入旧的 `scene-manifest` / `scene-resource` / 旧 `scene-player` 作为主路径。
- 不要调用 `wallpaper32.exe` / `wallpaper64.exe`，不要改系统桌面壁纸。
- 不要把壁纸音轨接入播放器；视频和网页都必须静音。
- 壁纸属性（`project.json general.properties`，WE 用户属性）要保留检测、动态控件、条件显隐、按壁纸存覆盖值；覆盖值在插件设置 `userProps` 里，不要改成只存在内存。
- 壁纸属性只对**已应用**的壁纸显示和生效；切换下拉候选不能加载/预览属性，点“应用”后再加载。
- 壁纸属性调整必须实时：桥用 `postMessage({type:'te-prop'})` 直推 iframe，不能只靠轮询或“应用”按钮。

## 快速命令

```powershell
# 只检查当前安装是否兼容（只读）
node scripts/check-compat.mjs "D:\TwilightEcho"

# 打桥 + 安装插件（需先完全退出 Twilight Echo）
node bridge/install.mjs "D:\TwilightEcho"

# 还原本体
Copy-Item "D:\TwilightEcho\resources\app.asar.te-we-backup" "D:\TwilightEcho\resources\app.asar" -Force
```

## 关键路径

```text
plugin.json                      插件清单（apiVersion 3）
index.mjs                        宿主侧：扫描、HTTP 服务、设置面板
lib/webwallgl/                   WebWallGL 适配页 + 引擎
lib/we-props.js                 壁纸属性解析（DSH 同款）
lib/scene-manifest.js           旧场景解析（兼容保留）
lib/scene-player.js             旧场景播放器（兼容保留）
lib/vendor-jpeg-js/             旧场景 JPEG 解码
bridge/we-background.js          注入到 app.asar 的渲染桥
bridge/install.mjs               单文件本体补丁 + 插件安装
COMPATIBILITY.json               机器可读的版本/补丁点/路由
docs/ARCHITECTURE.md             数据流和状态字段
docs/ADAPTING.md                 Twilight Echo 升级后的适配步骤
```

## 本体补丁点（升级时最可能变的地方）

1. `out/renderer/index.html`
   - 注入 `<script type="module" src="./we-background.js"></script>`
   - meta CSP 放行 `http://127.0.0.1:3100`
2. `out/main/index.js`
   - 响应头 CSP 的 `frame-src` / `img-src` / `media-src`
   - 安装器按**指令名**匹配，不写死旧字符串；新版本 `frame-src 'self' plugin-ui:` 已适配
3. `out/renderer/we-background.js`
   - 新文件；不属于原包
4. 备份
   - `resources/app.asar.te-we-backup` 必须是**当前版本原包**；升级后安装器会刷新

## 升级适配清单

1. 看 `TwilightEcho.exe` / `app.asar` 时间与 `package.json` 版本。
2. 跑 `scripts/check-compat.mjs`，看 `issues`。
3. 解包检查 `out/renderer/index.html` 与 `out/main/index.js` 的 CSP、入口资源名。
4. 检查外观页文案 `背景与材质` 是否还在；`we-background.js` 靠它插入设置块。
5. 检查 `out/renderer/assets/*.css` 是否仍有 `.app-background-layer`、`.settings-overlay-root`、`te-settings-surface`。
6. 跑 `bridge/install.mjs`，启动应用。
7. 验证：外观设置块、视频、网页、场景（WebWallGL）、X/Y/Z 实时、缩放、静音。
8. 更新 `COMPATIBILITY.json` 的 `host.tested` 与 `CHANGELOG.md`。

## 已知边界

- 场景由 WebWallGL 重写渲染，复杂自定义 shader / 脚本仍可能与 WE 本体有差异。
- 本体更新会覆盖 `app.asar`，每次更新后都要重跑安装器。
- `scripts/check-compat.mjs` 依赖 `@electron/asar`；在源码工作区运行，不要假设已安装插件目录里有它。
- 插件是信任式安装：`main` 运行在 utilityProcess，拥有与本机同级的文件访问能力。
