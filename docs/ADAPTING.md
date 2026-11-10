# 升级适配手册

Twilight Echo 升级后，`resources/app.asar` 会被官方新包覆盖。1.3.x 需要重跑安装器；1.4.x 已内置渲染桥时，安装器会保留宿主桥，只更新插件并补齐备份。

## 0.1 2.0.0 变化（2026-11-05）

- 2.0.0 内置的 `out/renderer/we-background.js` 是 **v5**（来自 2.2.0）：有播放页背景、迷你播放器、
  画质降级，但**没有 v9 的轮播**（`/api/playlist*` 的 UI 与切页触发）。
- 安装器按 `BRIDGE_VERSION` 覆盖：v5 < v9 → 写回插件桥。2.0.0 的 `index.html` 已带
  `./we-background.js` 入口、meta CSP 已含 `127.0.0.1:3100`，主进程 CSP 也已含
  `WALLPAPER_ENGINE_ORIGIN`，所以只剩「替换桥文件 + 重建 asar」。
- 2.0.0 首次运行会生成 `resources/app.asar.te-we-backup`（当前原包）；升级应用后这个备份会过期，
  安装器只在备份缺失时创建，需要手动刷新才回滚到「当前版本原包」。
- 导航结构：`.menu-item[data-page-id]` + `aria-current="page"` 仍在，`.playing-music` 仍在，
  切页轮播的 `pageSignature()` 不需要改；外观页「背景与材质」文案仍在，CSS 钩子仍在。
- 2.0.0 的 `appearance` 侧新增了 `data-te-we-bg` / `data-te-playback-bg` 两个 dataset（桥开关状态），
  与插件设置里的 `miniCover` / `playbackBg` 是两套开关，互不覆盖。

## 0. 1.4.x 变化

- 应用已内置 `out/renderer/we-background.js`
- 主进程 CSP 已包含 `WALLPAPER_ENGINE_ORIGIN`
- 2.2.0 起安装器只按桥内 `BRIDGE_VERSION` 判断：宿主桥没有该常量（视为 0）或小于 5 时覆盖
  - 官方 1.4 的 53,048 B 桥没有 v4/v5：迷你播放器被第 13 行 `return` 跳过，播放页 `.backdrop` 也没有规则
  - 覆盖后 v5 桥恢复迷你播放器图层、迷你 720P/30fps、播放页背景让位
- 缺少 `app.asar.te-we-backup` 时，安装器会先备份当前 `app.asar`
- `check-compat.mjs` 输出 `bridgeVersion` / `requiredBridgeVersion`，并区分 `bridgeHostIntegrated` 与 `bridgeFeaturesIntegrated`

## 1. 确认版本与文件

```powershell
Get-Item "D:\TwilightEcho\TwilightEcho.exe","D:\TwilightEcho\resources\app.asar" |
  Select-Object Name,Length,LastWriteTime
```

```powershell
node scripts/check-compat.mjs "D:\TwilightEcho"
```

`check-compat.mjs` 输出 JSON，重点看：

- `appVersion`
- `bridgeInstalled`
- `bridgeVersion` / `requiredBridgeVersion`（低于 5 时播放页背景与迷你播放器不生效）
- `csp.frame / img / media`
- `appearanceAnchor`
- `cssHooks`
- `backupVersion`
- `issues`

没有桥时 `bridgeInstalled=false` 是正常的；先跑安装器再看。

## 2. 检查入口与 CSP

```powershell
node -e "import('@electron/asar').then(a=>{const p='D:/TwilightEcho/resources/app.asar';console.log(a.extractFile(p,require('path').join('out','renderer','index.html')).toString().slice(0,1200))})"
```

关注：

- `<script type="module" ... src="./assets/index-xxxx.js">`
- `Content-Security-Policy` 的 `frame-src`
- 外观页资源名是否变成 `SettingsPage-xxxx.js`

```powershell
node -e "import('@electron/asar').then(a=>{const p='D:/TwilightEcho/resources/app.asar';const m=a.extractFile(p,require('path').join('out','main','index.js')).toString();const i=m.indexOf('frame-src');console.log(m.slice(i-80,i+120))})"
```

安装器按 `frame-src|img-src|media-src` 指令名追加 `127.0.0.1:3100`，不依赖具体尾项。若新版本换了 CSP 生成函数，需要更新 `bridge/install.mjs`。

## 3. 检查外观页锚点与样式

`bridge/we-background.js` 通过文案 `背景与材质` 找到插入点。若新版改了文案：

```powershell
node -e "import('@electron/asar').then(a=>{const p='D:/TwilightEcho/resources/app.asar';const list=a.listPackage(p).filter(x=>/SettingsPage-.*\.js$/.test(x));for(const f of list){const s=a.extractFile(p,f.split('/').join(require('path').sep)).toString();console.log(f,s.includes('背景与材质'))}})"
```

CSS 钩子：

- `.app-background-layer`
- `.settings-overlay-root`
- `te-settings-surface`

若这些类名变化，更新 `we-background.js` 的 CSS 与锚点。

## 4. 重新打桥并安装

完全退出 Twilight Echo（含托盘），然后：

```powershell
node bridge/install.mjs "D:\TwilightEcho"
```

安装器会：

- 解包新 `app.asar`
- 注入 `out/renderer/we-background.js`
- 给 `index.html` 加脚本与 meta CSP
- 给 `out/main/index.js` 的 CSP 响应头加 3100
- 用**当前版本原包**刷新 `app.asar.te-we-backup`
- 重装插件目录

## 5. 启动后的验收

1. 应用能正常启动
2. `设置 → 外观` 顶部出现“动态壁纸”
3. 视频壁纸能播放
4. 网页壁纸能显示，“交互”可点
5. 场景壁纸由 WebWallGL 渲染
6. X/Y/Z 滑杆实时生效，不重载 iframe
7. 缩放实时生效
8. 壁纸静音
9. `app.asar.te-we-backup` 是当前版本原包

## 6. 更新元数据

改完代码后更新：

- `COMPATIBILITY.json` 的 `host.tested`、`host.notes`
- `CHANGELOG.md`
- 如接口变了，更新 `docs/ARCHITECTURE.md`

## 7. 常见失败

| 现象 | 优先检查 |
|---|---|
| 设置块不出现 | `背景与材质` 文案、`SettingsPage-*.js` |
| 场景空白 | `/scene-live` 静态文件、`/scene-files`、CSP frame-src |
| 视频黑屏 | `media-src`、`/media` Range |
| 网页空白 | `frame-src`、`/web`、web 文件路径 |
| 应用启动失败 | 还原 `app.asar.te-we-backup`，检查 asar 重打包 |
| 升级后桥失效 | 官方包覆盖了 `app.asar`，重跑安装器 |
