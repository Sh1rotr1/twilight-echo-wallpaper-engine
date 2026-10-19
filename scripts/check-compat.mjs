#!/usr/bin/env node
/**
 * 只读兼容性检查。
 *
 *   node scripts/check-compat.mjs "D:\TwilightEcho"
 *
 * 输出 JSON。不做任何写入；升级/安装前先跑一遍。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(process.argv[2] || 'D:\\TwilightEcho')
const asarPath = path.join(appDir, 'resources', 'app.asar')
const backupPath = `${asarPath}.te-we-backup`
const ORIGIN = 'http://127.0.0.1:3100'

function fail(error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
  process.exit(2)
}

if (!fs.existsSync(asarPath)) fail(`找不到 ${asarPath}`)

let asar
try {
  asar = await import('@electron/asar')
} catch (error) {
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
  const values = [...String(main).matchAll(new RegExp(`"${name} ([^"]*)"`, 'g'))].map((m) => m[1])
  return values.find((value) => value.includes("'self'")) || values[0] || null
}

const pkg = readJson(asarPath, 'package.json') || {}
const index = read(asarPath, 'out/renderer/index.html') || ''
const main = read(asarPath, 'out/main/index.js') || ''
const frame = pickDirective(main, 'frame-src')
const img = pickDirective(main, 'img-src')
const media = pickDirective(main, 'media-src')

const bridgeInstalled = index.includes('we-background.js')
const indexCsp = index.includes(ORIGIN)
const csp = {
  frame,
  img,
  media,
  frameOk: Boolean(frame && frame.includes(ORIGIN)),
  imgOk: Boolean(img && img.includes(ORIGIN)),
  mediaOk: Boolean(media && media.includes(ORIGIN))
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

const backup = fs.existsSync(backupPath) ? readJson(backupPath, 'package.json') : null
const backupVersion = backup?.version || null

const compatibility = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'COMPATIBILITY.json'), 'utf8')) }
  catch { return null }
})()
const tested = compatibility?.host?.tested || []
const testedMatch = tested.includes(pkg.version)

let pluginInstalled = null
try {
  const statePath = path.join(process.env.APPDATA || '', 'TwilightEcho', 'plugin-state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  pluginInstalled = state?.['com.twilightecho.tool.wallpaper-engine']?.activeVersion || null
} catch { /* ignore */ }

const issues = []
if (!pkg.version) issues.push('无法读取 app.asar/package.json 版本')
if (!bridgeInstalled) issues.push('渲染桥未安装（升级后需要重跑 bridge/install.mjs）')
if (!indexCsp) issues.push('index.html meta CSP 未放行 127.0.0.1:3100')
if (!csp.frameOk) issues.push('main frame-src 未放行 127.0.0.1:3100')
if (!csp.imgOk) issues.push('main img-src 未放行 127.0.0.1:3100')
if (!csp.mediaOk) issues.push('main media-src 未放行 127.0.0.1:3100')
if (!appearanceAnchor) issues.push('SettingsPage 中找不到“背景与材质”，外观设置块不会插入')
if (!cssHooks.appBackgroundLayer) issues.push('CSS 缺少 .app-background-layer 钩子')
if (!cssHooks.settingsOverlayRoot) issues.push('CSS 缺少 .settings-overlay-root 钩子')
if (!cssHooks.settingsSurface) issues.push('CSS 缺少 te-settings-surface 钩子')
if (!backupVersion) issues.push('缺少 app.asar.te-we-backup 备份')

const warnings = []
if (!testedMatch) warnings.push(`当前版本 ${pkg.version} 不在 tested 列表（${tested.join(', ')}），需要人工回归`)
if (backupVersion && pkg.version && backupVersion !== pkg.version) {
  warnings.push(`备份版本 ${backupVersion} 与当前版本 ${pkg.version} 不一致`)
}

console.log(JSON.stringify({
  ok: issues.length === 0,
  appDir,
  appVersion: pkg.version || null,
  tested,
  testedMatch,
  bridgeInstalled,
  indexCsp,
  csp,
  appearanceAnchor,
  cssHooks,
  backup: { exists: Boolean(backupVersion), version: backupVersion, matches: backupVersion === pkg.version },
  pluginInstalled,
  needsInstall: !bridgeInstalled,
  issues,
  warnings
}, null, 2))

process.exit(issues.length === 0 ? 0 : 1)
