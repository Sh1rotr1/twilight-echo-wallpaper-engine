# 升级适配手册

Twilight Echo 升级后，`resources/app.asar` 会被官方新包覆盖，桥和备份都要重做。按下面顺序处理。

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
