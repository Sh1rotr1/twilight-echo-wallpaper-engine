'use strict'
/**
 * asar-lite —— 自带的 asar 读写器，不依赖 @electron/asar / npm 依赖树。
 *
 * 只实现适配器需要的能力：
 *   · readHeader(archive)                读 header JSON
 *   · readEntry(archive, name)           读单个文件
 *   · extractAll(archive, dir)           解包
 *   · listFiles(archive)                 列文件
 *   · pack(dir, dest, { preserve })      整目录重新打包
 *
 * 格式与 @electron/asar 3.x 完全一致（Chromium Pickle）：
 *   [uint32 payloadSize=4][uint32 headerBufSize][uint32 jsonLen][json…pad][文件内容…]
 *   数据区起点 = 8 + headerBufSize，每个文件的 offset 相对这个起点。
 *
 * 打包时保留原 header 里的 executable / unpacked / link 标记（Windows 包通常没有）。
 */

const fs = require('node:fs')
const path = require('node:path')

const ALIGN = 4
const align = (value) => value + ((ALIGN - (value % ALIGN)) % ALIGN)

/**
 * Electron 会拦截所有带 .asar 的路径，把「打开归档文件本身」当成打开归档内目录，
 * 于是 fs.openSync('app.asar') 直接 ENOENT。@electron/asar 的做法是全程
 * process.noAsar = true；这里只在读写期间切换，避免影响宿主自己的 asar 访问。
 * 注意：Electron 里 process.noAsar 初始是 undefined，不能拿 undefined 当「非 Electron」判断。
 */
const IS_ELECTRON = Boolean(process.versions && process.versions.electron)

function noAsar(fn) {
  if (!IS_ELECTRON) return fn()
  const previous = process.noAsar
  process.noAsar = true
  try {
    return fn()
  } finally {
    process.noAsar = previous
  }
}

/* ------------------------------------------------------------------ 读 */

const headerCache = new Map()

function readHeaderRaw(archive) {
  let stamp = archive
  try {
    const st = fs.statSync(archive)
    stamp = `${archive}:${st.size}:${Math.round(st.mtimeMs)}`
  } catch {
    /* 文件不存在时走正常报错路径 */
  }
  const cached = headerCache.get(stamp)
  if (cached) return cached
  const fd = fs.openSync(archive, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    if (fs.readSync(fd, sizeBuf, 0, 8, 0) !== 8) throw new Error('asar: 读不到 header 长度')
    const headerBufSize = sizeBuf.readUInt32LE(4)
    if (!headerBufSize || headerBufSize > 64 * 1024 * 1024) throw new Error(`asar: header 长度异常 ${headerBufSize}`)
    const headerBuf = Buffer.alloc(headerBufSize)
    if (fs.readSync(fd, headerBuf, 0, headerBufSize, 8) !== headerBufSize) throw new Error('asar: 读不到 header')
    const payloadSize = headerBuf.readUInt32LE(0)
    const base = headerBuf.length - payloadSize
    const jsonLen = headerBuf.readInt32LE(base)
    const json = headerBuf.slice(base + 4, base + 4 + jsonLen).toString('utf8')
    const result = { header: JSON.parse(json), headerBufSize, dataStart: 8 + headerBufSize }
    if (headerCache.size > 6) headerCache.clear()
    headerCache.set(stamp, result)
    return result
  } finally {
    fs.closeSync(fd)
  }
}

function readEntryRaw(archive, name) {
  const { header, dataStart } = readHeader(archive)
  const parts = String(name).replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean)
  let node = header
  for (const part of parts) {
    if (!node || !node.files || !node.files[part]) return null
    node = node.files[part]
  }
  if (!node || node.files || typeof node.size !== 'number') return null
  if (node.unpacked) {
    const unpackedPath = path.join(`${archive}.unpacked`, ...parts)
    try {
      return fs.readFileSync(unpackedPath)
    } catch {
      return null
    }
  }
  const fd = fs.openSync(archive, 'r')
  try {
    const buffer = Buffer.alloc(node.size)
    if (node.size > 0) fs.readSync(fd, buffer, 0, node.size, dataStart + Number(node.offset || 0))
    return buffer
  } finally {
    fs.closeSync(fd)
  }
}

function readText(archive, name) {
  const buffer = readEntry(archive, name)
  return buffer ? buffer.toString('utf8') : null
}

function walkHeader(json, basePath, out) {
  if (!json || typeof json !== 'object' || !json.files) return out
  for (const [name, child] of Object.entries(json.files)) {
    const full = basePath ? `${basePath}/${name}` : name
    if (child && child.files) {
      walkHeader(child, full, out)
    } else {
      out.push({ name: full, node: child })
    }
  }
  return out
}

function listFiles(archive) {
  const { header } = readHeader(archive)
  return walkHeader(header, '', [])
}

function extractAllRaw(archive, dest) {
  const { header, dataStart } = readHeader(archive)
  const files = walkHeader(header, '', [])
  const fd = fs.openSync(archive, 'r')
  try {
    for (const file of files) {
      const target = path.join(dest, ...file.name.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      if (file.node.link) continue
      if (file.node.unpacked) {
        try {
          fs.copyFileSync(path.join(`${archive}.unpacked`, ...file.name.split('/')), target)
        } catch {
          /* 缺失的 unpacked 文件跳过 */
        }
        continue
      }
      const size = Number(file.node.size || 0)
      if (size === 0) {
        fs.writeFileSync(target, Buffer.alloc(0))
        continue
      }
      const buffer = Buffer.alloc(size)
      fs.readSync(fd, buffer, 0, size, dataStart + Number(file.node.offset || 0))
      fs.writeFileSync(target, buffer)
    }
  } finally {
    fs.closeSync(fd)
  }
  return files.length
}

/* ------------------------------------------------------------------ 写 */

function collect(dir, base, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push({ rel, type: 'dir', abs })
      collect(abs, rel, out)
    } else if (entry.isSymbolicLink()) {
      out.push({ rel, type: 'link', abs, target: fs.readlinkSync(abs) })
    } else if (entry.isFile()) {
      out.push({ rel, type: 'file', abs, size: fs.statSync(abs).size })
    }
  }
  return out
}

function ensureDirNode(header, rel) {
  let node = header
  if (!rel) return node
  for (const part of rel.split('/')) {
    if (!part) continue
    if (!node.files) node.files = Object.create(null)
    if (!node.files[part]) node.files[part] = { files: Object.create(null) }
    node = node.files[part]
    if (!node.files) node.files = Object.create(null)
  }
  return node
}

function setFileNode(header, rel, value) {
  const parts = rel.split('/')
  const name = parts.pop()
  const parent = ensureDirNode(header, parts.join('/'))
  if (!parent.files) parent.files = Object.create(null)
  parent.files[name] = value
}

/**
 * 整目录打包。
 * @param {string} src 源目录
 * @param {string} dest 目标 .asar
 * @param {object} [options]
 * @param {object} [options.preserve] 原 header，用来保留 executable/unpacked 标记
 */
function packRaw(src, dest, options = {}) {
  const preserve = options.preserve || null
  const preservedFlags = new Map()
  if (preserve) {
    for (const file of walkHeader(preserve, '', [])) {
      const flags = {}
      if (file.node && file.node.executable) flags.executable = true
      if (file.node && file.node.unpacked) flags.unpacked = true
      if (Object.keys(flags).length) preservedFlags.set(file.name, flags)
    }
  }

  const entries = collect(src, '', [])
  const header = { files: Object.create(null) }
  const order = []
  let offset = 0

  for (const entry of entries) {
    if (entry.type === 'dir') {
      ensureDirNode(header, entry.rel)
      continue
    }
    if (entry.type === 'link') {
      setFileNode(header, entry.rel, { link: entry.target.replace(/\\/g, '/') })
      continue
    }
    const flags = preservedFlags.get(entry.rel) || {}
    if (flags.unpacked) {
      setFileNode(header, entry.rel, { size: entry.size, unpacked: true, integrity: undefined })
      continue
    }
    const node = { size: entry.size, offset: String(offset) }
    if (flags.executable) node.executable = true
    setFileNode(header, entry.rel, node)
    offset += entry.size
    order.push(entry.abs)
  }

  const json = JSON.stringify(header)
  const jsonLen = Buffer.byteLength(json)
  const headerBuf = Buffer.alloc(8 + align(jsonLen))
  headerBuf.writeUInt32LE(4 + align(jsonLen), 0)
  headerBuf.writeUInt32LE(jsonLen, 4)
  Buffer.from(json, 'utf8').copy(headerBuf, 8)

  const sizeBuf = Buffer.alloc(8)
  sizeBuf.writeUInt32LE(4, 0)
  sizeBuf.writeUInt32LE(headerBuf.length, 4)

  const fd = fs.openSync(dest, 'w')
  try {
    fs.writeSync(fd, sizeBuf, 0, sizeBuf.length, 0)
    fs.writeSync(fd, headerBuf, 0, headerBuf.length, 8)
    let position = 8 + headerBuf.length
    for (const file of order) {
      const data = fs.readFileSync(file)
      if (data.length) fs.writeSync(fd, data, 0, data.length, position)
      position += data.length
    }
  } finally {
    fs.closeSync(fd)
  }
  return { files: order.length, bytes: fs.statSync(dest).size, offset }
}

function readHeader(archive) { return noAsar(() => readHeaderRaw(archive)) }
function readEntry(archive, name) { return noAsar(() => readEntryRaw(archive, name)) }
function extractAll(archive, dest) { return noAsar(() => extractAllRaw(archive, dest)) }
function pack(src, dest, options = {}) { return noAsar(() => packRaw(src, dest, options)) }

module.exports = {
  readHeader,
  readEntry,
  readText,
  listFiles,
  extractAll,
  pack
}
