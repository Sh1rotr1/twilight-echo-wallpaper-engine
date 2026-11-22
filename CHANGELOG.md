# Changelog

## 3.0.1 — 2026-11-22

**v5 原生桥适配：不修改 Twilight Echo 本体。**

- 只读读取宿主 `out/renderer/we-background.js` 的 `BRIDGE_VERSION`，要求 ≥ 5。
- 保留视频 / 网页 / 场景、画质、填充、暗化、X/Y/Z、缩放、壁纸属性、迷你播放器、播放页背景。
- 不写 `resources/app.asar`，不生成备份，不排队补丁。
- 插件设置面板与外观卡片按 v5 能力提供。
- `check-compat.mjs` 只检查桥、CSP、外观锚点与 CSS 钩子。
- `.tep` 只包含插件运行时。
