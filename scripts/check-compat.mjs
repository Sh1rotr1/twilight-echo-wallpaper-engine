#!/usr/bin/env node
/**
 * 只读兼容性检查（3.x 原生模式）。
 *
 *   node scripts/check-compat.mjs "D:\TwilightEcho"
 *
 * 插件不修改 resources/app.asar：这里只检查宿主是否自带可用的渲染桥、CSP 与外观锚点。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(process.argv[2] || 'D:\\TwilightEcho')
const asarPath = path.join(appDir, 'resources', 'app.asar')
const ORIGIN = 'http://127.0.0.1:3100'
const NATIVE_BRIDGE_VERSION = 5

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

/**
 * CSP source-list 合法性。常见写坏形式：
 *   `http://127.0.0.1:3100 http://127.0.0.1:*'self' data: ...`
 * 非引号 token 里夹了单引号，浏览器会把 'self' 一起判成非法 source。
 */
function invalidCspSources(value) {
  const text = String(value || '').trim()
  if (!text) return []
  const tokens = text.split(/\s+/).filter(Boolean)
  const bad = tokens.filter((token) => token.includes("'") && !/^'[a-zA-Z-]+'$/.test(token))
  if (tokens.includes("'none'") && tokens.length > 1) bad.push("'none' 与其他 source 混用")
  return bad
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
  : bridgeVersion >= NATIVE_BRIDGE_VERSION
    ? 'native'
    : 'unsupported'
const bridgeReady = bridgeMode === 'native'

const frame = pickDirective(main, 'frame-src')
const img = pickDirective(main, 'img-src')
const media = pickDirective(main, 'media-src')
const indexCsp = index.includes(ORIGIN)
const cspBad = {
  frame: invalidCspSources(frame),
  img: invalidCspSources(img),
  media: invalidCspSources(media)
}
const csp = {
  frame,
  img,
  media,
  frameOk: directiveHasOrigin(frame),
  imgOk: directiveHasOrigin(img),
  mediaOk: directiveHasOrigin(media),
  frameValid: cspBad.frame.length === 0,
  imgValid: cspBad.img.length === 0,
  mediaValid: cspBad.media.length === 0,
  invalid: cspBad,
  valid: cspBad.frame.length === 0 && cspBad.img.length === 0 && cspBad.media.length === 0
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
if (bridgeInstalled && !bridgeReady) issues.push(`渲染桥 v${bridgeVersion || 'legacy'} < v${NATIVE_BRIDGE_VERSION}，本插件不支持`)
if (!indexCsp) issues.push('out/renderer/index.html 未放行 http://127.0.0.1:3100')
if (!csp.frameOk) issues.push('主进程 CSP 的 frame-src 未放行 127.0.0.1:3100')
if (!csp.imgOk) issues.push('主进程 CSP 的 img-src 未放行 127.0.0.1:3100')
if (!csp.mediaOk) issues.push('主进程 CSP 的 media-src 未放行 127.0.0.1:3100')
for (const [name, bad] of Object.entries(csp.invalid)) {
  if (bad.length) {
    issues.push(`主进程 CSP 的 ${name}-src 含非法 source token：${bad.slice(0, 3).join(' / ')}（外部补丁器写坏的常见形态；还原官方 app.asar 或修正补丁器）`)
  }
}
const warnings = []
if (!testedMatch) warnings.push(`当前版本 ${appVersion || '?'} 不在 tested 列表（${tested.join(', ') || '空'}），建议人工回归`)

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
  bridgeReady,
  indexCsp,
  csp,
  appearanceAnchor,
  cssHooks,
  issues,
  warnings
}

console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
