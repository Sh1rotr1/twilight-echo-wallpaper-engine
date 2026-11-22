# 升级适配手册

3.0.0 起插件**不修改** `resources/app.asar`。Twilight Echo 升级后只做只读检查与真实 UI 回归，
不再需要重跑安装器或打桥。

## 1. 看版本与桥

```powershell
node scripts/check-compat.mjs "D:\TwilightEcho"
```

重点字段：

- `bridgeVersion`：宿主自带 `out/renderer/we-background.js` 的 `BRIDGE_VERSION`
- `bridgeMode`：`native`（5–8）/ `enhanced`（≥9）/ `unsupported` / `missing`
- `carouselAvailable`：是否 ≥ v9
- `indexCsp`、`csp.frame/img/media`：是否放行 3100
- `appearanceAnchor`：`背景与材质` 文案是否仍在
- `issues` / `warnings`

## 2. 2.0.2 已知结论

- 官方 2.0.2 的 `app.asar` 自带 `out/renderer/we-background.js`，`BRIDGE_VERSION = 5`。
- `index.html` 已带 `./we-background.js` 入口，meta CSP 含 `127.0.0.1:3100`。
- 主进程 CSP 经 `NCM_API_ORIGINS` 放行 `connect-src` 3100，`frame/img/media` 经
  `WALLPAPER_ENGINE_ORIGIN` 放行。
- 外观页仍有 `背景与材质` 文案；宿主桥靠它插入“动态壁纸”卡片。
- 2.0.2 不再带 `resources/core-node/runtime/node.exe`，旧版 `bridge-adapt.mjs` / `add-bridge.cmd`
  在 2.0.2 上不可用——3.0.0 已移除这条路径。

## 3. 模式差异

| 能力 | native v5 | enhanced v9+ |
|---|---|---|
| 视频 / 网页 / 场景 | ✅ | ✅ |
| 画质 / 填充 / 暗化 / 位移 / 缩放 | ✅ | ✅ |
| 壁纸属性（实时） | ✅ | ✅ |
| 迷你播放器 / 播放页背景 | ✅ | ✅ |
| 定时轮播 | ❌（插件不启动） | ✅ |
| 切页轮播 | ❌ | ✅ |
| 淡入 / poster | ❌ | ✅ |

原生模式下插件设置面板不显示轮播字段；已保存的 `playlist.ids` 保留，升级回 v9 后恢复。

## 4. 升级后检查步骤

1. 看 `TwilightEcho.exe` / `app.asar` 时间与 `package.json` 版本。
2. 跑 `scripts/check-compat.mjs`，确认 `issues` 为空。
3. 确认 `out/renderer/we-background.js` 存在且版本 ≥ 5。
4. 确认 `out/renderer/index.html` 的入口与 meta CSP。
5. 确认外观页文案 `背景与材质` 与 CSS 钩子：
   `.app-background-layer`、`.settings-overlay-root`、`te-settings-surface`。
6. 启动应用，做真实 UI 验收：
   - 外观页卡片存在；
   - 视频 / 网页 / 场景各一张；
   - 画质、填充、暗化、X/Y/Z、缩放实时；
   - 场景与网页静音；
   - 属性控件出现并能实时生效；
   - 迷你播放器与播放页背景开关；
   - 原生模式无轮播字段；增强模式有轮播且可切页。
7. 更新 `COMPATIBILITY.json` 的 `host.tested` 与 `CHANGELOG.md`。

## 5. 出现问题时

- **卡片不出现**：先确认桥文件与入口/CSP；再看宿主是否把 `背景与材质` 文案改成别的，
  或新增了同名分类导致锚点挂错（宿主桥逻辑，插件无解）。
- **有卡片无画面**：确认 3100 端口未被占用；插件日志应有“媒体服务已启动”。
- **轮播消失**：检查 `bridgeMode` 是否变成 `native`；这是 2.0.2 官方桥的预期行为。
- **不要**为了恢复轮播去改宿主 `app.asar`；3.0.0 不支持这条路径。
