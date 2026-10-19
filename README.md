# Twilight Echo Wallpaper Engine 动态背景

把本机 Wallpaper Engine 壁纸放到 Twilight Echo 界面最底层播放。

插件完全在本地运行，使用 `127.0.0.1:3100` 提供壁纸数据；不修改系统桌面壁纸，不启动 Wallpaper Engine。

## 功能

- 扫描 Steam 创意工坊 `431960`、`projects/myprojects` 和自定义目录
- 视频、网页、场景壁纸在界面底层播放
- 场景由 WebWallGL 3.x 实时渲染，支持图层、粒子、模型、puppet、常见 shader
- 画质：原画 / 1080P / 720P
- 填充：裁剪铺满 / 完整显示 / 拉伸
- 暗化：0 / 20 / 35 / 50
- 位置 X / Y / Z、缩放实时生效
- 视频和网页自动静音
- 网页壁纸可进入交互模式
- 读取 `project.json` 的壁纸属性，生成开关 / 滑杆 / 颜色 / 下拉 / 文件控件
- 属性修改实时作用于当前壁纸，覆盖值按壁纸保存，可恢复默认
- 兼容 Spine / WebGL 网页壁纸的 `../assets` 项目根路径
- 不修改系统桌面壁纸

## 界面

```text
设置 → 外观 → 动态壁纸
```

包含：

- 壁纸选择
- 画质
- 填充 / 暗化
- X / Y / Z
- 缩放
- 壁纸属性
- 应用 / 暂停 / 交互 / 关闭

## 安装

### 方式一：应用已集成渲染桥

适用于 Twilight Echo 已按 [`docs/TE-PATCH.md`](docs/TE-PATCH.md) 集成 `we-background.js` 的版本。

1. 完全退出 Twilight Echo
2. 在插件管理中安装：

```text
dist/com.twilightecho.tool.wallpaper-engine-2.1.0.tep
```

3. 重启 Twilight Echo
4. 打开 `设置 → 外观 → 动态壁纸`

### 方式二：本地开发安装

适用于当前尚未集成渲染桥的 Twilight Echo 1.3.1。

要求：

- Node.js
- `@electron/asar`
- 完全退出 Twilight Echo

```powershell
cd te-we-plugin
npm install @electron/asar
node bridge/install.mjs "D:\TwilightEcho"
```

安装器会：

1. 注入 `out/renderer/we-background.js`
2. 修改 `index.html` 与主进程 CSP
3. 重新打包 `resources/app.asar`
4. 备份为 `app.asar.te-we-backup`
5. 安装插件到用户插件目录

### 构建 .tep

官方推荐使用 Twilight Echo 的 `create-twilight-plugin pack`：

```powershell
git clone --branch Pxasen https://github.com/Px-asen/Twilight_Echo.git ..\Twilight_Echo
node ..\Twilight_Echo\packages\create-twilight-plugin\bin\create-twilight-plugin.cjs pack . --out dist
```

本地备用脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-tep.ps1
```

输出：

```text
dist/com.twilightecho.tool.wallpaper-engine-<version>.tep
```

`.tep` 内含插件本体、`patch/we-background.js` 和 [`docs/TE-PATCH.md`](docs/TE-PATCH.md)。

发布到 GitHub、Release 和社区插件市场：

- [`docs/PUBLISHING.md`](docs/PUBLISHING.md)

## 本体接入

插件 TEP 本身不会修改 Twilight Echo 的 `app.asar`。应用侧需要：

1. 把 `patch/we-background.js` 放到 `out/renderer/we-background.js`
2. 在 `out/renderer/index.html` 引入该脚本
3. 在 `index.html` 与主进程 CSP 中放行 `http://127.0.0.1:3100`

完整步骤、CSP 修改点和原因见：

- [`docs/TE-PATCH.md`](docs/TE-PATCH.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 使用

1. 启动 Twilight Echo
2. 打开 `设置 → 外观`
3. 在“动态壁纸”里选择壁纸、画质、填充/暗化
4. 点“应用”
5. 网页壁纸需要点击时点“交互”，右上角“退出交互”恢复界面
6. 应用壁纸后出现“壁纸属性”，修改会实时生效

## 兼容性

当前开发与验证版本：

- Twilight Echo `1.3.1`
- Wallpaper Engine 创意工坊壁纸
- Windows

应用更新后，如果内置渲染桥被覆盖，需要重新接入或重新安装。

## 卸载 / 还原

完全退出 Twilight Echo 后：

```powershell
Copy-Item "D:\TwilightEcho\resources\app.asar.te-we-backup" `
          "D:\TwilightEcho\resources\app.asar" -Force
```

删除插件目录：

```powershell
Remove-Item "$env:APPDATA\TwilightEcho\plugins\com.twilightecho.tool.wallpaper-engine" `
            -Recurse -Force
```

## 目录结构

```text
plugin.json                 插件清单
index.mjs                   扫描、HTTP 服务、设置面板
lib/webwallgl/              WebWallGL 适配页与引擎
lib/we-props.js             壁纸属性解析
lib/scene-manifest.js       旧场景解析（兼容）
lib/scene-player.js         旧场景播放器（兼容）
bridge/we-background.js     渲染桥
bridge/install.mjs          本地开发安装器
docs/TE-PATCH.md            本体的接入说明
scripts/build-tep.ps1       构建 .tep
scripts/check-compat.mjs    兼容性检查
```

## 开发检查

```powershell
node scripts/check-compat.mjs "D:\TwilightEcho"
```

## 许可

MIT。第三方组件说明见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。

壁纸属性解析的语义参考了 [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT）。渲染桥是针对 Twilight Echo 的独立实现。
