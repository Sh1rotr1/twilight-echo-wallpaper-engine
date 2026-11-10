# 自行添加宿主桥（手动接入指南）

Twilight Echo 每次用官方安装器升级，都会**整体重写** `resources/app.asar`：
渲染桥退回宿主自带版本（v5，没有轮播），`index.html` 里的 `<script>` 入口和 CSP 也会一起消失。

本插件 2.4.1 起自带自愈：插件运行时会发现桥缺失，在**应用退出后**自动把桥打回去。
如果你不想等自动流程、或者想在自己的机器上手动接一次，按下面任一方式做。

需要准备的东西（都在本仓库 / 发布包里）：

| 文件 | 用途 |
|---|---|
| `bridge/we-background.js`（或包里的 `patch/we-background.js`） | 要注入的渲染桥，文件头 `BRIDGE_VERSION = 9` |
| `lib/bridge-adapt.mjs` + `lib/asar-lite.cjs` | 自带的补丁器（不需要 npm、不需要 @electron/asar） |
| `add-bridge.cmd` | Windows 双击入口（用 Twilight Echo 自带的 node） |

---

## 方式 A：让它自己修（推荐）

1. 完全退出 Twilight Echo（含托盘）。
2. 安装 `com.twilightecho.tool.wallpaper-engine-2.4.1.tep`，并在插件管理里**启用**。
3. 启动一次 Twilight Echo，再退出。

第二次退出时，插件会把桥写回去。日志在：

```text
%APPDATA%\TwilightEcho\logs\plugins\com.twilightecho.tool.wallpaper-engine.log
%APPDATA%\TwilightEcho\plugin-data\com.twilightecho.tool.wallpaper-engine\bridge-adapt.log
```

看到 `适配完成 v<版本> bridge=v9 ok=true` 就是好了，下次启动外观页的「动态壁纸」恢复，
轮播（定时 / 切页）也能用。

## 方式 B：双击 `add-bridge.cmd`（Windows，无需装 Node）

1. 完全退出 Twilight Echo。
2. 把本仓库（或发布包）解压到任意目录。
3. 双击 `add-bridge.cmd`。

脚本会：

- 自动找 Twilight Echo（默认 `D:\TwilightEcho`，也可以把安装目录拖到 cmd 上）；
- 用 Twilight Echo 自带的 `resources\core-node\runtime\node.exe` 执行
  `lib\bridge-adapt.mjs --app <安装目录>`；
- 打补丁前自动备份 `resources\app.asar.te-we-backup-<版本>` 和 `app.asar.te-we-backup`，
  写入用「临时文件 + rename」原子替换，回读校验桥版本 / 入口 / CSP。

命令行等价写法：

```powershell
"D:\TwilightEcho\resources\core-node\runtime\node.exe" `
  ".\lib\bridge-adapt.mjs" --app "D:\TwilightEcho"
```

只想检查、不写文件：

```powershell
"D:\TwilightEcho\resources\core-node\runtime\node.exe" `
  ".\lib\bridge-adapt.mjs" --app "D:\TwilightEcho" --dry-run
```

还原：

```powershell
"D:\TwilightEcho\resources\core-node\runtime\node.exe" `
  ".\lib\bridge-adapt.mjs" --app "D:\TwilightEcho" --revert
```

## 方式 C：完全手动（已经装了 Node 和 @electron/asar）

```powershell
# 0. 完全退出 Twilight Echo
$app = "D:\TwilightEcho"
$tmp = "$env:TEMP\te-we"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null

# 1. 解包（会覆盖 app.asar 前先备份）
Copy-Item "$app\resources\app.asar" "$app\resources\app.asar.te-we-backup" -Force
npx @electron/asar extract "$app\resources\app.asar" $tmp

# 2. 放入渲染桥
Copy-Item ".\bridge\we-background.js" "$tmp\out\renderer\we-background.js" -Force

# 3. 在 index.html 的 </head> 前加入口，并在 CSP 里放行 3100
#    把下面这行加到 <head> 内任意位置：
#    <script type="module" src="./we-background.js"></script>
#    CSP 的 img-src / media-src / frame-src / connect-src 都要包含 http://127.0.0.1:3100

# 4. 同时改主进程 CSP（out/main/index.js 里的 CSP 字符串，追加 http://127.0.0.1:3100）

# 5. 重新打包
npx @electron/asar pack $tmp "$app\resources\app.asar"
```

改完之后启动应用，打开 `设置 → 外观 → 动态壁纸` 应能看到壁纸卡片。
如果外观页正常但背景没动，先看 `bridge-adapt.log` 与插件日志，再确认 `we-background.js` 的
`BRIDGE_VERSION` 是 9。

---

## 怎么确认桥真的生效

1. 外观页「动态壁纸」块能选壁纸并应用；
2. 播放一首歌，页面背景是壁纸（不是纯色）；
3. 壁纸视频静音：开发者工具里 `<video muted>`；
4. 轮播：设置里开「定时轮播」等 1 分钟应自动换；「切页轮播」切一次页面换一次。

## 回滚

```text
resources/app.asar.te-we-backup-<版本>   ← 该版本第一次打补丁前的原包
resources/app.asar.te-we-backup          ← 同上（不带版本号的副本）
```

任选其一复制回 `resources/app.asar` 即可；或用方式 B 的 `--revert`。
同版本号重发安装包时，补丁器会比对内容并刷新备份，不会把旧构建当原包。
