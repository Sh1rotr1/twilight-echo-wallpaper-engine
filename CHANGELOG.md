# Changelog

## 2.1.0

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
