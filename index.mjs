import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractSceneVideo, buildSceneManifest, buildSceneManifestFromDir, extractSceneResource, extractSceneResourceFromDir, decodePngToRgba, encodePng } from './lib/scene-manifest.js'
import { parseUserPropDefs, filterKnownOverrides, entryDirPrefix } from './lib/we-props.js'
import { WE_SCENE_PLAYER_HTML } from './lib/scene-player.js'

const WE_APPID = '431960'
const CACHE_TTL_MS = 30_000
const MAX_SELECT_OPTIONS = 30

const DEFAULT_STATE = {
  q: '',
  selected: '',
  monitor: '0',
  extraDir: '',
  autoApply: 'on',
  lastProject: '',
  lastTitle: '',
  rev: 1,
  scrim: '20',
  fit: 'cover',
  quality: 'original',
  interactive: false,
  offsetX: '0',
  offsetY: '0',
  offsetZ: '0',
  zoom: '100',
  userProps: {},
  sceneVideo: '',
  sceneRuntime: '',
  paused: false
}

let context = null
let state = { ...DEFAULT_STATE }
let cache = { at: 0, items: [] }
let autoApplyTimer = null
const sceneJobs = new Set()
const scenePkgCache = new Map()
const WWGL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'webwallgl')

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function readJsonFile(file) {
  return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')))
}

function exists(file) {
  try {
    return fs.existsSync(file)
  } catch {
    return false
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function run(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
}

function log(level, message) {
  try {
    context?.logger?.[level]?.(message)
  } catch {
    /* ignore */
  }
}

async function notify(kind, message) {
  try {
    if (typeof context?.twilight?.ui?.notify === 'function') {
      await context.twilight.ui.notify({ kind, message, durationMs: 6000 })
    }
  } catch {
    /* older host */
  }
}

/* ------------------------------- Steam / WE ------------------------------- */

function registrySteamPath() {
  if (process.platform !== 'win32') return null
  for (const [key, value] of [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath']
  ]) {
    try {
      const match = new RegExp(`${value}\\s+REG_SZ\\s+(.+)`, 'i').exec(run('reg', ['query', key, '/v', value]))
      if (match) return path.win32.normalize(match[1].trim())
    } catch {
      /* missing */
    }
  }
  return null
}

function libraryPathsFromVdf(vdfFile) {
  try {
    const text = stripBom(fs.readFileSync(vdfFile, 'utf8'))
    const result = []
    for (const line of text.split(/\r?\n/)) {
      const match = /"path"\s+"([^"]+)"/i.exec(line)
      if (match) result.push(path.win32.normalize(match[1].replace(/\\\\/g, '\\')))
    }
    return result
  } catch {
    return []
  }
}

function steamRoots() {
  const roots = new Set()
  const push = (value) => {
    if (!value) return
    const normalized = path.win32.normalize(value)
    if (isDir(normalized)) roots.add(normalized)
  }
  push(process.env.STEAM_ROOT)
  push(registrySteamPath())
  for (const drive of ['C:', 'D:', 'E:', 'F:']) {
    push(`${drive}\\Program Files (x86)\\Steam`)
    push(`${drive}\\Program Files\\Steam`)
    push(`${drive}\\Steam`)
    push(`${drive}\\SteamLibrary`)
  }
  for (const root of [...roots]) {
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf')
    for (const library of libraryPathsFromVdf(vdf)) push(library)
  }
  return [...roots]
}

function findWeInstall() {
  const candidates = []
  for (const root of steamRoots()) candidates.push(path.join(root, 'steamapps', 'common', 'wallpaper_engine'))
  candidates.push('D:\\SteamLibrary\\steamapps\\common\\wallpaper_engine')
  for (const candidate of candidates) if (isDir(candidate)) return candidate
  for (const config of candidates.map((dir) => path.join(dir, 'config.json')).filter(exists)) {
    try {
      const install = readJsonFile(config)['?installdirectory']
      if (install && isDir(install)) return path.win32.normalize(install)
    } catch {
      /* ignore */
    }
  }
  return null
}

function workshopRoots() {
  const roots = []
  for (const root of steamRoots()) {
    const workshop = path.join(root, 'steamapps', 'workshop', 'content', WE_APPID)
    if (isDir(workshop)) roots.push(workshop)
  }
  return roots
}

function weExecutable(weDir) {
  if (!weDir) return null
  return [path.join(weDir, 'wallpaper64.exe'), path.join(weDir, 'wallpaper32.exe')].find(exists) ?? null
}

/* --------------------------------- 扫描 ---------------------------------- */

function collectProjectDirs(root, depth = 2) {
  const found = []
  if (!isDir(root)) return found
  if (exists(path.join(root, 'project.json'))) {
    found.push(root)
    return found
  }
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || entry.name === 'templates') continue
    const child = path.join(root, entry.name)
    if (exists(path.join(child, 'project.json'))) {
      found.push(child)
    } else if (depth > 1) {
      let inner = []
      try {
        inner = fs.readdirSync(child, { withFileTypes: true })
      } catch {
        inner = []
      }
      for (const sub of inner) {
        if (!sub.isDirectory()) continue
        const subDir = path.join(child, sub.name)
        if (exists(path.join(subDir, 'project.json'))) found.push(subDir)
      }
    }
  }
  return found
}

function projectRoots() {
  const roots = []
  for (const workshop of workshopRoots()) roots.push(...collectProjectDirs(workshop, 1))
  const weDir = findWeInstall()
  if (weDir) {
    roots.push(...collectProjectDirs(path.join(weDir, 'projects', 'myprojects'), 2))
    roots.push(...collectProjectDirs(path.join(weDir, 'projects', 'defaultprojects'), 1))
  }
  for (const dir of String(state.extraDir || '').split(';').map((item) => item.trim()).filter(Boolean)) {
    roots.push(...collectProjectDirs(dir, 2))
  }
  return [...new Set(roots)]
}

const TYPE_ORDER = { video: 0, scene: 1, web: 2, application: 3 }
const TYPE_LABEL = { video: '视频', scene: '场景', web: '网页', application: '应用' }

function plainLabel(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function readWallpaper(dir) {
  const projectPath = path.join(dir, 'project.json')
  let project
  try {
    project = readJsonFile(projectPath)
  } catch {
    return null
  }
  if (!project || typeof project !== 'object' || !project.file) return null
  let preview = ''
  if (typeof project.preview === 'string' && project.preview) {
    const candidate = path.join(dir, project.preview)
    if (exists(candidate)) preview = candidate
  }
  if (!preview) {
    for (const name of ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp']) {
      const candidate = path.join(dir, name)
      if (exists(candidate)) { preview = candidate; break }
    }
  }
  let realDir = dir
  try { realDir = fs.realpathSync(dir) } catch { /* keep */ }
  const canonical = realDir.toLowerCase()
  const type = String(project.type || 'scene').toLowerCase()
  return {
    id: createHash('sha1').update(canonical).digest('hex').slice(0, 16),
    title: String(project.title || path.basename(dir)).trim(),
    type,
    dir: realDir,
    projectPath: path.join(realDir, 'project.json'),
    file: String(project.file),
    preview,
    hasProps: type !== 'video' && Object.keys(project.general?.properties || {}).length > 0,
    workshopid: /[\\/]431960[\\/]([^\\/]+)/.exec(dir)?.[1] ?? ''
  }
}

function scanWallpapers(force = false) {
  if (!force && cache.items.length > 0 && Date.now() - cache.at < CACHE_TTL_MS) return cache.items
  const seen = new Set()
  const items = []
  for (const dir of projectRoots()) {
    const item = readWallpaper(dir)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  items.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.title.localeCompare(b.title, 'zh-CN'))
  cache = { at: Date.now(), items }
  return items
}

function findWallpaper(id, force = false) {
  return scanWallpapers(force).find((item) => item.id === id) ?? null
}

function filterWallpapers(items, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => {
    const haystack = `${item.title} ${item.type} ${TYPE_LABEL[item.type] ?? ''} ${item.workshopid}`.toLowerCase()
    return q.split(/\s+/).every((token) => haystack.includes(token))
  })
}

function labelFor(item) {
  const type = TYPE_LABEL[item.type] ?? item.type
  const title = item.title.length > 64 ? `${item.title.slice(0, 63)}…` : item.title
  return `[${type}] ${title}`
}

/* --------------------------- 本地媒体服务 --------------------------- */

const SERVER_PORT = 3100
const SERVER_HOST = '127.0.0.1'
let server = null

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2'
}

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

function projectFile(item) {
  const file = path.resolve(item.dir, item.file)
  return file.startsWith(path.resolve(item.dir) + path.sep) ? file : null
}

function safeJoin(root, relative) {
  const target = path.resolve(root, path.normalize(relative).replace(/^([/\\])+/, ''))
  const base = path.resolve(root) + path.sep
  return target.startsWith(base) || target === path.resolve(root) ? target : null
}

function serveFile(req, res, file) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    res.writeHead(404); res.end('Not Found'); return
  }
  const headers = { 'Content-Type': contentType(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': stat.size }
  const range = req.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim())
    if (match) {
      let start = match[1] === '' ? null : Number(match[1])
      let end = match[2] === '' ? null : Number(match[2])
      if (start === null && end !== null) { start = Math.max(0, stat.size - end); end = stat.size - 1 }
      else { if (start === null) start = 0; if (end === null || end >= stat.size) end = stat.size - 1 }
      if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
      headers['Content-Length'] = end - start + 1
      res.writeHead(206, headers)
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(file, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

function capTexture(buf, max = 2048) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return buf
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return buf
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (!width || !height || (width <= max && height <= max)) return buf
  try {
    const { width: w, height: h, rgba } = decodePngToRgba(new Uint8Array(buf))
    const scale = Math.min(max / w, max / h)
    const nw = Math.max(1, Math.floor(w * scale))
    const nh = Math.max(1, Math.floor(h * scale))
    const out = Buffer.alloc(nw * nh * 4)
    for (let y = 0; y < nh; y += 1) {
      const sy = Math.min(h - 1, Math.floor(y * h / nh))
      for (let x = 0; x < nw; x += 1) {
        const sx = Math.min(w - 1, Math.floor(x * w / nw))
        const si = (sy * w + sx) * 4
        const di = (y * nw + x) * 4
        out[di] = rgba[si]
        out[di + 1] = rgba[si + 1]
        out[di + 2] = rgba[si + 2]
        out[di + 3] = rgba[si + 3]
      }
    }
    return Buffer.from(encodePng(nw, nh, out))
  } catch {
    return buf
  }
}

function bridgeState() {
  const item = state.selected ? findWallpaper(state.selected) : null
  if (!item) return { active: false, rev: Number(state.rev) || 0 }
  const payload = {
    active: true,
    rev: Number(state.rev) || 0,
    id: item.id,
    type: item.type,
    title: item.title,
    preview: `/preview/${item.id}`,
    paused: state.paused === true,
    scrim: Number(state.scrim) || 0,
    fit: state.fit === 'contain' || state.fit === 'fill' ? state.fit : 'cover',
    quality: ['1080', '720'].includes(String(state.quality)) ? String(state.quality) : 'original',
    interactive: state.interactive === true,
    offsetX: Number(state.offsetX) || 0,
    offsetY: Number(state.offsetY) || 0,
    offsetZ: Number(state.offsetZ) || 0,
    zoom: Number(state.zoom) || 100,
    scene: item.type === 'scene'
  }
  if (item.type === 'video') payload.url = `/media/${item.id}`
  else if (item.type === 'web') payload.url = `/web/${item.id}/index.html`
  else if (item.type === 'scene') {
    const fit = state.fit === 'contain' ? 'contain' : state.fit === 'fill' ? 'stretch' : 'cover'
    const fps = state.quality === '720' ? 30 : state.quality === '1080' ? 30 : 60
    payload.type = 'web'
    payload.url = `/scene-live/index.html?type=scene&src=${encodeURIComponent(item.id)}&mediaBase=${encodeURIComponent('/scene-files')}&fit=${fit}&sceneFps=${fps}&muted=true&renderDpr=1`
  }
  return payload
}

function handleRequest(req, res) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
  }
  for (const [key, value] of Object.entries(cors)) res.setHeader(key, value)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  let url
  try { url = new URL(req.url, `http://${SERVER_HOST}:${SERVER_PORT}`) } catch { res.writeHead(400); res.end(); return }
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === '/api/layout' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}')
        if (payload.offsetX != null) state.offsetX = String(Math.max(-100, Math.min(100, Number(payload.offsetX) || 0)))
        if (payload.offsetY != null) state.offsetY = String(Math.max(-100, Math.min(100, Number(payload.offsetY) || 0)))
        if (payload.offsetZ != null) state.offsetZ = String(Math.max(-1000, Math.min(1000, Number(payload.offsetZ) || 0)))
        if (payload.zoom != null) state.zoom = String(Math.max(50, Math.min(200, Number(payload.zoom) || 100)))
        state.rev = (Number(state.rev) || 0) + 1
        await persist()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true }))
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
      }
    })
    return
  }

  if (pathname === '/diag') {
    res.writeHead(204)
    res.end()
    return
  }
  if (pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(bridgeState()))
    return
  }
  if (pathname === '/api/wallpapers') {
    const items = scanWallpapers()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ total: items.length, selected: state.selected, state: { fit: state.fit, scrim: state.scrim, quality: state.quality, paused: state.paused }, items: items.slice(0, 500).map((item) => ({ id: item.id, title: item.title, type: item.type, hasWidgets: item.hasProps === true })) }))
    return
  }
  const propsGet = /^\/api\/props\/([a-f0-9]{16})$/.exec(pathname)
  if (propsGet) {
    const item = findWallpaper(propsGet[1])
    if (!item) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'unknown' })); return }
    const { props, overrides, hasProject } = item.type === 'scene' || item.type === 'web'
      ? propsFor(item)
      : { props: [], overrides: {}, hasProject: false }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, id: item.id, props, overrides, hasProject }))
    return
  }
  if (pathname === '/api/props/reset' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}')
        const item = findWallpaper(String(payload.id || ''), true)
        if (!item) throw new Error('壁纸不存在')
        delete state.userProps[item.id]
        await persist()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, props: propsFor(item).props }))
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
      }
    })
    return
  }
  if (pathname === '/api/props' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}')
        const item = findWallpaper(String(payload.id || ''), true)
        if (!item || !payload.name) throw new Error('参数不完整')
        if (item.type !== 'scene' && item.type !== 'web') throw new Error('该壁纸没有可调属性')
        const name = String(payload.name)
        const current = propsFor(item).props.find((property) => property.name === name)
        if (!current) throw new Error('属性不存在')
        const def = parseUserPropDefs(propsFor(item).project, {}).find((property) => property.name === name)
        const fallback = def ? def.default : null
        state.userProps[item.id] = state.userProps[item.id] || {}
        if (payload.value === fallback || (typeof payload.value === 'number' && Number(fallback) === payload.value)) {
          delete state.userProps[item.id][name]
        } else {
          state.userProps[item.id][name] = payload.value
        }
        if (Object.keys(state.userProps[item.id]).length === 0) delete state.userProps[item.id]
        await persist()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, props: propsFor(item).props }))
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
      }
    })
    return
  }
  if ((pathname === '/api/apply' || pathname === '/api/control') && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}')
        if (pathname === '/api/apply') {
          const item = findWallpaper(String(payload.id || ''), true)
          if (!item) throw new Error('壁纸不存在')
          if (payload.scrim != null) state.scrim = ['0', '20', '35', '50'].includes(String(payload.scrim)) ? String(payload.scrim) : state.scrim
          if (payload.fit != null) state.fit = ['cover', 'contain', 'fill'].includes(String(payload.fit)) ? String(payload.fit) : state.fit
          if (payload.quality != null) state.quality = ['original', '1080', '720'].includes(String(payload.quality)) ? String(payload.quality) : state.quality
          if (payload.offsetX != null) state.offsetX = String(Math.max(-100, Math.min(100, Number(payload.offsetX) || 0)))
          if (payload.offsetY != null) state.offsetY = String(Math.max(-100, Math.min(100, Number(payload.offsetY) || 0)))
          if (payload.offsetZ != null) state.offsetZ = String(Math.max(-1000, Math.min(1000, Number(payload.offsetZ) || 0)))
          if (payload.zoom != null) state.zoom = String(Math.max(50, Math.min(200, Number(payload.zoom) || 100)))
          await applyWallpaper(item, state.monitor)
        } else {
          const action = String(payload.action || '')
          if (action === 'pause') state.paused = true
          else if (action === 'resume') state.paused = false
          else if (action === 'stop') { state.selected = ''; state.paused = false; state.interactive = false }
          else if (action === 'interact') {
            const item = findWallpaper(state.selected)
            if (item?.type !== 'web') throw new Error('仅网页壁纸支持交互')
            state.interactive = !state.interactive
          }
          else throw new Error('未知操作')
          state.rev = (Number(state.rev) || 0) + 1
          await persist()
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, state: bridgeState() }))
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
      }
    })
    return
  }
  const media = /^\/media\/([a-f0-9]{16})$/.exec(pathname)
  if (media) {
    const item = findWallpaper(media[1])
    const file = item?.type === 'video' ? projectFile(item) : null
    if (!file || !exists(file)) { res.writeHead(404); res.end('Not Found'); return }
    serveFile(req, res, file); return
  }
  const preview = /^\/preview\/([a-f0-9]{16})$/.exec(pathname)
  if (preview) {
    const item = findWallpaper(preview[1])
    if (!item?.preview || !exists(item.preview)) { res.writeHead(404); res.end('Not Found'); return }
    serveFile(req, res, item.preview); return
  }
  const sceneVideo = /^\/scene-video\/([a-f0-9]{16})$/.exec(pathname)
  if (sceneVideo) {
    const file = path.join(context.storagePath, 'cache', `${sceneVideo[1]}.mp4`)
    if (!exists(file)) { res.writeHead(404); res.end('Not Found'); return }
    serveFile(req, res, file); return
  }
  if (/^\/wallpaper-engine\/scene-runtime\/[a-f0-9]{16}$/.test(pathname)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(WE_SCENE_PLAYER_HTML)
    return
  }
  if (pathname.startsWith('/scene-live/')) {
    let rel = pathname.slice('/scene-live/'.length)
    if (!rel || rel.endsWith('/')) rel += 'index.html'
    const file = safeJoin(WWGL_DIR, rel)
    if (!file || !exists(file)) { res.writeHead(404); res.end('Not Found'); return }
    serveFile(req, res, file)
    return
  }
  const sceneFile = /^\/scene-files\/([a-f0-9]{16})\/(.+)$/.exec(pathname)
  if (sceneFile) {
    const item = findWallpaper(sceneFile[1])
    if (!item) { res.writeHead(404); res.end('Not Found'); return }
    const file = safeJoin(item.dir, sceneFile[2])
    if (!file || !exists(file)) { res.writeHead(404); res.end('Not Found'); return }
    serveFile(req, res, file)
    return
  }

  const sceneManifest = /^\/wallpaper-engine\/scene-manifest\/([a-f0-9]{16})$/.exec(pathname)
  if (sceneManifest) {
    const id = sceneManifest[1]
    const item = findWallpaper(id)
    if (!item) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'unknown' })); return }
    log('info', `scene manifest request ${id}`)
    try {
      const cacheDir = path.join(context.storagePath, 'cache')
      fs.mkdirSync(cacheDir, { recursive: true })
      const cacheFile = path.join(cacheDir, `${id}.scene.json`)
      let manifest
      if (exists(cacheFile)) {
        manifest = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      } else {
        const pkg = path.join(item.dir, 'scene.pkg')
        manifest = exists(pkg)
          ? buildSceneManifest(new Uint8Array(fs.readFileSync(pkg)), id)
          : buildSceneManifestFromDir(item.dir, id)
        if (manifest) fs.writeFileSync(cacheFile, JSON.stringify(manifest), 'utf8')
      }
      if (!manifest) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'manifest' })); return }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, manifest }))
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }))
    }
    return
  }
  const sceneResource = /^\/wallpaper-engine\/scene-resource\/([a-f0-9]{16})\/(.+)$/.exec(pathname)
  if (sceneResource) {
    const id = sceneResource[1]
    const subpath = sceneResource[2]
    const item = findWallpaper(id)
    if (!item) { res.writeHead(404); res.end('Not Found'); return }
    try {
      const texDir = path.join(context.storagePath, 'cache', 'tex', id)
      const texKey = createHash('sha1').update(subpath).digest('hex')
      const texFile = path.join(texDir, `${texKey}.png`)
      let buf
      if (exists(texFile)) {
        buf = fs.readFileSync(texFile)
      } else {
        const pkgPath = path.join(item.dir, 'scene.pkg')
        let bytes
        if (exists(pkgPath)) {
          let buffer = scenePkgCache.get(id)
          if (!buffer) {
            buffer = fs.readFileSync(pkgPath)
            if (scenePkgCache.size >= 2) scenePkgCache.clear()
            scenePkgCache.set(id, buffer)
          }
          bytes = extractSceneResource(new Uint8Array(buffer), subpath)
        } else {
          bytes = extractSceneResourceFromDir(item.dir, subpath)
        }
        if (!bytes) { res.writeHead(404); res.end('Not Found'); return }
        buf = capTexture(Buffer.from(bytes))
        if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) {
          fs.mkdirSync(texDir, { recursive: true })
          fs.writeFileSync(texFile, buf)
        }
      }
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50
      res.writeHead(200, { 'Content-Type': isPng ? 'image/png' : 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(buf)
    } catch (error) {
      res.writeHead(500); res.end(String(error?.message || error))
    }
    return
  }
  const webRoot = /^\/web\/(?![a-f0-9]{16}\/)(.+)$/.exec(pathname)
  if (webRoot) {
    // web 壁纸常见写法：index.html 在项目根，脚本里用 `../assets/...` 等
    // 指向项目根目录的路径。页面挂在 /web/<id>/index.html 时浏览器会把
    // 它们解析成 /web/assets/...，这里统一映射回当前 web 壁纸的项目根。
    const selected = state.selected ? findWallpaper(state.selected) : null
    if (!selected || selected.type !== 'web') { res.writeHead(404); res.end('Not Found'); return }
    const file = safeJoin(selected.dir, decodeURIComponent(webRoot[1]))
    if (!file || !exists(file)) { res.writeHead(404); res.end('Not Found'); return }
    serveFile(req, res, file)
    return
  }
  const web = /^\/web\/([a-f0-9]{16})\/(.*)$/.exec(pathname)
  if (web) {
    const item = findWallpaper(web[1])
    if (!item || item.type !== 'web') { res.writeHead(404); res.end('Not Found'); return }
    const file = safeJoin(item.dir, web[2] || 'index.html')
    if (!file || !exists(file)) { res.writeHead(404); res.end('Not Found'); return }
    if (path.extname(file).toLowerCase() === '.html') {
      try {
        let html = fs.readFileSync(file, 'utf8')
        const mute = `<script>(function(){function m(){var n=document.querySelectorAll('audio,video');for(var i=0;i<n.length;i++){try{n[i].muted=true;n[i].volume=0}catch(e){}}}document.addEventListener('DOMContentLoaded',m);setInterval(m,1000);try{var C=window.AudioContext||window.webkitAudioContext;if(C&&!C.__teMute){var O=C;var W=function(){var c=new O();try{c.suspend()}catch(e){};return c};W.__teMute=true;window.AudioContext=W;if(window.webkitAudioContext)window.webkitAudioContext=W}}catch(e){}})();</script>`
        const propScript = `<script>(function(){var id=${JSON.stringify(item.id)};function applyProps(values){var props={};for(var k in values){if(Object.prototype.hasOwnProperty.call(values,k))props[k]={value:values[k]}}try{if(window.wallpaperPropertyListener&&window.wallpaperPropertyListener.applyUserProperties)window.wallpaperPropertyListener.applyUserProperties(props)}catch(e){}try{window.dispatchEvent(new CustomEvent('te-wallpaper-properties',{detail:props}))}catch(e){}}function pull(){fetch('/api/props/'+encodeURIComponent(id),{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(!d||!d.ok)return;var values={};for(var i=0;i<(d.props||[]).length;i++){var p=d.props[i];if(p.ptype==='group'||p.ptype==='text'||p.value===null||p.value===undefined)continue;values[p.name]=p.value}for(var k in d.overrides||{}){if(Object.prototype.hasOwnProperty.call(d.overrides,k))values[k]=d.overrides[k]}applyProps(values)}).catch(function(){})}window.addEventListener('message',function(e){var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='te-prop'&&d.name){var v={};v[d.name]=d.value;applyProps(v)}else if((d.type==='te-props'||d.type==='te-props-reset')&&d.values)applyProps(d.values)});window.addEventListener('load',pull)})();</script>`
        const injected = mute + propScript
        if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`)
        else html = injected + html
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(html)
      } catch {
        res.writeHead(500); res.end('Read failed')
      }
      return
    }
    serveFile(req, res, file); return
  }
  res.writeHead(404); res.end('Not Found')
}

function ensureServer() {
  if (server) return
  server = http.createServer(handleRequest)
  server.on('error', (error) => log('error', `媒体服务启动失败：${error?.message || error}`))
  server.listen(SERVER_PORT, SERVER_HOST, () => log('info', `媒体服务已启动：http://${SERVER_HOST}:${SERVER_PORT}`))
}

function closeServer() {
  if (!server) return
  try { server.close() } catch { /* ignore */ }
  server = null
}

/* ------------------------------ 应用壁纸 -------------------------------- */
// 更新插件状态，媒体由本地服务提供给界面底部图层。

function ensureSceneVideo(item) {
  if (!item || item.type !== 'scene' || sceneJobs.has(item.id)) return
  sceneJobs.add(item.id)
  setTimeout(() => {
    try {
      const cacheDir = path.join(context.storagePath, 'cache')
      fs.mkdirSync(cacheDir, { recursive: true })
      const target = path.join(cacheDir, `${item.id}.mp4`)
      if (!exists(target)) {
        const pkg = path.join(item.dir, 'scene.pkg')
        if (exists(pkg)) {
          const bytes = extractSceneVideo(fs.readFileSync(pkg))
          const head = bytes ? Buffer.from(bytes.subarray(0, 12)).toString('latin1') : ''
          if (bytes && bytes.length > 0 && head.includes('ftyp')) fs.writeFileSync(target, bytes)
        }
      }
      if (exists(target) && state.selected === item.id) {
        state.sceneVideo = target
        state.rev = (Number(state.rev) || 0) + 1
        void persist()
        log('info', `场景壁纸已加载：${item.title}`)
      }
    } catch (error) {
      log('warn', `场景壁纸加载失败：${error?.message || error}`)
    } finally {
      sceneJobs.delete(item.id)
    }
  }, 30)
}

function ensureSceneRuntime(item) {
  if (!item || item.type !== 'scene' || !context) return
  const key = `rt:${item.id}`
  if (sceneJobs.has(key)) return
  sceneJobs.add(key)
  setTimeout(() => {
    try {
      const cacheDir = path.join(context.storagePath, 'cache')
      fs.mkdirSync(cacheDir, { recursive: true })
      const cacheFile = path.join(cacheDir, `${item.id}.scene.json`)
      let ok = exists(cacheFile)
      if (!ok) {
        const pkg = path.join(item.dir, 'scene.pkg')
        const manifest = exists(pkg)
          ? buildSceneManifest(new Uint8Array(fs.readFileSync(pkg)), item.id)
          : buildSceneManifestFromDir(item.dir, item.id)
        if (manifest) {
          fs.writeFileSync(cacheFile, JSON.stringify(manifest), 'utf8')
          ok = true
        }
      }
      if (ok && state.selected === item.id) {
        state.sceneRuntime = `/wallpaper-engine/scene-runtime/${item.id}`
        state.rev = (Number(state.rev) || 0) + 1
        void persist()
        log('info', `场景渲染器已加载：${item.title}`)
      }
    } catch (error) {
      log('warn', `场景渲染器加载失败：${error?.message || error}`)
    } finally {
      sceneJobs.delete(key)
    }
  }, 30)
}

function propsFor(item) {
  let project = null
  try { project = readJsonFile(item.projectPath) } catch { /* keep null */ }
  const rawOverrides = state.userProps && typeof state.userProps === 'object' ? state.userProps[item.id] : null
  const overrides = filterKnownOverrides(project, rawOverrides || {})
  const files = []
  try {
    for (const entry of fs.readdirSync(item.dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) files.push(`${entry.name}/`)
      else if (files.length < 400) files.push(entry.name)
    }
  } catch { /* no list */ }
  const props = parseUserPropDefs(project, overrides, {
    filePrefix: entryDirPrefix(item.file),
    listFiles: files
  })
  return { project, props, overrides, hasProject: Boolean(project) }
}

async function applyWallpaper(item) {  if (!item) throw new Error('没有选中壁纸')
  if (item.type === 'video') {
    const file = projectFile(item)
    if (!file || !exists(file)) throw new Error('壁纸视频文件不存在')
    if (!['.mp4', '.webm', '.ogg'].includes(path.extname(file).toLowerCase())) throw new Error('该视频格式不能直接在应用内播放')
  }
  if (item.type === 'web') {
    const index = safeJoin(item.dir, 'index.html')
    if (!index || !exists(index)) throw new Error('网页壁纸缺少 index.html')
  }
  state.selected = item.id
  state.paused = false
  state.interactive = false
  state.lastProject = item.projectPath
  state.lastTitle = item.title
  state.rev = (Number(state.rev) || 0) + 1
  await persist()
  // 场景由 WebWallGL 在 /scene-live 直接读取 scene.pkg，不再预生成 manifest。
}

/* ------------------------------- 应用设置 -------------------------------- */

function appSettingsPath() {
  return path.join(process.env.APPDATA || '', 'TwilightEcho', 'settings.json')
}

function appTransparencyEnabled() {
  try {
    const settings = readJsonFile(appSettingsPath())
    return settings.windowTransparency === true
  } catch {
    return null
  }
}

async function persist() {
  try {
    await context.settings.set('state', state)
  } catch (error) {
    log('warn', `保存插件设置失败：${error?.message || error}`)
  }
}

async function loadState() {
  try {
    const saved = await context.settings.get('state')
    if (saved && typeof saved === 'object') state = { ...DEFAULT_STATE, ...saved }
  } catch {
    state = { ...DEFAULT_STATE }
  }
}

/* --------------------------------- 表单 ---------------------------------- */

function buildForm(noticeOverride) {
  const items = scanWallpapers()
  const filtered = filterWallpapers(items, state.q)
  const selectedItem = items.find((item) => item.id === state.selected) ?? null
  let options = filtered.slice(0, MAX_SELECT_OPTIONS).map((item) => ({ label: labelFor(item), value: item.id }))
  if (selectedItem && !options.some((option) => option.value === selectedItem.id)) {
    options = [{ label: labelFor(selectedItem), value: selectedItem.id }, ...options].slice(0, MAX_SELECT_OPTIONS)
  }
  if (options.length === 0) options = [{ label: '（没有匹配的壁纸，请修改筛选或扫描目录）', value: '' }]
  const current = options.some((option) => option.value === state.selected) ? state.selected : options[0].value
  const weDir = findWeInstall()
  const notice = noticeOverride
    ? String(noticeOverride).slice(0, 500)
    : [
        weDir ? `WE: ${weDir}` : '未找到 Wallpaper Engine',
        `共 ${items.length} 张，匹配 ${filtered.length} 张${filtered.length > MAX_SELECT_OPTIONS ? `（仅显示前 ${MAX_SELECT_OPTIONS} 张）` : ''}`,
        '壁纸与原画/1080P/720P、填充/暗化在 外观 → 动态壁纸 选择'
      ].join('\n')
  return {
    kind: 'settings-form',
    submitCommand: 'we.settings.save',
    notice,
    fields: [
      { key: 'q', label: '筛选壁纸', type: 'text', value: state.q, placeholder: '标题 / 类型（video、scene、web）/ 工坊 ID' },
      { key: 'wallpaper', label: '壁纸', type: 'select', value: current, options },
      {
        key: 'action',
        label: '操作',
        type: 'select',
        value: 'apply',
        options: [
          { label: '应用', value: 'apply' },
          { label: '仅刷新列表', value: 'refresh' },
          { label: '暂停', value: 'pause' },
          { label: '继续', value: 'resume' },
          { label: '关闭动态壁纸', value: 'stop' }
        ]
      },
      { key: 'extraDir', label: '额外壁纸目录', type: 'text', value: state.extraDir, placeholder: '多个目录用英文分号 ; 分隔' },
      {
        key: 'autoApply',
        label: '启动时自动恢复上次壁纸',
        type: 'select',
        value: state.autoApply,
        options: [
          { label: '开启', value: 'on' },
          { label: '关闭', value: 'off' }
        ]
      }
    ]
  }
}

/* -------------------------------- 生命周期 -------------------------------- */

export async function activate(ctx) {
  context = ctx
  await loadState()
  scanWallpapers(true)
  ensureServer()

  await context.twilight.ui.register({
    id: 'we-settings',
    kind: 'settingsPanel',
    title: 'Wallpaper Engine 动态背景',
    description: '在外观页选择壁纸、画质与填充；视频/网页播放并自动静音',
    icon: 'ph ph-monitor-play',
    command: 'we.settings',
    autoLoad: true
  })

  context.twilight.ui.onCommand('we.settings', async () => buildForm())

  context.twilight.ui.onCommand('we.settings.save', async (values = {}) => {
    if (values.q != null) state.q = String(values.q).slice(0, 120)
    if (values.extraDir != null) state.extraDir = String(values.extraDir).slice(0, 500)
    if (values.monitor != null) state.monitor = ['0', '1', '2', '3'].includes(String(values.monitor)) ? String(values.monitor) : '0'
    if (values.autoApply != null) state.autoApply = String(values.autoApply) === 'off' ? 'off' : 'on'
    if (values.wallpaper) state.selected = String(values.wallpaper)
    await persist()
    cache.at = 0

    const action = String(values.action || 'apply')
    let message = '设置已保存'
    try {
      if (action === 'apply') {
        const item = findWallpaper(state.selected, true)
        if (!item) throw new Error('未找到选中壁纸，请先点击“仅刷新列表”')
        await applyWallpaper(item, state.monitor)
        message = `已应用：${item.title}`
      } else if (action === 'pause') {
        state.paused = true
        state.rev = (Number(state.rev) || 0) + 1
        await persist()
        message = '已暂停'
      } else if (action === 'resume') {
        state.paused = false
        state.rev = (Number(state.rev) || 0) + 1
        await persist()
        message = '已继续'
      } else if (action === 'stop') {
        state.selected = ''
        state.paused = false
        state.sceneVideo = ''
        state.sceneRuntime = ''
        state.rev = (Number(state.rev) || 0) + 1
        await persist()
        message = '已关闭动态壁纸'
      } else {
        message = '列表已刷新'
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      log('error', text)
      return { message: `操作失败：${text}`, form: buildForm(`操作失败：${text}`) }
    }
    await notify('success', message)
    return { message, form: buildForm(message) }
  })

  if (state.autoApply === 'on' && state.lastProject && exists(state.lastProject)) {
    autoApplyTimer = setTimeout(async () => {
      try {
        const item = findWallpaper(state.selected, true)
        if (item) await applyWallpaper(item, state.monitor)
        log('info', `已恢复上次壁纸：${item?.title ?? state.lastTitle}`)
      } catch (error) {
        log('warn', `恢复上次壁纸失败：${error?.message || error}`)
      }
    }, 4000)
  }
}

export async function deactivate() {
  if (autoApplyTimer) {
    clearTimeout(autoApplyTimer)
    autoApplyTimer = null
  }
  context = null
  cache = { at: 0, items: [] }
  closeServer()
}
