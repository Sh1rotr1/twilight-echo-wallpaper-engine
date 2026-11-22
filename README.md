# Twilight Echo Wallpaper Engine 动态背景

把本机 Wallpaper Engine 壁纸放到 Twilight Echo 界面最底层播放。

3.0.1 起插件**不修改 Twilight Echo 本体**：不写 `resources/app.asar`，不生成备份，不排队补丁。
插件只读检查宿主自带的 `out/renderer/we-background.js`，在官方 v5 桥上提供壁纸能力。

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
- 迷你播放器 / 播放页背景可开关
- 读取 `project.json` 的壁纸属性，生成开关 / 滑杆 / 颜色 / 下拉 / 文件控件
- 属性修改实时作用于当前壁纸，覆盖值按壁纸保存，可恢复默认
- 兼容 Spine / WebGL 网页壁纸的 `../assets` 项目根路径
- 不修改系统桌面壁纸，不修改宿主 `app.asar`

## 界面

```text
设置 → 外观 → 背景与材质 → 动态壁纸
```

包含壁纸选择、画质、填充 / 暗化、X / Y / Z、缩放、壁纸属性。

插件自己的设置面板：

```text
设置 → 系统与维护 → 插件设置 → Wallpaper Engine 动态背景
```

包含筛选、壁纸下拉、应用 / 刷新 / 暂停 / 继续 / 关闭、额外壁纸目录、启动恢复、
迷你播放器开关、播放页背景开关。

## 安装

1. 退出 Twilight Echo（含托盘）。
2. 把 `com.twilightecho.tool.wallpaper-engine-3.0.1.tep` 放进插件中心安装，或把本目录复制到：

   ```text
   %APPDATA%\TwilightEcho\plugins\com.twilightecho.tool.wallpaper-engine\3.0.1\
   ```

3. 在插件中心启用并选择 3.0.1。
4. 启动 Twilight Echo，打开 设置 → 外观 → 背景与材质。

## 兼容性

| 宿主 | 桥 | 结果 |
|---|---|---|
| Twilight Echo 2.0.2 官方包 | v5 | 壁纸、属性、迷你播放器、播放页背景可用 |
| 桥缺失或 < v5 | — | 不工作，插件只报状态，不修改宿主 |

只读检查：

```powershell
node scripts/check-compat.mjs "D:\TwilightEcho"
```

输出 `bridgeVersion`、`bridgeMode`、CSP 与外观锚点。

## 目录

```text
plugin.json                 插件清单（apiVersion 3）
index.mjs                   宿主侧：扫描、HTTP 服务、设置面板
lib/host-bridge.mjs         只读读取 app.asar 内的渲染桥版本
lib/asar-lite.cjs           自带 asar 读取（无 npm 依赖）
lib/webwallgl/              WebWallGL 适配页 + 引擎
lib/we-props.js             壁纸属性解析
lib/scene-manifest.js       旧场景解析（兼容保留）
lib/scene-player.js         旧场景播放器（兼容保留）
COMPATIBILITY.json          机器可读的版本/路由
docs/ARCHITECTURE.md        数据流和状态字段
docs/ADAPTING.md            宿主升级后的检查步骤
```

## 排查

- 外观页没有“动态壁纸”卡片：确认宿主 `out/renderer/index.html` 含 `we-background.js` 且
  `out/renderer/we-background.js` 存在；跑 `check-compat`。
- 卡片出现但画面不动：确认 3100 端口没有被占用，插件日志有“媒体服务已启动”。
- 场景异常：插件日志会记录 `/scene-live` 加载错误；复杂自定义 shader 可能与 WE 本体有差异。

## License

MIT
