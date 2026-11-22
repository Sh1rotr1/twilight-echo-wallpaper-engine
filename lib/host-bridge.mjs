#!/usr/bin/env node
/**
 * Read-only inspection of the Twilight Echo host renderer bridge.
 *
 * The plugin never writes resources/app.asar and never queues a patch process.
 * This module only answers "which bridge does the running host ship?" so the
 * plugin can enable the features that bridge actually supports.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const lite = require('./asar-lite.cjs')

/** Lowest host bridge this plugin supports. */
export const NATIVE_BRIDGE_VERSION = 5

const ORIGIN = 'http://127.0.0.1:3100'

export function bridgeVersionOf(text) {
  return Number((String(text || '').match(/BRIDGE_VERSION\s*=\s*(\d+)/) || [])[1] || 0)
}

export function detectAppDir(explicit) {
  const candidates = []
  if (explicit) candidates.push(explicit)
  if (process.env.TE_APP_DIR) candidates.push(process.env.TE_APP_DIR)
  const exec = String(process.execPath || '')
  const normalized = exec.replace(/\\/g, '/').toLowerCase()
  if (/(^|\/)twilightecho\.exe$/.test(normalized)) candidates.push(path.dirname(exec))
  const coreIndex = normalized.lastIndexOf('/resources/core-node/runtime/')
  if (coreIndex > 0) candidates.push(exec.replace(/\\/g, '/').slice(0, coreIndex).split('/').join(path.sep))
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(path.dirname(process.resourcesPath))
  }
  candidates.push('D:\\TwilightEcho', 'C:\\TwilightEcho', path.join('C:\\', 'Program Files', 'TwilightEcho'))
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(path.join(candidate, 'resources', 'app.asar'))) return path.resolve(candidate)
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

function readText(archive, rel) {
  try {
    return lite.readText(archive, rel) || ''
  } catch {
    return ''
  }
}

/**
 * Returns a small capability record. Never throws and never writes.
 *
 * mode:
 *   native     = host bridge >= 5 (wallpapers, props, mini/playback surface)
 *   unsupported = bridge present but too old
 *   missing    = no bridge file / no renderer entry / no CSP allowance
 *   unknown    = could not find the installation
 */
export function inspectHostBridge(explicitDir) {
  const appDir = detectAppDir(explicitDir)
  const result = {
    appDir,
    hostVersion: null,
    mode: 'unknown',
    bridgeVersion: 0,
    entry: false,
    csp: false,
    origin: ORIGIN
  }
  if (!appDir) return result
  const asarPath = path.join(appDir, 'resources', 'app.asar')
  try {
    const pkg = readText(asarPath, 'package.json')
    if (pkg) result.hostVersion = JSON.parse(pkg).version || null
  } catch {
    /* keep null */
  }
  const bridge = readText(asarPath, path.join('out', 'renderer', 'we-background.js'))
  const index = readText(asarPath, path.join('out', 'renderer', 'index.html'))
  result.bridgeVersion = bridgeVersionOf(bridge)
  result.entry = index.includes('we-background.js')
  result.csp = index.includes('127.0.0.1:3100')
  if (!bridge || !result.entry || !result.csp) result.mode = 'missing'
  else if (result.bridgeVersion >= NATIVE_BRIDGE_VERSION) result.mode = 'native'
  else result.mode = 'unsupported'
  return result
}
