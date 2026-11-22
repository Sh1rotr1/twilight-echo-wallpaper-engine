#!/usr/bin/env node
/**
 * 只读兼容性检查（3.x 原生模式）。
 *
 *   node scripts/check-compat.mjs "D:\TwilightEcho"
 *
 * 3.0.0 起插件不再修改 resources/app.asar：这里只检查宿主是否自带可用的
 * 渲染桥、CSP 与外观锚点，并区分原生模式（v5）与增强模式（v9+）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(process.argv[2] || 'D:\\TwilightEcho')
const asarPath = path.join(appDir, 'resources', 'app.asar')
const ORIGIN = 'http://127.0.0.1:3100'
const NATIVE_BRIDGE_VERSION = 5
const ENHANCED_BRIDGE_VERSION = 9

function fail(error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
  process.exit(2)
}

if (!fs.existsSync(asarPath)) fail(`找不到 ${asarPath}`)

let asar
try {
  asar = await import('@electron/asar')
} catch {
  fail('缺少 @electron/asar；请在插件源码工作区运行，或先 npm i @electron/asar')
}

function read(archive, rel) {
  try {
    const clean = String(rel).replace(/^[\\/]+/, '').split(/[\\/]+/).join(path.sep)
    return asar.extractFile(archive, clean).toString('utf8')
  } catch {
    return null
  }
}

function readJson(archive, rel) {
  const text = read(archive, rel)
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function pickDirective(main, name) {
  const values = [...String(main).matchAll(new RegExp('(?:`|")' + name + ' ([^`"]*)', 'g'))].map((m) => m[1])
  const preferred = values.filter((value) =>
    value.includes('${WALLPAPER_ENGINE_ORIGIN}') ||
    value.includes(ORIGIN)
  )
  return preferred[preferred.length - 1] || values.find((value) =>
    value.includes('cover:') ||
    value.includes('twilight-media:') ||
    value.includes('plugin-ui:')
  ) || values.find((value) => value.includes("'self'")) || values[0] || null
}

function directiveHasOrigin(value) {
  return Boolean(value && (value.includes(ORIGIN) || value.includes('${WALLPAPER_ENGINE_ORIGIN}')))
}

const compatibility = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'COMPATIBILITY.json'), 'utf8')) }
  catch { return null }
})()

const pkg = readJson(asarPath, 'package.json') || {}
const index = read(asarPath, 'out/renderer/index.html') || ''
const main = read(asarPath, 'out/main/index.js') || ''
const bridgeText = read(asarPath, 'out/renderer/we-background.js') || ''
const bridgeInstalled = index.includes('we-background.js') && Boolean(bridgeText)
const bridgeVersion = Number((bridgeText.match(/BRIDGE_VERSION\s*=\s*(\d+)/) || [])[1] || 0)
const bridgeMode = !bridgeInstalled
  ? 'missing'
  : bridgeVersion >= ENHANCED_BRIDGE_VERSION
    ? 'enhanced'
    : bridgeVersion >= NATIVE_BRIDGE_VERSION
      ? 'native'
      : 'unsupported'
const bridgeNativeReady = bridgeMode === 'native' || bridgeMode === 'enhanced'
const carouselAvailable = bridgeMode === 'enhanced'

const frame = pickDirective(main, 'frame-src')
const img = pickDirective(main, 'img-src')
const media = pickDirective(main, 'media-src')
const indexCsp = index.includes(ORIGIN)
const csp = {
  frame,
  img,
  media,
  frameOk: directiveHasOrigin(frame),
  imgOk: directiveHasOrigin(img),
  mediaOk: directiveHasOrigin(media)
}

let assets = []
try { assets = asar.listPackage(asarPath) || [] } catch { assets = [] }
const settingsAssets = assets.filter((entry) => /SettingsPage-.*\.js$/i.test(entry))
let appearanceAnchor = false
for (const entry of settingsAssets) {
  const text = read(asarPath, entry)
  if (text && text.includes('背景与材质')) { appearanceAnchor = true; break }
}

const cssAssets = assets.filter((entry) => /out[\\/]renderer[\\/]assets[\\/].*\.css$/i.test(entry))
const cssHooks = { appBackgroundLayer: false, settingsOverlayRoot: false, settingsSurface: false }
for (const entry of cssAssets) {
  const text = read(asarPath, entry)
  if (!text) continue
  if (text.includes('app-background-layer')) cssHooks.appBackgroundLayer = true
  if (text.includes('settings-overlay-root')) cssHooks.settingsOverlayRoot = true
  if (text.includes('te-settings-surface')) cssHooks.settingsSurface = true
}

const tested = Array.isArray(compatibility?.host?.tested) ? compatibility.host.tested : []
const appVersion = String(pkg.version || '')
const testedMatch = tested.includes(appVersion)
const issues = []
if (!bridgeInstalled) issues.push('宿主未提供 out/renderer/we-background.js（需要 Twilight Echo 2.0.0+ 官方桥）')
if (!bridgeNativeReady && bridgeInstalled) issues.push(`渲染桥 v${bridgeVersion || 'legacy'} < v${NATIVE_BRIDGE_VERSION}，本插件不支持`)
if (!indexCsp) issues.push('out/renderer/index.html 未放行 http://127.0.0.1:3100')
if (!csp.frameOk) issues.push('主进程 CSP 的 frame-src 未放行 127.0.0.1:3100')
if (!csp.imgOk) issues.push('主进程 CSP 的 img-src 未放行 127.0.0.1:3100')
if (!csp.mediaOk) issues.push('主进程 CSP 的 media-src 未放行 127.0.0.1:3100')
const warnings = []
if (!testedMatch) warnings.push(`当前版本 ${appVersion || '?'} 不在 tested 列表（${tested.join(', ') || '空'}），建议人工回归`)
if (bridgeNativeReady && !carouselAvailable) warnings.push('原生 v5 桥：轮播不可用（需要 v9+ 增强桥）')

const result = {
  ok: issues.length === 0,
  appDir,
  appVersion,
  tested,
  testedMatch,
  bridgeInstalled,
  bridgeVersion,
  bridgeMode,
  nativeBridgeVersion: NATIVE_BRIDGE_VERSION,
  enhancedBridgeVersion: ENHANCED_BRIDGE_VERSION,
  bridgeNativeReady,
  carouselAvailable,
  indexCsp,
  csp,
  appearanceAnchor,
  cssHooks,
  hostShell: {
    appBackgroundLayer: cssHooks.appBackgroundLayer,
    settingsOverlayRoot: cssHooks.settingsOverlayRoot,
    settingsSurface: cssHooks.settingsSurface
  },
  issues,
  warnings
}

console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
