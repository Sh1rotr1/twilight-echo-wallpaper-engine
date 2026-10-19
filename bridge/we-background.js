/* Twilight Echo × Wallpaper Engine — renderer bridge.
 *
 * Injected by bridge/install.mjs into app.asar (out/renderer/).
 * It owns a single fixed layer at the very bottom of the window, below #app,
 * and asks the plugin's loopback server (127.0.0.1:3100) what to play.
 * Video files are streamed as-is: no transcode, no re-encode.
 */
(function () {
  'use strict'

  var API = 'http://127.0.0.1:3100'
  var STYLE_ID = 'te-we-bg-style'
  var POLL_MS = 2000

  if (window.__TE_WE_BG__) return
  window.__TE_WE_BG__ = true

  var layer = null
  var media = null
  var scrim = null
  var current = { signature: '', paused: false, fit: 'cover', scrim: 0, quality: 'original' }
  var failures = 0
  var lastActive = false
  var pollCount = 0
  var activeVideo = null
  var rafId = 0

  function sendDiag() {
    try {
      var video = document.querySelector('#te-we-bg video')
      var layerEl = document.getElementById('te-we-bg')
      var app = document.getElementById('app')
      var covers = []
      try {
        var nodes = document.body.querySelectorAll('*')
        for (var i = 0; i < nodes.length && covers.length < 12; i += 1) {
          var el = nodes[i]
          var rect = el.getBoundingClientRect()
          if (rect.width < window.innerWidth * 0.85 || rect.height < window.innerHeight * 0.85) continue
          var cs = getComputedStyle(el)
          if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none') continue
          covers.push({
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 80),
            bg: cs.backgroundColor,
            img: String(cs.backgroundImage || '').slice(0, 100),
            z: cs.zIndex,
            pos: cs.position
          })
        }
      } catch (error) {
        covers.push({ error: String(error && error.message) })
      }
      var data = {
        covers: covers,
        attr: document.documentElement.getAttribute('data-te-we-bg'),
        layer: !!layerEl,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyImage: getComputedStyle(document.body).backgroundImage,
        appBg: app ? getComputedStyle(app).backgroundColor : null,
        appZ: app ? getComputedStyle(app).zIndex : null,
        layerZ: layerEl ? getComputedStyle(layerEl).zIndex : null,
        layerOpacity: layerEl ? getComputedStyle(layerEl).opacity : null,
        bodyClass: document.body.className,
        layerTags: layerEl ? Array.from(layerEl.children).map(function (child) { return child.tagName + ':' + (child.className || '') }) : [],
        video: video
          ? {
              paused: video.paused,
              readyState: video.readyState,
              networkState: video.networkState,
              error: video.error ? video.error.code : null,
              dataError: video.dataset.teWeError || null,
              src: video.currentSrc,
              width: video.videoWidth,
              height: video.videoHeight
            }
          : null
      }
      fetch(API + '/api/bridge-diag', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(data)
      }).catch(function () {})
    } catch (error) {
      /* ignore */
    }
  }

  function beacon(path) {
    try {
      fetch(API + path, { cache: 'no-store' }).catch(function () {})
    } catch (error) {
      /* ignore */
    }
  }

  var CSS = [
    'html[data-te-we-bg="on"],',
    'html[data-te-we-bg="on"] body,',
    'html[data-te-we-bg="on"] body.te-settings-surface,',
    'html[data-te-we-bg="on"] body.te-streaming-surface,',
    'html[data-te-we-bg="on"] body.te-local-surface {',
    '  background: transparent !important;',
    '  background-color: transparent !important;',
    '  background-image: none !important;',
    '}',
    'html:root[data-te-we-bg="on"] {',
    '  --te-app-bg: transparent !important;',
    '  --te-app-bg-image: none !important;',
    '  --te-local-bg-image: none !important;',
    '  --te-settings-bg-image: none !important;',
    '  --te-streaming-bg-image: none !important;',
    '  --te-player-bg-image: none !important;',
    '  --te-settings-backplate: transparent !important;',
    '  --te-settings-bg: transparent !important;',
    '  --te-tp-base-alpha: 0 !important;',
    '  --te-tp-surface-alpha: 0 !important;',
    '  --te-tp-card-alpha: 0.2 !important;',
    '}',
    'html[data-te-we-bg="on"] #app {',
    '  position: relative !important;',
    '  z-index: 1 !important;',
    '  background: transparent !important;',
    '}',
    'html[data-te-we-bg="on"] .app-background-layer,',
    'html[data-te-we-bg="on"] .app-background-image,',
    'html[data-te-we-bg="on"] .app-background-dim {',
    '  display: none !important;',
    '  background: transparent !important;',
    '  background-image: none !important;',
    '}',
    'html[data-te-we-bg="on"] .settings-overlay-root,',
    'html[data-te-we-bg="on"] .settings-overlay-root--active {',
    '  background: transparent !important;',
    '  background-color: transparent !important;',
    '  background-image: none !important;',
    '}',
    'html[data-te-we-bg="on"] :is(',
    '  .main-content, .dashboard-wrapper, .song-list, .settings-page,',
    '  .settings-preview-layout, .streaming-page, .login-page, .eq-page,',
    '  .plugin-page, .plugin-page .main-content, .plugin-page .topbar,',
    '  .playing-music, .title-bar, .title-bar-glass',
    ') {',
    '  background: transparent !important;',
    '  background-color: transparent !important;',
    '  background-image: none !important;',
    '}',
    'html[data-te-we-bg="on"] body::before,',
    'html[data-te-we-bg="on"] body::after,',
    'html[data-te-we-bg="on"] .main-content::before,',
    'html[data-te-we-bg="on"] .main-content::after {',
    '  display: none !important;',
    '  background: none !important;',
    '}',
    '#te-we-bg {',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 0;',
    '  overflow: hidden;',
    '  perspective: 1200px;',
    '  pointer-events: none;',
    '  background: #000;',
    '  opacity: 0;',
    '  transition: opacity 420ms ease;',
    '}',
    '#te-we-bg.te-we-visible { opacity: 1; }',
    '#te-we-bg.te-we-interactive { pointer-events: auto; z-index: 50; }',
    '#te-we-bg.te-we-interactive iframe { pointer-events: auto; }',
    '#te-we-exit {',
    '  position: fixed; top: 54px; right: 18px; z-index: 60;',
    '  padding: 7px 12px; border-radius: 9px; border: 1px solid rgba(255,255,255,.25);',
    '  background: rgba(20,20,24,.72); color: #fff; font: 12px system-ui, sans-serif;',
    '  cursor: pointer; backdrop-filter: blur(12px);',
    '}',
    '#te-we-bg video, #te-we-bg iframe, #te-we-bg img {',
    '  position: absolute;',
    '  inset: 0;',
    '  width: 100%;',
    '  height: 100%;',
    '  border: 0;',
    '  display: block;',
    '  background: #000;',
    '}',
    '#te-we-bg .te-we-scrim {',
    '  position: absolute;',
    '  inset: 0;',
    '  background: rgba(0, 0, 0, var(--te-we-scrim, 0));',
    '  pointer-events: none;',
    '}'
  ].join('\n')

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    ;(document.head || document.documentElement).appendChild(style)
  }

  function ensureLayer() {
    if (layer && document.documentElement.contains(layer)) return layer
    if (!document.body) return null
    layer = document.createElement('div')
    layer.id = 'te-we-bg'
    document.body.insertBefore(layer, document.body.firstChild)
    return layer
  }

  function clearMedia() {
    if (!layer) return
    layer.textContent = ''
    media = null
    scrim = null
  }

  function cleanup() {
    lastActive = false
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
    activeVideo = null
    document.documentElement.setAttribute('data-te-we-bg', 'off')
    var exit = document.getElementById('te-we-exit')
    if (exit) exit.remove()
    if (layer) {
      layer.classList.remove('te-we-visible')
      window.setTimeout(function () {
        if (!lastActive && layer) {
          layer.remove()
          layer = null
          media = null
          scrim = null
        }
      }, 450)
    }
  }

  function setPaused(paused) {
    current.paused = paused === true
    if (activeVideo) {
      if (current.paused) activeVideo.pause()
      else {
        var p = activeVideo.play()
        if (p && typeof p.catch === 'function') p.catch(function () {})
      }
    }
  }

  function applyLayout(state) {
    current.fit = state.fit === 'contain' || state.fit === 'fill' ? state.fit : 'cover'
    current.scrim = Math.max(0, Math.min(80, Number(state.scrim) || 0))
    var offsetX = Math.max(-100, Math.min(100, Number(state.offsetX) || 0))
    var offsetY = Math.max(-100, Math.min(100, Number(state.offsetY) || 0))
    var offsetZ = Math.max(-1000, Math.min(1000, Number(state.offsetZ) || 0))
    var zoom = Math.max(50, Math.min(200, Number(state.zoom) || 100)) / 100
    if (media) {
      media.style.objectFit = current.fit
      media.style.transformOrigin = 'center center'
      media.style.willChange = 'transform'
      media.style.transform = 'translate3d(' + offsetX + '%, ' + offsetY + '%, ' + offsetZ + 'px) scale(' + zoom + ')'
    }
    if (scrim) scrim.style.setProperty('--te-we-scrim', String(current.scrim / 100))
  }

  function makeVideo(url, fit, quality) {
    var video = document.createElement('video')
    video.src = API + url
    video.autoplay = true
    video.loop = true
    video.muted = true
    video.defaultMuted = true
    video.playsInline = true
    video.preload = 'auto'
    video.style.objectFit = fit
    video.setAttribute('disablepictureinpicture', '')
    video.addEventListener('error', function () {
      video.dataset.teWeError = String(video.error ? video.error.code : 'unknown')
      if (!layer || !layer.querySelector('img')) {
        var img = document.createElement('img')
        img.src = API + (current.preview || '')
        img.style.objectFit = fit
        img.style.zIndex = '-1'
        if (layer) layer.insertBefore(img, video)
      }
    })
    activeVideo = video

    if (quality !== '1080' && quality !== '720') return video

    // Scaled render path: decode the original file once, draw it into a
    // smaller canvas. No encode, no transcode; only the display raster is
    // smaller. This is the "1080P / 720P" quality switch.
    var targetHeight = quality === '720' ? 720 : 1080
    var wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000'
    video.style.cssText += ';position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none'
    var canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:' + fit
    var ctx = canvas.getContext('2d')
    wrap.appendChild(video)
    wrap.appendChild(canvas)

    function draw() {
      if (current.paused || document.hidden) { rafId = 0; return }
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        var width = Math.max(1, Math.round(targetHeight * video.videoWidth / video.videoHeight))
        if (canvas.width !== width || canvas.height !== targetHeight) {
          canvas.width = width
          canvas.height = targetHeight
        }
        try { ctx.drawImage(video, 0, 0, width, targetHeight) } catch (error) { /* ignore */ }
      }
      rafId = requestAnimationFrame(draw)
    }
    video.addEventListener('loadeddata', function () { if (!rafId) draw() })
    video.addEventListener('play', function () { if (!rafId) draw() })
    return wrap
  }

  function makeImage(url, fit) {
    var img = document.createElement('img')
    img.src = API + url
    img.style.objectFit = fit
    img.alt = ''
    return img
  }

  function render(state) {
    installStyle()
    if (!state || !state.active) {
      cleanup()
      return
    }
    lastActive = true
    document.documentElement.setAttribute('data-te-we-bg', 'on')
    var el = ensureLayer()
    if (!el) return

    var interactive = state.type === 'web' && state.interactive === true
    el.classList.toggle('te-we-interactive', interactive)
    var exit = document.getElementById('te-we-exit')
    if (interactive && !exit) {
      exit = document.createElement('button')
      exit.id = 'te-we-exit'
      exit.textContent = '退出交互'
      exit.onclick = function () {
        fetch(API + '/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'interact' })
        }).catch(function () {})
      }
      document.body.appendChild(exit)
    } else if (!interactive && exit) {
      exit.remove()
    }

    var fit = state.fit === 'contain' || state.fit === 'fill' ? state.fit : 'cover'
    var quality = state.quality === '1080' || state.quality === '720' ? state.quality : 'original'
    var signature = [state.type || '', state.url || '', state.preview || '', quality].join('|')
    current.preview = state.preview || ''

    if (signature !== current.signature) {
      current.signature = signature
      clearMedia()
      if (state.url && (state.type === 'video' || state.type === 'scene')) {
        media = makeVideo(state.url, fit, quality)
      } else if (state.url && state.type === 'web') {
        media = document.createElement('iframe')
        media.src = API + state.url
        if (!state.scene) media.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-pointer-lock')
        media.setAttribute('allow', 'autoplay; encrypted-media; fullscreen')
        media.style.border = '0'
        media.style.background = '#000'
      } else if (state.preview) {
        media = makeImage(state.preview, fit)
      }
      if (media) el.appendChild(media)
      scrim = document.createElement('div')
      scrim.className = 'te-we-scrim'
      el.appendChild(scrim)
      applyLayout(state)
      requestAnimationFrame(function () {
        if (el) el.classList.add('te-we-visible')
      })
    } else {
      applyLayout(state)
    }
    setPaused(state.paused)
  }

  async function poll() {
    try {
      var response = await fetch(API + '/api/state', { cache: 'no-store' })
      if (!response.ok) throw new Error('bad status ' + response.status)
      var state = await response.json()
      failures = 0
      render(state)
      pollCount += 1
      if (pollCount % 3 === 1) sendDiag()
    } catch (error) {
      failures += 1
      if (failures === 1) beacon('/api/bridge-error?m=' + encodeURIComponent(String(error && error.message || error)))
      if (failures >= 8) cleanup()
    } finally {
      window.setTimeout(poll, POLL_MS)
    }
  }

  function boot() {
    beacon('/api/bridge-boot')
    installStyle()
    poll()
  }

  function appearanceOpen() {
    var page = document.querySelector('.settings-page') || document.querySelector('.settings-main') || document.querySelector('.settings-overlay-root')
    if (!page) return false
    return (page.innerText || '').indexOf('背景与材质') !== -1
  }

  function findAppearanceAnchor() {
    var nodes = document.querySelectorAll('h2,h3,h4,div,span,p,strong')
    var best = null
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i]
      if ((el.textContent || '').trim() !== '背景与材质') continue
      if (!best || el.querySelectorAll('*').length < best.querySelectorAll('*').length) best = el
    }
    if (!best) return null
    var section = best.closest('section, .settings-section, .settings-group, .settings-card, .settings-block')
    return section || best.parentElement
  }

  function mountPicker() {
    if (document.getElementById('te-we-picker')) return
    var anchor = findAppearanceAnchor()
    var host = document.querySelector('.settings-main') || document.querySelector('.settings-content') || document.querySelector('.settings-page')
    if ((!anchor || !anchor.parentNode) && !host) return
    var card = document.createElement('section')
    card.id = 'te-we-picker'
    card.style.cssText = [
      'box-sizing:border-box', 'margin:0 0 16px', 'padding:16px 18px', 'border-radius:14px',
      'width:100%', 'max-width:none', 'grid-column:1 / -1', 'align-self:stretch',
      'background:var(--te-card-bg, rgba(255,255,255,.04))',
      'border:1px solid var(--te-card-border, rgba(127,127,127,.18))',
      'color:inherit', 'font:13px/1.5 system-ui, "Microsoft YaHei", sans-serif'
    ].join(';')
    card.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">',
      '<div><div style="font-size:14px;font-weight:600">动态壁纸</div>',
      '<div style="font-size:12px;opacity:.6;margin-top:2px">Wallpaper Engine · 自动静音</div></div>',
      '<span id="te-we-picker-status" style="font-size:11px;opacity:.6;white-space:nowrap"></span>',
      '</div>',
      '<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(127,127,127,.15)">',
      '<div style="width:110px;flex:none">壁纸</div>',
      '<div style="flex:1;display:flex;gap:6px;min-width:0">',
      '<input id="te-we-picker-filter" placeholder="筛选…" style="width:110px;flex:none;padding:5px 7px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit">',
      '<select id="te-we-picker-select" style="flex:1;min-width:0;padding:5px 7px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit"></select>',
      '</div></div>',
      '<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(127,127,127,.15)">',
      '<div style="width:110px;flex:none">画质</div>',
      '<select id="te-we-picker-quality" style="flex:1;padding:5px 7px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit">',
      '<option value="original">原画</option>',
      '<option value="1080">1080P</option>',
      '<option value="720">720P</option>',
      '</select></div>',
      '<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(127,127,127,.15)">',
      '<div style="width:110px;flex:none">填充 / 暗化</div>',
      '<div style="flex:1;display:flex;gap:6px">',
      '<select id="te-we-picker-fit" style="flex:1;padding:5px 7px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit">',
      '<option value="cover">裁切铺满</option><option value="contain">完整显示</option><option value="fill">拉伸</option></select>',
      '<select id="te-we-picker-scrim" style="flex:1;padding:5px 7px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit">',
      '<option value="0">不暗化</option><option value="20">暗化 20%</option><option value="35">暗化 35%</option><option value="50">暗化 50%</option></select>',
      '</div></div>',
      '<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(127,127,127,.15)">',
      '<div style="width:110px;flex:none">位置 X / Y / Z</div>',
      '<div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:8px">',
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;opacity:.8">X <input id="te-we-x" type="range" min="-100" max="100" step="1" value="0" style="flex:1;min-width:0"><span id="te-we-x-val" style="width:34px;text-align:right">0</span></label>',
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;opacity:.8">Y <input id="te-we-y" type="range" min="-100" max="100" step="1" value="0" style="flex:1;min-width:0"><span id="te-we-y-val" style="width:34px;text-align:right">0</span></label>',
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;opacity:.8">Z <input id="te-we-z" type="range" min="-1000" max="1000" step="10" value="0" style="flex:1;min-width:0"><span id="te-we-z-val" style="width:42px;text-align:right">0</span></label>',
      '</div></div>',
      '<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(127,127,127,.15)">',
      '<div style="width:110px;flex:none">缩放</div>',
      '<div style="flex:1;display:flex;align-items:center;gap:10px">',
      '<input id="te-we-zoom" type="range" min="50" max="200" step="5" value="100" style="flex:1">',
      '<span id="te-we-zoom-val" style="width:46px;text-align:right;font-size:11px;opacity:.8">100%</span>',
      '</div></div>',
      '<div id="te-we-widgets" style="display:none;padding:10px 0;border-top:1px solid rgba(127,127,127,.15)"></div>',
      '<div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid rgba(127,127,127,.15)">',
      '<button id="te-we-picker-apply" style="flex:1;padding:7px;border:0;border-radius:9px;background:var(--color-primary-500,#ff5c8a);color:#fff;cursor:pointer;font:inherit">应用</button>',
      '<button id="te-we-picker-pause" style="flex:1;padding:7px;border:1px solid rgba(127,127,127,.35);border-radius:9px;background:transparent;color:inherit;cursor:pointer;font:inherit">暂停</button>',
      '<button id="te-we-picker-interact" style="flex:1;padding:7px;border:1px solid rgba(127,127,127,.35);border-radius:9px;background:transparent;color:inherit;cursor:pointer;font:inherit">交互</button>',
      '<button id="te-we-picker-stop" style="flex:1;padding:7px;border:1px solid rgba(127,127,127,.35);border-radius:9px;background:transparent;color:inherit;cursor:pointer;font:inherit">关闭</button>',
      '</div>'
    ].join('')
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor)
    else host.insertBefore(card, host.firstChild)

    var select = card.querySelector('#te-we-picker-select')
    var filter = card.querySelector('#te-we-picker-filter')
    var quality = card.querySelector('#te-we-picker-quality')
    var fit = card.querySelector('#te-we-picker-fit')
    var scrim = card.querySelector('#te-we-picker-scrim')
    var status = card.querySelector('#te-we-picker-status')
    var pause = card.querySelector('#te-we-picker-pause')
    var xInput = card.querySelector('#te-we-x')
    var yInput = card.querySelector('#te-we-y')
    var zInput = card.querySelector('#te-we-z')
    var zoomInput = card.querySelector('#te-we-zoom')
    var allItems = []
    var labels = { video: '视频', scene: '场景', web: '网页', application: '应用' }

    function renderOptions() {
      var q = (filter.value || '').trim().toLowerCase()
      var visible = allItems.filter(function (item) {
        return !q || (item.title + ' ' + item.type).toLowerCase().indexOf(q) !== -1
      })
      var groups = {}
      visible.forEach(function (item) { (groups[item.type] = groups[item.type] || []).push(item) })
      select.innerHTML = Object.keys(groups).map(function (type) {
        return '<optgroup label="' + (labels[type] || type) + '">' + groups[type].map(function (item) {
          return '<option value="' + item.id + '">' + item.title.replace(/</g, '&lt;') + '</option>'
        }).join('') + '</optgroup>'
      }).join('')
      status.textContent = visible.length + ' / ' + allItems.length + ' 张'
    }

    fetch(API + '/api/wallpapers', { cache: 'no-store' })
      .then(function (response) { return response.json() })
      .then(function (data) {
        allItems = data.items || []
        renderOptions()
        if (data.selected) select.value = data.selected
        if (data.selected) loadProps(data.selected)
        if (data.state) {
          if (data.state.fit) fit.value = data.state.fit
          if (data.state.scrim != null) scrim.value = String(data.state.scrim)
          if (data.state.quality) quality.value = data.state.quality
          if (data.state.offsetX != null) xInput.value = String(data.state.offsetX)
          if (data.state.offsetY != null) yInput.value = String(data.state.offsetY)
          if (data.state.offsetZ != null) zInput.value = String(data.state.offsetZ)
          if (data.state.zoom != null) zoomInput.value = String(data.state.zoom)
          card.querySelector('#te-we-x-val').textContent = xInput.value
          card.querySelector('#te-we-y-val').textContent = yInput.value
          card.querySelector('#te-we-z-val').textContent = zInput.value
          card.querySelector('#te-we-zoom-val').textContent = zoomInput.value + '%'        }
      })
      .catch(function () { status.textContent = '读取壁纸列表失败' })

    filter.addEventListener('input', renderOptions)

    var layoutTimer = 0
    function pushLayout() {
      clearTimeout(layoutTimer)
      layoutTimer = setTimeout(function () {
        request('/api/layout', {
          offsetX: xInput.value,
          offsetY: yInput.value,
          offsetZ: zInput.value,
          zoom: zoomInput.value
        }).catch(function () {})
      }, 120)
    }

    function bindRange(input, outputId, suffix) {
      var out = card.querySelector(outputId)
      var sync = function () { if (out) out.textContent = input.value + suffix }
      input.addEventListener('input', function () {
        sync()
        pushLayout()
      })
      sync()
    }
    bindRange(xInput, '#te-we-x-val', '')
    bindRange(yInput, '#te-we-y-val', '')
    bindRange(zInput, '#te-we-z-val', '')
    bindRange(zoomInput, '#te-we-zoom-val', '%')

    var widgetsBox = card.querySelector('#te-we-widgets')
    // ── 壁纸属性（WE user properties，DSH 同款语义）─────────────────────────
    var propsId = ''
    var propsState = []
    var propTimers = {}

    function rgbToHex(value) {
      var parts = String(value || '').trim().split(/\s+/).map(Number)
      if (parts.length < 3 || parts.some(function (n) { return !Number.isFinite(n) })) return '#000000'
      var channel = function (n) { return Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0') }
      return '#' + channel(parts[0]) + channel(parts[1]) + channel(parts[2])
    }

    function hexToRgb(value) {
      var hex = String(value || '').replace('#', '')
      if (hex.length !== 6) return '0 0 0'
      var r = parseInt(hex.slice(0, 2), 16) / 255
      var g = parseInt(hex.slice(2, 4), 16) / 255
      var b = parseInt(hex.slice(4, 6), 16) / 255
      return (r.toFixed(5) + ' ' + g.toFixed(5) + ' ' + b.toFixed(5))
    }

    function propFrame() {
      return layer && layer.querySelector('iframe')
    }

    function propValuesMap() {
      var map = {}
      for (var i = 0; i < propsState.length; i += 1) map[propsState[i].name] = propsState[i].value
      return map
    }

    function evalPropCondition(expr) {
      if (!expr) return true
      var code = String(expr).replace(/\b([A-Za-z_][\w$]*)\.value\b/g, function (m, name) {
        return 'values[' + JSON.stringify(name) + ']'
      })
      try {
        return Boolean(new Function('values', 'return (' + code + ')')(propValuesMap()))
      } catch (error) {
        return true
      }
    }

    function samePropValue(a, b) {
      if (a === b) return true
      if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
      return false
    }

    function pushProp(property, value) {
      var frame = propFrame()
      if (!frame || !frame.contentWindow) return
      try {
        frame.contentWindow.postMessage({ type: 'te-prop', name: property.name, value: value }, '*')
      } catch (error) { /* load 后会从 /api/props 回放 */ }
    }

    function saveProp(property, value) {
      property.value = value
      property.overridden = !samePropValue(value, property.default)
      pushProp(property, value)
      updatePropVisibility()
      var name = property.name
      clearTimeout(propTimers[name])
      propTimers[name] = setTimeout(function () {
        if (!propsId) return
        request('/api/props', { id: propsId, name: name, value: value }).catch(function () {})
      }, 80)
    }

    function updatePropVisibility() {
      for (let i = 0; i < propsState.length; i += 1) {
        let property = propsState[i]
        if (!property.__row) continue
        property.__row.style.display = evalPropCondition(property.condition) ? '' : 'none'
      }
    }

    function propLabel(property) {
      return String(property.text || property.name || '')
    }

    function renderProps(data) {
      propsId = data.id || ''
      propsState = Array.isArray(data.props) ? data.props : []
      widgetsBox.textContent = ''
      var visibleControls = propsState.filter(function (p) {
        return p.ptype !== 'group' && p.ptype !== 'text' && evalPropCondition(p.condition)
      })
      var headings = propsState.filter(function (p) {
        return (p.ptype === 'group' || p.ptype === 'text') && evalPropCondition(p.condition)
      })
      if (!visibleControls.length && !headings.length) { widgetsBox.style.display = 'none'; return }
      widgetsBox.style.display = 'block'

      var header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px'
      var title = document.createElement('div')
      title.textContent = '壁纸属性'
      title.style.cssText = 'font-size:12px;font-weight:600;opacity:.85'
      header.appendChild(title)
      var reset = document.createElement('button')
      reset.type = 'button'
      reset.textContent = '恢复默认'
      reset.style.cssText = 'padding:3px 8px;border:1px solid rgba(127,127,127,.35);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer'
      reset.onclick = function () {
        if (!propsId) return
        request('/api/props/reset', { id: propsId }).then(function (result) {
          if (!result || !result.ok) return
          var values = {}
          var list = Array.isArray(result.props) ? result.props : []
          for (var k = 0; k < list.length; k += 1) {
            var p = list[k]
            if (p.ptype === 'group' || p.ptype === 'text' || p.default === null || p.default === undefined) continue
            values[p.name] = p.default
          }
          var frame = propFrame()
          if (frame && frame.contentWindow) {
            try { frame.contentWindow.postMessage({ type: 'te-props-reset', values: values }, '*') } catch (error) {}
          }
          renderProps({ id: propsId, props: list })
        }).catch(function () {})
      }
      header.appendChild(reset)
      widgetsBox.appendChild(header)

      for (let i = 0; i < propsState.length; i += 1) {
        let property = propsState[i]
        if (!evalPropCondition(property.condition)) continue
        if (property.ptype === 'group' || property.ptype === 'text') {
          let heading = document.createElement('div')
          heading.textContent = propLabel(property)
          heading.style.cssText = 'margin:8px 0 4px;font-size:11px;opacity:.55'
          widgetsBox.appendChild(heading)
          property.__row = heading
          continue
        }
        let row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 0'
        property.__row = row
        let label = document.createElement('div')
        label.textContent = propLabel(property)
        label.title = property.name
        label.style.cssText = 'width:150px;flex:none;font-size:12px;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        row.appendChild(label)
        let control
        let value = property.value
        if (property.ptype === 'slider') {
          control = document.createElement('input')
          control.type = 'range'
          control.min = property.min != null ? property.min : 0
          control.max = property.max != null ? property.max : 100
          control.step = property.step != null ? property.step : 0.01
          control.value = Number(value) || 0
          control.style.flex = '1'
          let output = document.createElement('span')
          let digits = property.precision != null ? property.precision : (property.step != null && property.step < 1 ? 2 : 0)
          output.textContent = Number(control.value).toFixed(digits)
          output.style.cssText = 'width:48px;text-align:right;font-size:11px;opacity:.65;flex:none'
          control.oninput = function (event) {
            var input = event.target
            output.textContent = Number(input.value).toFixed(digits)
            saveProp(property, Number(input.value))
          }
          row.appendChild(control)
          row.appendChild(output)
        } else if (property.ptype === 'bool') {
          control = document.createElement('input')
          control.type = 'checkbox'
          control.checked = value === true
          control.onchange = function (event) { saveProp(property, event.target.checked) }
          row.appendChild(control)
        } else if (property.ptype === 'color') {
          control = document.createElement('input')
          control.type = 'color'
          control.value = rgbToHex(value)
          control.style.cssText = 'width:48px;height:24px;padding:0;border:0;background:transparent'
          control.onchange = function (event) { saveProp(property, hexToRgb(event.target.value)) }
          row.appendChild(control)
        } else if (property.ptype === 'combo') {
          control = document.createElement('select')
          control.style.cssText = 'flex:1;padding:4px 6px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit'
          let options = property.options || []
          for (var j = 0; j < options.length; j += 1) {
            if (options[j].condition && !evalPropCondition(options[j].condition)) continue
            var option = document.createElement('option')
            option.value = String(options[j].value)
            option.textContent = options[j].label
            control.appendChild(option)
          }
          control.value = String(value)
          control.onchange = function (event) {
            var selected = options.find(function (o) { return String(o.value) === event.target.value })
            saveProp(property, selected ? selected.value : event.target.value)
          }
          row.appendChild(control)
        } else if (property.ptype === 'file' || property.ptype === 'directory') {
          if (Array.isArray(property.files) && property.files.length) {
            control = document.createElement('select')
            control.style.cssText = 'flex:1;padding:4px 6px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit'
            var none = document.createElement('option')
            none.value = ''
            none.textContent = '（未选择）'
            control.appendChild(none)
            for (var f = 0; f < property.files.length; f += 1) {
              var opt = document.createElement('option')
              opt.value = property.files[f]
              opt.textContent = property.files[f]
              control.appendChild(opt)
            }
            control.value = String(value || '')
            control.onchange = function (event) { saveProp(property, event.target.value) }
          } else {
            control = document.createElement('input')
            control.type = 'text'
            control.value = String(value || '')
            control.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit'
            control.onchange = function (event) { saveProp(property, event.target.value) }
          }
          row.appendChild(control)
        } else {
          control = document.createElement('input')
          control.type = 'text'
          control.value = String(value == null ? '' : value)
          control.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.10);color:inherit;font:inherit'
          control.onchange = function (event) { saveProp(property, event.target.value) }
          row.appendChild(control)
        }
        widgetsBox.appendChild(row)
      }
      updatePropVisibility()
    }

    function loadProps(id) {
      if (!id) { widgetsBox.style.display = 'none'; return }
      fetch(API + '/api/props/' + encodeURIComponent(id), { cache: 'no-store' })
        .then(function (response) { return response.json() })
        .then(function (data) { if (data && data.ok) renderProps(data); else widgetsBox.style.display = 'none' })
        .catch(function () { widgetsBox.style.display = 'none' })
    }

    select.addEventListener('change', function () {
      // 壁纸属性只针对“已应用”的壁纸；切换候选不预览、不改当前壁纸。
      widgetsBox.style.display = 'none'
      propsId = ''
      propsState = []
      status.textContent = '点“应用”后再调壁纸属性'
    })

    window.addEventListener('message', function (event) {
      var data = event && event.data
      if (!data || data.type !== 'te-props-live' || !propsId || data.id !== propsId || !data.values) return
      var changed = false
      for (var i = 0; i < propsState.length; i += 1) {
        var property = propsState[i]
        if (!Object.prototype.hasOwnProperty.call(data.values, property.name)) continue
        var liveValue = data.values[property.name]
        if (property.ptype === 'color' && liveValue && typeof liveValue === 'object') {
          liveValue = String(liveValue.x || 0) + ' ' + String(liveValue.y || 0) + ' ' + String(liveValue.z || 0)
        }
        if (!samePropValue(property.value, liveValue)) {
          property.value = liveValue
          changed = true
        }
      }
      if (changed && (!document.activeElement || !widgetsBox.contains(document.activeElement))) {
        renderProps({ id: propsId, props: propsState })
      }
    })



    function request(path2, body) {
      return fetch(API + path2, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body || {})
      }).then(function (response) { return response.json() })
    }

    card.querySelector('#te-we-picker-apply').onclick = function () {
      status.textContent = '应用中…'
      request('/api/apply', {
        id: select.value,
        fit: fit.value,
        scrim: scrim.value,
        quality: quality.value,
        offsetX: xInput.value,
        offsetY: yInput.value,
        offsetZ: zInput.value,
        zoom: zoomInput.value
      })
        .then(function (result) {
          status.textContent = result.ok ? '已应用' : ('失败：' + result.error)
          if (result.ok) loadProps(result.state && result.state.id ? result.state.id : select.value)
        })
        .catch(function () { status.textContent = '应用失败' })
    }
    pause.onclick = function () {
      request('/api/control', { action: 'pause' }).then(function () { status.textContent = '已暂停' }).catch(function () {})
    }
    card.querySelector('#te-we-picker-interact').onclick = function () {
      request('/api/control', { action: 'interact' }).then(function (result) {
        status.textContent = result.ok && result.state && result.state.interactive
          ? '网页交互已开启，点右上角退出'
          : '网页交互已关闭'
      }).catch(function () {})
    }
    card.querySelector('#te-we-picker-stop').onclick = function () {
      request('/api/control', { action: 'stop' }).then(function () { status.textContent = '已关闭' }).catch(function () {})
    }
  }

  var pickerTimer = null
  function startPickerWatcher() {
    if (pickerTimer) return
    pickerTimer = window.setInterval(function () {
      var open = appearanceOpen()
      var card = document.getElementById('te-we-picker')
      if (open && !card) mountPicker()
      if (card) card.style.display = open ? 'block' : 'none'
    }, 1500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
  startPickerWatcher()
})()
