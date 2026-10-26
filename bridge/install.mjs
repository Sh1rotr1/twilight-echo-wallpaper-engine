#!/usr/bin/env node
/**
 * Twilight Echo × Wallpaper Engine — bridge installer.
 *
 * 1. Patches resources/app.asar:
 *    - adds out/renderer/we-background.js
 *    - adds it to index.html and widens the CSP for 127.0.0.1:3100
 * 2. Installs the plugin directory into userData/plugins.
 * 3. Resets a stale plugin-theme selection (this version no longer ships themes).
 *
 * Run with the app closed:
 *   node bridge/install.mjs "D:\TwilightEcho"
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(process.argv[2] || 'D:\\TwilightEcho')
const ASAR_PATH = path.join(APP_DIR, 'resources', 'app.asar')
const PLUGIN_ID = 'com.twilightecho.tool.wallpaper-engine'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_SRC = path.resolve(HERE, '..')
const PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, 'plugin.json'), 'utf8')).version
const PORT = 3100

function fail(message) {
  console.error(`\n[install] ${message}\n`)
  process.exit(1)
}

function isAppRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq TwilightEcho.exe', '/NH'], { encoding: 'utf8', windowsHide: true })
    return /TwilightEcho\.exe/i.test(out)
  } catch {
    return false
  }
}

async function loadAsar() {
  try {
    return await import('@electron/asar')
  } catch (error) {
    fail(
      '缺少 @electron/asar。请先在此目录执行：\n' +
        '  npm install @electron/asar\n' +
        `原始错误：${error.message}`
    )
  }
}

function patchIndexHtml(html) {
  let out = html
  const origin = `http://127.0.0.1:${PORT}`

  const addToDirective = (name) => {
    const re = new RegExp(`(${name}\\s+[^;]*)`, 'i')
    out = out.replace(re, (match) => (match.includes(origin) ? match : `${match} ${origin}`))
  }
  for (const directive of ['img-src', 'media-src', 'frame-src', 'connect-src']) addToDirective(directive)

  if (!out.includes('we-background.js')) {
    out = out.replace(
      /<\/head>/i,
      `  <!-- te-we-bridge -->\n  <script type="module" src="./we-background.js"></script>\n</head>`
    )
  }
  return out
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['bridge', 'node_modules', '.git', 'dist'].includes(entry.name)) continue
    if (entry.name.startsWith('_')) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function installPlugin() {
  const userData = path.join(process.env.APPDATA || os.homedir(), 'TwilightEcho')
  if (!fs.existsSync(userData)) fail(`找不到 Twilight Echo 用户数据目录：${userData}`)
  const target = path.join(userData, 'plugins', PLUGIN_ID, PLUGIN_VERSION)
  fs.rmSync(path.join(userData, 'plugins', PLUGIN_ID), { recursive: true, force: true })
  copyDir(PLUGIN_SRC, target)

  const statePath = path.join(userData, 'plugin-state.json')
  let state = {}
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = {}
  } catch {
    state = {}
  }
  const now = new Date().toISOString()
  state[PLUGIN_ID] = {
    enabled: true,
    installedAt: state[PLUGIN_ID]?.installedAt || now,
    updatedAt: now,
    source: 'directory',
    activeVersion: PLUGIN_VERSION
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')

  const settingsPath = path.join(userData, 'settings.json')
  const themesPath = path.join(userData, 'themes.json')
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    if (settings.activeTheme?.kind === 'plugin' && settings.activeTheme.pluginId === PLUGIN_ID) {
      settings.activeTheme = { kind: 'builtin', id: 'builtin:twilight-echo-default' }
      settings.pluginThemeId = null
      fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf8')
    }
  } catch {
    /* optional */
  }
  try {
    const themes = JSON.parse(fs.readFileSync(themesPath, 'utf8'))
    const active = themes?.data?.activeTheme
    if (active?.kind === 'plugin' && active.pluginId === PLUGIN_ID) {
      themes.data.activeTheme = { kind: 'builtin', id: 'builtin:twilight-echo-default' }
      themes.revision = (Number(themes.revision) || 0) + 1
      themes.savedAt = new Date().toISOString()
      fs.writeFileSync(themesPath, JSON.stringify(themes), 'utf8')
    }
  } catch {
    /* optional */
  }
  return target
}

async function main() {
  if (isAppRunning()) fail('Twilight Echo 正在运行。请先完全退出应用（含托盘），再运行安装器。')
  if (!fs.existsSync(ASAR_PATH)) fail(`找不到 app.asar：${ASAR_PATH}`)

  const asar = await loadAsar()
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'te-we-bridge-'))
  const unpacked = path.join(tempRoot, 'app')
  const newAsar = path.join(tempRoot, 'app.asar')

  console.log(`[install] 解包：${ASAR_PATH}`)
  await asar.extractAll(ASAR_PATH, unpacked)

  const renderer = path.join(unpacked, 'out', 'renderer')
  if (!fs.existsSync(renderer)) fail('app.asar 中找不到 out/renderer')

  const bridgePath = path.join(renderer, 'we-background.js')
  const existingBridge = fs.existsSync(bridgePath) ? fs.readFileSync(bridgePath, 'utf8') : ''
  const hostIntegratedBridge =
    existingBridge.includes('securitypolicyviolation') &&
    existingBridge.includes('playbackStatus') &&
    existingBridge.includes('te-we-mini-cover') &&
    existingBridge.includes('data-te-lyric-invert')
  if (hostIntegratedBridge) {
    console.log('[install] 检测到已适配的宿主渲染桥，保留')
  } else {
    fs.copyFileSync(path.join(HERE, 'we-background.js'), bridgePath)
  }

  // The main process installs an authoritative CSP response header for the app
  // document. A meta tag alone is not enough: media/frame/img must be widened
  // there too, otherwise <video src="http://127.0.0.1:3100/..."> is blocked.
  const mainPath = path.join(unpacked, 'out', 'main', 'index.js')
  let main = fs.readFileSync(mainPath, 'utf8')
  const origin = `http://127.0.0.1:${PORT}`
  // 1.4+ builds the app CSP from template literals; older builds use quoted
  // strings. Patch only the app CSP form, not the plugin-UI/visualizer CSP.
  const templateCsp = main.includes('`frame-src ')
  for (const name of ['frame-src', 'img-src', 'media-src']) {
    const re = templateCsp ? new RegExp('`' + name + ' [^`]*`', 'g') : new RegExp(`"${name} [^"]*"`, 'g')
    main = main.replace(re, (match) => {
      const quote = templateCsp ? '`' : '"'
      return match.includes(origin) || match.includes('${WALLPAPER_ENGINE_ORIGIN}')
        ? match
        : `${match.slice(0, -1)} ${origin}${quote}`
    })
  }
  fs.writeFileSync(mainPath, main, 'utf8')

  const indexPath = path.join(renderer, 'index.html')
  const original = fs.readFileSync(indexPath, 'utf8')
  const patched = patchIndexHtml(original)
  if (!patched.includes('we-background.js')) fail('index.html 未能写入渲染桥入口，版本可能不匹配')
  fs.writeFileSync(indexPath, patched, 'utf8')

  console.log('[install] 重新打包 app.asar（请稍候）…')
  await asar.createPackage(unpacked, newAsar)

  const inspect = await asar.extractFile(newAsar, path.join('out', 'renderer', 'index.html')).toString('utf8')
  if (!inspect.includes('we-background.js')) fail('回读校验失败：index.html 中没有渲染桥入口')
  if (!inspect.includes(`127.0.0.1:${PORT}`)) fail('回读校验失败：CSP 未放行本地媒体端口')

  const backup = `${ASAR_PATH}.te-we-backup`
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(ASAR_PATH, backup)
    console.log(`[install] 已备份当前版本：${backup}`)
  } else {
    console.log('[install] 已存在 app.asar 备份，保留原备份')
  }
  fs.rmSync(ASAR_PATH, { force: true })
  fs.copyFileSync(newAsar, ASAR_PATH)
  console.log(`[install] 已写入渲染桥：${ASAR_PATH}`)

  const target = installPlugin()
  console.log(`[install] 已安装插件：${target}`)
  fs.rmSync(tempRoot, { recursive: true, force: true })

  console.log('\n完成。启动 Twilight Echo 后，打开 设置 → 插件 → Wallpaper Engine 动态背景 选择壁纸。')
  console.log('若背景没有出现，先确认 3100 端口未被占用，并查看插件日志。')
}

main().catch((error) => fail(error?.stack || String(error)))
