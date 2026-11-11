#!/usr/bin/env node
/**
 * Wallpaper Engine × Twilight Echo —— 自带桥适配器（独立自愈）
 *
 * 官方安装器每次升级都会整体覆盖 resources/app.asar，宿主自带的
 * out/renderer/we-background.js 会退回 v5（没有轮播/播放页背景），
 * index.html 里的入口和 CSP 也会消失。这个脚本负责在应用退出后重新注入：
 *
 *   1. out/renderer/we-background.js  ← patch/we-background.js（v9）
 *   2. out/renderer/index.html        ← 加 <script src="./we-background.js"> + CSP 放行 3100
 *   3. out/main/index.js              ← CSP 响应头放行 3100
 *
 * 不依赖 @electron/asar（自带 lib/asar-lite.cjs），可被插件在运行时拉起：
 *   node lib/bridge-adapt.mjs --app "D:\TwilightEcho" --wait-exit --auto
 *
 * 手动用法：
 *   node lib/bridge-adapt.mjs                     # 应用已退出时直接打补丁
 *   node lib/bridge-adapt.mjs --dry-run --json    # 只检查
 *   node lib/bridge-adapt.mjs --revert            # 还原 asar
 *   node lib/bridge-adapt.mjs --force             # 资源没变也重打
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const lite = require('./asar-lite.cjs')

const PLUGIN_ID = 'com.twilightecho.tool.wallpaper-engine'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..')
const ORIGIN = 'http://127.0.0.1:3100'
const SHIPPED_BRIDGE_MIN = 9

function userDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.config'))
  return path.join(base, 'TwilightEcho')
}

function pluginDataDir() {
  return path.join(userDataDir(), 'plugin-data', PLUGIN_ID)
}

function statePath() {
  return path.join(pluginDataDir(), 'bridge-adapt.json')
}

function logPath() {
  return path.join(pluginDataDir(), 'bridge-adapt.log')
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function appendLog(line) {
  try {
    const file = logPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
    const stat = fs.statSync(file)
    if (stat.size > 128 * 1024) {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').slice(-120).join('\n'), 'utf8')
    }
  } catch {
    /* 日志失败不影响适配 */
  }
}

/* --------------------------------------------------------------- 宿主信息 */

export function detectAppDir(explicit) {
  const candidates = []
  if (explicit) candidates.push(explicit)
  if (process.env.TE_APP_DIR) candidates.push(process.env.TE_APP_DIR)
  const exec = String(process.execPath || '')
  const normalized = exec.replace(/\\/g, '/').toLowerCase()
  if (/(^|\/)twilightecho\.exe$/.test(normalized)) candidates.push(path.dirname(exec))
  const coreIndex = normalized.lastIndexOf('/resources/core-node/runtime/')
  if (coreIndex > 0) candidates.push(exec.replace(/\\/g, '/').slice(0, coreIndex).split('/').join(path.sep))
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) candidates.push(path.dirname(process.resourcesPath))
  candidates.push('D:\\TwilightEcho', 'C:\\TwilightEcho', path.join('C:\\', 'Program Files', 'TwilightEcho'))
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(path.join(candidate, 'resources', 'app.asar'))) return path.resolve(candidate)
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

function hostVersion(asarPath) {
  try {
    const text = lite.readText(asarPath, 'package.json')
    return text ? JSON.parse(text).version || null : null
  } catch {
    return null
  }
}

export function bridgeVersionOf(text) {
  return Number((String(text || '').match(/BRIDGE_VERSION\s*=\s*(\d+)/) || [])[1] || 0)
}

function shippedBridgePath() {
  for (const rel of ['patch/we-background.js', 'bridge/we-background.js']) {
    const file = path.join(PLUGIN_ROOT, rel)
    if (fs.existsSync(file)) return file
  }
  return null
}

function isAppRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq TwilightEcho.exe', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000
    })
    return /TwilightEcho\.exe/i.test(out)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ 检查 */

/** 只读检查：返回宿主当前桥状态。 */
export function inspectBridge(appDir) {
  const asarPath = path.join(appDir, 'resources', 'app.asar')
  const result = {
    asarPath,
    version: null,
    bridgePresent: false,
    bridgeVersion: 0,
    entry: false,
    csp: false,
    shipped: bridgeVersionOf(readFileSafe(shippedBridgePath())),
    ok: false
  }
  try {
    result.version = hostVersion(asarPath)
    const bridge = lite.readText(asarPath, 'out/renderer/we-background.js') || ''
    result.bridgePresent = Boolean(bridge)
    result.bridgeVersion = bridgeVersionOf(bridge)
    const index = lite.readText(asarPath, 'out/renderer/index.html') || ''
    result.entry = index.includes('we-background.js')
    result.csp = index.includes('127.0.0.1:3100')
  } catch (error) {
    result.error = error && error.message ? error.message : String(error)
  }
  result.ok = Boolean(
    result.entry && result.csp && result.bridgeVersion >= Math.max(SHIPPED_BRIDGE_MIN, result.shipped || 0)
  )
  return result
}

function readFileSafe(file) {
  if (!file) return ''
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ 补丁 */

function patchIndexHtml(html) {
  let out = html
  for (const directive of ['img-src', 'media-src', 'frame-src', 'connect-src']) {
    const re = new RegExp(`(${directive} [^;"\`]*)`)
    out = out.replace(re, (match) => (match.includes(ORIGIN) ? match : `${match} ${ORIGIN}`))
  }
  if (!out.includes('we-background.js')) {
    out = out.replace(/<\/head>/i, `  <!-- te-we-bridge -->\n  <script type="module" src="./we-background.js"></script>\n</head>`)
  }
  return out
}

function patchMainCsp(main) {
  let out = main
  for (const directive of ['frame-src', 'img-src', 'media-src']) {
    const re = new RegExp(`(["'\`])${directive} ([^"'\`]*)`, 'g')
    out = out.replace(re, (match, quote, body) => (body.includes('127.0.0.1:3100') ? match : `${quote}${directive} ${body} ${ORIGIN}`))
  }
  return out
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)) }

function replaceAtomic(source, target) {
  const staging = `${target}.te-new`
  fs.copyFileSync(source, staging)
  let lastError = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.renameSync(staging, target)
      return
    } catch (error) {
      lastError = error
      sleepSync(1500)
    }
  }
  try {
    fs.copyFileSync(staging, target)
    fs.rmSync(staging, { force: true })
    return
  } catch (error) {
    lastError = lastError || error
  }
  throw new Error(`替换 app.asar 失败：${lastError && lastError.message}`)
}

/** 打补丁；返回 { status, changes }。 */
export function adaptBridge(appDir, { dryRun = false } = {}) {
  const asarPath = path.join(appDir, 'resources', 'app.asar')
  const before = inspectBridge(appDir)
  const changes = []
  const bridgeFile = shippedBridgePath()
  const bridgeText = readFileSafe(bridgeFile)
  if (!bridgeText) throw new Error(`缺少桥文件（patch/we-background.js）`)
  const shippedVersion = bridgeVersionOf(bridgeText)

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'te-we-adapt-'))
  const unpacked = path.join(tempRoot, 'app')
  const staged = path.join(tempRoot, 'app.asar')
  try {
    lite.extractAll(asarPath, unpacked)
    const header = lite.readHeader(asarPath).header
    const renderer = path.join(unpacked, 'out', 'renderer')

    const hostBridge = readFileSafe(path.join(renderer, 'we-background.js'))
    const hostBridgeVersion = bridgeVersionOf(hostBridge)
    if (hostBridgeVersion >= shippedVersion && hostBridgeVersion >= SHIPPED_BRIDGE_MIN) {
      changes.push({ id: 'bridge.copy', ok: true, detail: `宿主桥 v${hostBridgeVersion} 已足够` })
    } else {
      fs.mkdirSync(renderer, { recursive: true })
      fs.writeFileSync(path.join(renderer, 'we-background.js'), bridgeText, 'utf8')
      changes.push({ id: 'bridge.copy', ok: true, detail: `桥 v${hostBridgeVersion || 0} → v${shippedVersion}` })
    }

    const indexPath = path.join(renderer, 'index.html')
    const indexBefore = readFileSafe(indexPath)
    const indexAfter = patchIndexHtml(indexBefore)
    if (indexAfter !== indexBefore) fs.writeFileSync(indexPath, indexAfter, 'utf8')
    changes.push({
      id: 'bridge.entry',
      ok: indexAfter.includes('we-background.js') && indexAfter.includes('127.0.0.1:3100'),
      detail: indexAfter !== indexBefore ? 'index.html 入口 + CSP' : 'entry/CSP 已存在'
    })

    const mainPath = path.join(unpacked, 'out', 'main', 'index.js')
    const mainBefore = readFileSafe(mainPath)
    const mainAfter = patchMainCsp(mainBefore)
    if (mainAfter !== mainBefore) fs.writeFileSync(mainPath, mainAfter, 'utf8')
    changes.push({ id: 'bridge.main-csp', ok: true, detail: mainAfter !== mainBefore ? '主进程 CSP 追加 3100' : '主进程 CSP 已含 3100' })

    if (dryRun) return { status: 'dry-run', appDir, hostVersion: before.version, changes }

    lite.pack(unpacked, staged, { preserve: header })
    const check = inspectArchiveBridge(staged)
    if (!check.ok) return { status: 'blocked', appDir, changes, note: check.detail }
    changes.push({ id: 'bridge.verify', ok: true, detail: check.detail })

    const backup = `${asarPath}.te-we-backup-${before.version || 'unknown'}`
    const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    let needsBackup = !fs.existsSync(backup)
    if (!needsBackup && !before.entry) {
      try {
        if (sha(backup) !== sha(asarPath)) needsBackup = true
      } catch {
        needsBackup = true
      }
    }
    if (needsBackup) {
      fs.copyFileSync(asarPath, backup)
      // 兼容旧文档/旧安装器：始终维护一份不带版本号的备份
      try {
        fs.copyFileSync(asarPath, `${asarPath}.te-we-backup`)
      } catch {
        /* 忽略 */
      }
      changes.push({ id: 'bridge.backup', ok: true, detail: path.basename(backup) })
    }
    replaceAtomic(staged, asarPath)
    changes.push({ id: 'bridge.write', ok: true, detail: `${Math.round(fs.statSync(asarPath).size / 1024 / 1024)} MB` })

    const after = inspectBridge(appDir)
    writeJson(statePath(), {
      hostVersion: after.version,
      bridgeVersion: after.bridgeVersion,
      patchedAt: new Date().toISOString(),
      appDir,
      backup,
      status: after.ok ? 'adapted' : 'partial'
    })
    appendLog(`适配完成 v${after.version} bridge=v${after.bridgeVersion} ok=${after.ok}`)
    return { status: after.ok ? 'adapted' : 'partial', appDir, hostVersion: after.version, bridgeVersion: after.bridgeVersion, changes }
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function inspectArchiveBridge(file) {
  try {
    const bridge = lite.readText(file, 'out/renderer/we-background.js') || ''
    const index = lite.readText(file, 'out/renderer/index.html') || ''
    if (!bridge) return { ok: false, detail: '回读缺少 we-background.js' }
    if (!index.includes('we-background.js')) return { ok: false, detail: '回读 index.html 缺入口' }
    if (!index.includes('127.0.0.1:3100')) return { ok: false, detail: '回读 CSP 未放行 3100' }
    return { ok: true, detail: `桥 v${bridgeVersionOf(bridge)} / 入口 / CSP 齐备` }
  } catch (error) {
    return { ok: false, detail: `回读异常：${error.message}` }
  }
}

/* -------------------------------------------------------------- 自愈入口 */

function resolveNodeExe(appDir) {
  const candidates = [
    appDir && path.join(appDir, 'resources', 'core-node', 'runtime', 'node.exe'),
    appDir && path.join(appDir, 'resources', 'core-node', 'runtime', 'node')
  ].filter(Boolean)
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return file
    } catch {
      /* ignore */
    }
  }
  if (/(^|[\\/])node(\.exe)?$/i.test(process.execPath)) return process.execPath
  return null
}

/** 拉起适配器（脱离应用进程，等宿主退出后再打补丁）。 */
export function spawnBridgeAdapter({ appDir, wait = true, logger } = {}) {
  const dir = appDir || detectAppDir()
  if (!dir) return { ok: false, detail: '找不到 Twilight Echo 安装目录' }
  const nodeExe = resolveNodeExe(dir)
  if (!nodeExe) return { ok: false, detail: '找不到可用 node.exe' }
  const script = path.join(SCRIPT_DIR, 'bridge-adapt.mjs')
  if (!fs.existsSync(script)) return { ok: false, detail: '适配器脚本缺失' }
  const args = [script, '--app', dir, '--auto', '--wait-exit']
  try {
    const { spawn } = require('node:child_process')
    const child = spawn(nodeExe, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
    })
    child.unref()
    appendLog(`已拉起桥适配器 pid=${child.pid} wait=${wait}`)
    logger?.info?.(`[bridge-adapt] 已排队（pid ${child.pid}）`)
    return { ok: true, pid: child.pid }
  } catch (error) {
    appendLog(`拉起失败：${error.message}`)
    return { ok: false, detail: error.message }
  }
}

/**
 * 启动时调用：宿主桥缺失/版本低就排队自愈。
 * 返回 'ready' | 'queued' | 'unknown'。
 */
export function ensureBridgeAdapt({ logger } = {}) {
  let check
  try {
    const appDir = detectAppDir()
    if (!appDir) return { status: 'unknown' }
    check = inspectBridge(appDir)
    if (check.ok) {
      logger?.debug?.(`[bridge-adapt] 宿主桥 v${check.bridgeVersion} 正常`)
      return { status: 'ready', bridgeVersion: check.bridgeVersion }
    }
    const state = readJson(statePath(), null)
    if (state && state.status === 'partial' && Date.now() - Date.parse(state.patchedAt || '') < 6 * 60 * 60 * 1000) {
      return { status: 'failed' }
    }
    const spawned = spawnBridgeAdapter({ appDir, wait: true, logger })
    if (!spawned.ok) return { status: 'unknown', detail: spawned.detail }
    appendLog(`检测：entry=${check.entry} csp=${check.csp} bridge=v${check.bridgeVersion} → 已排队`)
    return { status: 'queued' }
  } catch (error) {
    logger?.warn?.(`[bridge-adapt] 检查失败：${error.message}`)
    return { status: 'unknown' }
  }
}

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const flags = new Set()
  const values = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      values[key] = next
      i += 1
    } else flags.add(key)
  }
  return { flags, values }
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2))
  const appDir = detectAppDir(values.app)
  if (!appDir) throw new Error('找不到 Twilight Echo 安装目录，用 --app 指定')
  const asarPath = path.join(appDir, 'resources', 'app.asar')

  if (flags.has('revert')) {
    const version = hostVersion(asarPath)
    const backup = values.backup || [`${asarPath}.te-we-backup-${version}`, `${asarPath}.te-backup-${version}`].find((f) => fs.existsSync(f))
    if (!backup) throw new Error('没有可用的 we-backup')
    const current = inspectBridge(appDir)
    fs.copyFileSync(backup, asarPath)
    writeJson(statePath(), { hostVersion: version, status: 'reverted', patchedAt: new Date().toISOString(), appDir })
    appendLog(`已还原 asar：${path.basename(backup)}`)
    return { status: 'reverted', backup: path.basename(backup), wasAdapted: current.ok }
  }

  if (flags.has('wait-exit')) {
    const deadline = Date.now() + 12 * 60 * 60 * 1000
    while (isAppRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4000))
    }
    if (isAppRunning()) return { status: 'timeout' }
  }

  if (flags.has('auto')) {
    const check = inspectBridge(appDir)
    if (check.ok) return { status: 'up-to-date', hostVersion: check.version, bridgeVersion: check.bridgeVersion }
  }

  return adaptBridge(appDir, { dryRun: flags.has('dry-run') })
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
      if (result?.status === 'blocked') process.exitCode = 2
    })
    .catch((error) => {
      appendLog(`异常 ${error && error.stack ? error.stack : error}`)
      console.error(`[bridge-adapt] 失败：${error && error.message ? error.message : error}`)
      process.exitCode = 1
    })
}
