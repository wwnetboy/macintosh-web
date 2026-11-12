import * as THREE from 'three'
import { assetUrl } from '../core/assets.js'
import { getSiteLinks } from '../content/site.js'
import { t } from '../content/i18n.js'
import { helloLettering, drawHandwriting } from '../ui/handwriting.js'
import { drawLinkIcon } from '../ui/linkIcons.js'

const W = 512
const H = 416

const INK = '#000000'
const PAPER = '#ffffff'
const FONT_FAMILY = '"Fusion Pixel", "Geneva", "Arial", "SimSun", sans-serif'
const LATIN_FONT_FAMILY = `"VT323", ${FONT_FAMILY}`
const FONT = `12px ${FONT_FAMILY}`
const SMALL = FONT
const MONO = FONT
const MENU_FONT = FONT
const POWER_ON_DURATION = 0.9
const POWER_OFF_CLEAR_DURATION = 0.26
const POWER_OFF_COLLAPSE_DURATION = 0.8
const FACE_DELAY = 1.05
const FACE_DURATION = 0.22
const HANDWRITING_DELAY = 1.45
const HANDWRITING_DURATION = 2.1
const BOOT_DURATION = 4.1
const TRANSITION_DURATION = 0.48

// Open pixel face with a hooked nose and a broad, stepped smile.
const HAPPY_FACE_BITMAP = [
  '##.......##......##',
  '##.......##......##',
  '##.......##......##',
  '##.......##......##',
  '.........##........',
  '.........##........',
  '.........##........',
  '.........##........',
  '.......####........',
  '.......####........',
  '...................',
  '...................',
  '..##...........##..',
  '..###.........###..',
  '...####.....####...',
  '.....#########.....',
  '.......#####.......',
]
const MEDIA_VIEWPORT = { x: 0, y: 0, w: W, h: H }

/**
 * CrtScreen — everything that is drawn *inside* the monitor.
 * It owns a 512×416 logical canvas fitted to the imported curved glass,
 * a list of clickable regions, and the state of whatever is "on screen".
 */
export class CrtScreen {
  constructor(site) {
    this.site = site
    this.canvas = document.createElement('canvas')
    this.canvas.width = W
    this.canvas.height = H
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    this.ctx.imageSmoothingEnabled = false
    const desktopTile = document.createElement('canvas')
    desktopTile.width = desktopTile.height = 2
    const tileContext = desktopTile.getContext('2d')
    tileContext.fillStyle = PAPER
    tileContext.fillRect(0, 0, 2, 2)
    tileContext.fillStyle = INK
    tileContext.fillRect(0, 0, 1, 1)
    tileContext.fillRect(1, 1, 1, 1)
    this.desktopPattern = this.ctx.createPattern(desktopTile, 'repeat')

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = true
    this.texture.anisotropy = 4

    this.previousCanvas = document.createElement('canvas')
    this.previousCanvas.width = W
    this.previousCanvas.height = H
    this.previousContext = this.previousCanvas.getContext('2d')
    this.previousTexture = new THREE.CanvasTexture(this.previousCanvas)
    this.previousTexture.colorSpace = THREE.SRGBColorSpace
    this.previousTexture.anisotropy = 4
    this.transitionTime = TRANSITION_DURATION

    this.page = 'off'
    this.chapterPage = 'desktop'
    this.powerState = 'off'
    this.powerTime = 0
    this.powerLevel = 0
    this.holdGreeting = false
    this.reduceMotion = false
    this.openMenu = null
    this.selectedIcon = null
    this.finderList = false
    this.controlsUntil = 0
    this.prevPage = null
    this.pageTime = 0
    this.time = 0
    this.hotspots = []
    this.hovered = null
    this.pressed = null
    this.dirty = true

    this.disk = null
    this.video = null
    this.brightness = 0
    this.typedText = ''

    this._tiny = document.createElement('canvas')
    this._tiny.width = this._tiny.height = 8
    this._tinyCtx = this._tiny.getContext('2d')

    this.onDraw = null
    this.notice = ''
    this.noticeUntil = 0
    this.driveDisk = null
    this.driveBusy = false
    this.offsets = { library: 0, work: 0, links: 0 }
    this.welcomeClosed = false
    this.onPageChange = null
    this.onMediaChange = null
    this.mediaState = 'idle'
    this.mediaError = ''
    this.paused = false
    this.muted = true
    this.visible = true
    this.drawClock = 0

    // Canvas text must be drawn again when the locally hosted fonts finish loading.
    Promise.allSettled([
      document.fonts.load(FONT, '影碟柜'),
      document.fonts.load(`32px ${LATIN_FONT_FAMILY}`, 'Macintosh'),
    ]).then(() => {
      this.dirty = true
    })
  }

  /* ------------------------------------------------------------ state */

  setPage(name, { transition = true } = {}) {
    if (!this.powered && name !== 'off') return
    if (
      this.disk && name !== 'reel' && name !== 'off' &&
      !(name === 'hello' && this.powerState === 'starting')
    ) return
    if (this.page === name) return
    this.transitionTime = TRANSITION_DURATION
    if (
      transition &&
      this.powerState === 'on' &&
      !this.reduceMotion &&
      name !== 'off'
    ) {
      if (this.dirty) this._draw()
      this.previousContext.drawImage(this.canvas, 0, 0, W, H)
      this.previousTexture.needsUpdate = true
      this.transitionTime = 0
    }
    this.prevPage = this.page
    this.page = name
    if (name !== 'hello') this.holdGreeting = false
    this.pageTime = 0
    this.dirty = true
    this.hovered = null
    this.pressed = null
    this.openMenu = null
    this._syncPlayback()
    if (this.onPageChange) this.onPageChange(name)
  }

  setChapterPage(name) {
    this.chapterPage = name
    this.holdGreeting = name === 'hello' && !this.disk
    if (!this.powered || this.powerState === 'starting') return
    this.setPage(name)
  }

  get transitionProgress() {
    return this.reduceMotion
      ? 1
      : Math.min(1, this.transitionTime / TRANSITION_DURATION)
  }

  get contentVisibility() {
    if (this.powerState !== 'stopping') return 1
    return (
      1 - THREE.MathUtils.smoothstep(
        this.powerTime, 0, this.reduceMotion ? 0.04 : 0.2,
      )
    )
  }

  /** bring up the machine (cold boot) */
  powerOn({ holdGreeting = this.chapterPage === 'hello' && !this.disk } = {}) {
    if (this.powered) return
    this.holdGreeting = holdGreeting
    this.powerState = 'starting'
    this.powerTime = 0
    this.setPage('hello', { transition: false })
    this.transitionTime = TRANSITION_DURATION
    this.pageTime = 0
    this.dirty = true
    this.welcomeClosed = false
    this.onPowerChange?.(true)
  }

  get powered() {
    return this.powerState === 'on' || this.powerState === 'starting'
  }

  powerOff() {
    if (!this.powered) return
    this.powerState = 'stopping'
    this.powerTime = 0
    this.transitionTime = TRANSITION_DURATION
    this.openMenu = null
    this.dirty = true
    this._syncPlayback()
    this.onPowerChange?.(false)
  }

  togglePower() {
    if (this.powered) this.powerOff()
    else this.powerOn()
  }

  restart() {
    if (!this.powered) {
      this.restartPending = false
      this.powerOn()
      return
    }
    this.restartPending = true
    this.powerOff()
  }

  playDisk(disk) {
    this.disk = disk
    this.paused = false
    this.mediaError = ''
    this.mediaState = 'ready'
    if (disk.src) {
      this._prepareVideo(disk.src)
    } else {
      this._disposeVideo()
      this.mediaState = 'missing'
    }
    if (this.page !== 'reel') {
      this.setPage('reel')
    } else {
      this.dirty = true
    }
    this.onMediaChange?.()
  }

  eject(page = this.chapterPage) {
    this.disk = null
    this._disposeVideo()
    this.holdGreeting = page === 'hello'
    this.setPage(page)
  }

  _prepareVideo(src) {
    this._disposeVideo()
    const v = document.createElement('video')
    v.loop = true
    v.muted = this.muted
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    this.video = v
    this.mediaState = 'loading'
    v.addEventListener('loadeddata', () => {
      if (this.video !== v) return
      clearTimeout(this.videoTimer)
      this.mediaState = 'ready'
      this.mediaError = ''
      this.dirty = true
      this._syncPlayback()
      this.onMediaChange?.()
    })
    v.addEventListener('error', () =>
      this._videoError(v, '视频读取失败，请换一个文件或重试'),
    )
    this.videoTimer = setTimeout(() => {
      if (v.readyState < 2)
        this._videoError(v, '视频加载超时，请检查路径或重试')
    }, 15000)
    v.src = assetUrl(src)
    v.load()
  }

  _videoError(video, message) {
    if (this.video !== video) return
    clearTimeout(this.videoTimer)
    this.mediaState = 'error'
    this.mediaError = message
    this.dirty = true
    this.onMediaChange?.()
  }

  _syncPlayback() {
    const video = this.video
    if (!video) return
    if (!this.powered || this.page !== 'reel' || this.paused || !this.visible) {
      video.pause()
      return
    }
    video.play().catch((error) => {
      if (this.video !== video || error.name === 'AbortError') return
      if (error.name === 'NotAllowedError') {
        this.mediaState = 'blocked'
        this.mediaError = '点击继续播放以启动视频'
        this.paused = true
        this.dirty = true
        this.onMediaChange?.()
      } else this._videoError(video, '视频播放失败，请检查格式或重试')
    })
  }

  togglePlayback() {
    if (!this.powered || !this.video) return
    this.revealControls()
    this.paused = !this.paused
    if (!this.paused && this.mediaState === 'blocked') {
      this.mediaState = 'ready'
      this.mediaError = ''
    }
    this.dirty = true
    this._syncPlayback()
    this.onMediaChange?.()
  }

  setMuted(muted) {
    this.muted = muted
    if (this.video) this.video.muted = muted
  }

  setVisible(visible) {
    this.visible = visible
    this._syncPlayback()
  }

  _disposeVideo() {
    clearTimeout(this.videoTimer)
    if (this.video) {
      const video = this.video
      this.video = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }

  /** the keyboard is real: whatever you hit shows up in MacWrite */
  typeKey(ch) {
    if (this.page !== 'write') {
      this.setPage('write')
    }
    if (this.page !== 'write') return
    if (ch === '\b') this.typedText = this.typedText.slice(0, -1)
    else if (ch === '\n') this.typedText += '\n'
    else this.typedText = (this.typedText + ch).slice(-240)
    this.dirty = true
  }

  /* ------------------------------------------------------------ input */

  /** nx, ny are 0..1 inside the raster area */
  hitTest(nx, ny) {
    const x = nx * W
    const y = ny * H
    for (const h of this.hotspots) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h
    }
    return null
  }

  setHover(id) {
    if (id) this.revealControls()
    if (this.hovered === id) return
    this.hovered = id
    this.dirty = true
  }

  setPressed(id) {
    if (this.pressed === id) return
    this.pressed = id
    this.dirty = true
  }

  /** fallback action when the glass is clicked but nothing was hit */
  get defaultAction() {
    if (!this.powered) return null
    if (this.page === 'hello') return { action: 'page', page: 'desktop' }
    if (this.openMenu) return { action: 'dismiss-menu' }
    if (this.page === 'reel') return { id: 'pause-reel', action: 'play' }
    return null
  }

  /* ------------------------------------------------------------ update */

  update(dt, elapsed) {
    this.time = elapsed
    if (this.powerState !== 'stopping') this.pageTime += dt
    this.powerTime += dt
    this.transitionTime += dt
    if (this.powerState === 'starting') {
      const step = dt / (this.reduceMotion ? 0.12 : POWER_ON_DURATION)
      this.powerLevel = Math.min(1, this.powerLevel + step)
      if (this.powerLevel === 1) this.powerState = 'on'
    } else if (this.powerState === 'stopping') {
      const clearDuration = this.reduceMotion ? 0.04 : POWER_OFF_CLEAR_DURATION
      // Clear the picture first, then collapse the empty phosphor raster.
      const collapseStep = Math.min(
        dt, Math.max(0, this.powerTime - clearDuration),
      )
      this.powerLevel = Math.max(
        0,
        this.powerLevel - collapseStep / (this.reduceMotion ? 0.12 : POWER_OFF_COLLAPSE_DURATION),
      )
      if (this.powerLevel === 0) {
        this.powerState = 'off'
        this.setPage('off')
        if (this.restartPending) {
          this.restartPending = false
          this.powerOn()
        }
      }
    }
    if (this.controlsShown && !this.showMediaControls) this.dirty = true
    if (this.notice && this.time >= this.noticeUntil) {
      this.notice = ''
      this.dirty = true
    }

    // A cold boot completes on the current chapter's interface.
    if (
      this.powered &&
      this.page === 'hello' &&
      !this.holdGreeting &&
      this.pageTime > (this.reduceMotion ? 0.16 : BOOT_DURATION)
    ) {
      this.setPage(this.disk ? 'reel' : this.chapterPage === 'hello' ? 'desktop' : this.chapterPage)
    }

    this.drawClock += dt
    const animated =
      (this.page === 'hello' && this.powered && this.pageTime <= BOOT_DURATION) ||
      (this.page === 'reel' && this.video && !this.paused)
    const redraw = this.dirty || (animated && this.drawClock >= 1 / 24)
    if (!redraw) return
    this.drawClock = 0
    this._draw()

    // average brightness of the picture → drives the light in front of the glass
    if (this.page === 'off') {
      this.brightness = 0
    } else {
      this._tinyCtx.drawImage(this.canvas, 0, 0, 8, 8)
      const data = this._tinyCtx.getImageData(0, 0, 8, 8).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4)
        sum += (data[i] + data[i + 1] + data[i + 2]) / 765
      this.brightness = sum / 64
    }
  }

  /* ------------------------------------------------------------ draw */

  notify(message, seconds = 2.5) {
    this.notice = message
    this.noticeUntil = this.time + seconds
    this.dirty = true
  }

  closeWindow() {
    if (this.page === 'desktop') {
      this.welcomeClosed = true
      this.dirty = true
    } else this.setPage('desktop')
  }

  paginate({ page, step, size, total }) {
    const last = Math.floor((total - 1) / size) * size
    this.offsets[page] = Math.max(
      0,
      Math.min(last, this.offsets[page] + step * size),
    )
    this.dirty = true
  }

  _pager(page, total, size, y) {
    const offset = this.offsets[page]
    if (offset > 0)
      this._control({
        id: `${page}-previous`,
        label: '← 上一页',
        x: 270,
        y,
        w: 100,
        h: 28,
        action: 'paginate',
        page,
        step: -1,
        size,
        total,
      })
    if (offset + size < total)
      this._control({
        id: `${page}-next`,
        label: '下一页 →',
        x: 382,
        y,
        w: 100,
        h: 28,
        action: 'paginate',
        page,
        step: 1,
        size,
        total,
      })
  }

  _draw() {
    const ctx = this.ctx
    const hasVideo =
      this.page === 'reel' && !this.mediaError && this.video?.readyState >= 2
    const hasGreeting = this.page === 'hello'
    const pixelRatio = hasVideo || hasGreeting ? 2 : 1
    if (this.canvas.width !== W * pixelRatio) {
      this.canvas.width = W * pixelRatio
      this.canvas.height = H * pixelRatio
      // Reallocate immutable GPU storage when changing raster resolution.
      this.texture.dispose()
    }
    // Keep logical coordinates while video and the greeting use a denser raster.
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    ctx.imageSmoothingEnabled = false
    this.hotspots = []
    ctx.save()
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = this.desktopPattern
    ctx.fillRect(0, 0, W, H)
    if (this.page === 'off') {
      ctx.fillStyle = INK
      ctx.fillRect(0, 0, W, H)
    } else if (this.page === 'hello') {
      this._drawHello()
    } else {
      const pages = {
        desktop: () => this._drawDesktop(),
        about: () => this._drawAbout(),
        work: () => this._drawWork(),
        links: () => this._drawLinks(),
        library: () => this._drawLibrary(),
        write: () => this._drawWrite(),
        reel: () => this._drawReel(),
        system: () => this._drawSystem(),
      }
      pages[this.page]?.()
      if (this.page !== 'reel') this._menuBar()
    }
    ctx.restore()
    if (!hasVideo && !hasGreeting) {
      // Rasterize the desktop's type and chrome at its logical resolution.
      const raster = ctx.getImageData(0, 0, W, H)
      for (let i = 0; i < raster.data.length; i += 4) {
        const value = raster.data[i] < 192 ? 0 : 255
        raster.data[i] = raster.data[i + 1] = raster.data[i + 2] = value
      }
      ctx.putImageData(raster, 0, 0)
    }
    if (hasVideo) this._drawMedia()
    if (this.page === 'reel') this._mediaControls()
    if (!this.powered || this.page === 'hello') this.hotspots = []
    this.texture.needsUpdate = true
    this.dirty = false
    this.onDraw?.(this.hotspots)
  }

  _drawHello() {
    const ctx = this.ctx
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = INK
    const faceProgress = this.reduceMotion
      ? 1
      : THREE.MathUtils.smoothstep(
          this.pageTime, FACE_DELAY, FACE_DELAY + FACE_DURATION,
        )
    const visibleRows = Math.floor(HAPPY_FACE_BITMAP.length * faceProgress)
    for (const [y, row] of HAPPY_FACE_BITMAP.entries()) {
      if (y >= visibleRows) break
      for (const [x, pixel] of [...row].entries()) {
        if (pixel === '#') ctx.fillRect(114 + x * 3, 182 + y * 3, 3, 3)
      }
    }
    const writingProgress = this.reduceMotion
      ? 1
      : THREE.MathUtils.clamp(
          (this.pageTime - HANDWRITING_DELAY) / HANDWRITING_DURATION, 0, 1,
        )
    if (writingProgress === 0) return
    ctx.save()
    ctx.translate(198, 174)
    ctx.scale(1.14, 0.96)
    ctx.strokeStyle = INK
    const writingEnd = 0.96
    drawHandwriting(ctx, helloLettering, Math.min(1, writingProgress / writingEnd), 4.6)
    if (writingProgress > writingEnd) {
      ctx.globalAlpha = (writingProgress - writingEnd) / (1 - writingEnd)
      ctx.beginPath()
      ctx.arc(helloLettering.width + 9, 67, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  toggleMenu(name) {
    this.openMenu = this.openMenu === name ? null : name
    this.dirty = true
  }

  activateIcon(icon, direct = false) {
    const now = performance.now()
    const opens =
      direct ||
      (this.selectedIcon === icon.id && now - this.iconClickTime < 500)
    this.selectedIcon = icon.id
    this.iconClickTime = now
    this.dirty = true
    if (!opens) return
    if (icon.page === 'trash') {
      this.notify('The Trash is empty.')
      return
    }
    this.welcomeClosed = false
    if (icon.page === 'desktop') this.dirty = true
    this.setPage(icon.page)
  }

  _menuBar() {
    const ctx = this.ctx
    const entries = [
      { id: 'apple', label: '', x: 8, w: 30 },
      { id: 'file', label: 'File', x: 40, w: 46 },
      { id: 'edit', label: 'Edit', x: 87, w: 46 },
      { id: 'view', label: 'View', x: 134, w: 50 },
      { id: 'special', label: 'Special', x: 185, w: 66 },
    ]
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, W, 22)
    ctx.fillStyle = INK
    ctx.fillRect(0, 21, W, 1)
    for (const entry of entries) {
      this._control({
        ...entry,
        id: `menu-${entry.id}`,
        menu: entry.id,
        label: entry.id === 'apple' ? '' : entry.label,
        x: entry.x,
        y: 0,
        h: 21,
        flat: true,
        selected: this.openMenu === entry.id,
        action: 'menu',
      })
      if (entry.id === 'apple') this.hotspots.at(-1).label = 'Apple menu'
    }
    // Small bitmap Apple mark, independent of private-use font glyphs.
    ctx.fillStyle = this.openMenu === 'apple' ? PAPER : INK
    const apple = [
      '000000110000',
      '000001100000',
      '001110011100',
      '011111111110',
      '111111111000',
      '111111110000',
      '111111110000',
      '111111111000',
      '011111111110',
      '011111111100',
      '001110111000',
    ]
    apple.forEach((row, y) =>
      [...row].forEach((pixel, x) => {
        if (pixel === '1') ctx.fillRect(17 + x, 4 + y, 1, 1)
      }),
    )
    if (!this.openMenu) return
    const menus = {
      apple: [
        { label: 'About the Finder…', action: 'page', page: 'system' },
        { label: 'Note Pad', action: 'page', page: 'write' },
      ],
      file: [
        { label: 'Open', action: 'open-icon', disabled: !this.selectedIcon },
        { label: 'Close Window', action: 'desktop' },
        { label: 'Eject', action: 'eject', disabled: !this.driveDisk },
        { label: 'Movies', action: 'page', page: 'library' },
      ],
      edit: [
        {
          label: 'Select All',
          action: 'select-note',
          disabled: this.page !== 'write',
        },
        {
          label: 'Clear',
          action: 'clear-note',
          disabled: this.page !== 'write' || !this.typedText,
        },
      ],
      view: [
        {
          label: `${this.finderList ? '' : '✓ '}by Icon`,
          action: 'view',
          list: false,
        },
        {
          label: `${this.finderList ? '✓ ' : ''}by Name`,
          action: 'view',
          list: true,
        },
      ],
      special: [
        { label: 'Clean Up', action: 'clean-up' },
        { label: 'Restart', action: 'restart' },
        { label: 'Shut Down', action: 'power' },
      ],
    }
    const entry = entries.find((item) => item.id === this.openMenu)
    const items = menus[this.openMenu]
    const x = entry.x
    const height = items.length * 24 + 4
    ctx.fillStyle = INK
    ctx.fillRect(x + 2, 23, 180, height + 2)
    ctx.fillStyle = PAPER
    ctx.fillRect(x, 22, 179, height)
    ctx.strokeStyle = INK
    ctx.strokeRect(x + 0.5, 21.5, 179, height)
    const menuHotspots = []
    items.forEach((item, i) => {
      const control = {
        ...item,
        id: `command-${this.openMenu}-${i}`,
        x: x + 1,
        y: 24 + i * 24,
        w: 177,
        h: 24,
        flat: true,
      }
      if (item.disabled) {
        ctx.fillStyle = INK
        ctx.font = FONT
        ctx.fillText(item.label, x + 13, control.y + 16)
        ctx.fillStyle = this.desktopPattern
        ctx.globalAlpha = 0.5
        ctx.fillRect(x + 2, control.y, 175, 23)
        ctx.globalAlpha = 1
      } else {
        this._control(control)
        menuHotspots.push(this.hotspots.pop())
      }
    })
    // A menu shields the window beneath it, including disabled commands.
    this.hotspots = [
      ...menuHotspots,
      ...this.hotspots.filter((h) => h.action === 'menu'),
      {
        id: 'menu-dismiss',
        label: '关闭菜单',
        x: 0,
        y: 22,
        w: W,
        h: H - 22,
        action: 'dismiss-menu',
      },
    ]
  }

  _drawSystem() {
    const ctx = this.ctx
    const rect = this._window('About the Finder', {
      x: 64,
      y: 94,
      w: 384,
      h: 216,
    })
    ctx.fillStyle = INK
    ctx.font = `32px ${LATIN_FONT_FAMILY}`
    ctx.fillText('Macintosh', rect.x + 16, rect.y + 35)
    ctx.font = FONT
    ctx.fillText('Finder', rect.x + 16, rect.y + 68)
    ctx.fillText(
      'A personal desktop by ' + this.site.identity.name,
      rect.x + 16,
      rect.y + 98,
    )
    ctx.fillText('128K of memories.', rect.x + 16, rect.y + 128)
  }

  _control(control) {
    control = { ...control, label: t(control.label) }
    const ctx = this.ctx
    const { label, id, flat, selected, icon, x, y, w, h } = control
    const active = this.pressed === id || selected
    ctx.fillStyle = active ? INK : PAPER
    ctx.fillRect(x, y, w, h)
    if (!flat) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    }
    if (this.hovered === id && !active) {
      ctx.save()
      ctx.strokeStyle = INK
      ctx.setLineDash([1, 1])
      ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5)
      ctx.restore()
    }
    ctx.fillStyle = active ? PAPER : INK
    ctx.font = MENU_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const iconSpace = icon ? 24 : 0
    const maxTextWidth = w - 12 - iconSpace
    if (icon) {
      const textWidth = Math.min(ctx.measureText(label).width, maxTextWidth)
      const iconX = Math.round(x + (w - textWidth - iconSpace) / 2)
      const iconY = Math.round(y + (h - 16) / 2)
      drawLinkIcon(ctx, icon, iconX, iconY, 16, ctx.fillStyle)
    }
    ctx.fillText(label, x + (w + iconSpace) / 2, y + h / 2, maxTextWidth)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    this.hotspots.push(control)
  }

  _window(title, { x = 18, y = 60, w = 476, h = 318 } = {}) {
    title = t(title)
    const ctx = this.ctx
    ctx.fillStyle = INK
    ctx.fillRect(x + 2, y + 2, w, h)
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = PAPER
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2)
    ctx.fillStyle = INK
    for (let row = 0; row < 6; row++) {
      ctx.fillRect(x + 4, y + 5 + row * 2, w - 8, 1)
    }
    ctx.fillRect(x, y + 21, w, 1)
    ctx.font = MENU_FONT
    const titleWidth = Math.min(ctx.measureText(title).width, w - 84)
    ctx.fillStyle = PAPER
    ctx.fillRect(x + (w - titleWidth) / 2 - 7, y + 2, titleWidth + 14, 18)
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.fillText(title, x + w / 2, y + 15, w - 84)
    ctx.textAlign = 'left'
    ctx.fillStyle = PAPER
    ctx.fillRect(x + 6, y + 3, 17, 16)
    ctx.fillStyle = INK
    ctx.fillRect(x + 9, y + 5, 11, 11)
    ctx.fillStyle = this.pressed === 'window-close' ? INK : PAPER
    ctx.fillRect(x + 10, y + 6, 9, 9)
    this.hotspots.push({
      id: 'window-close',
      label: '关闭窗口',
      x: x + 4,
      y: y + 1,
      w: 22,
      h: 20,
      action: 'desktop',
    })
    return { x: x + 20, y: y + 32, w: w - 40, h: h - 46 }
  }

  _folderIcon(x, y, type = 'folder', inverted = false) {
    const ctx = this.ctx
    const ink = inverted ? PAPER : INK
    const paper = inverted ? INK : PAPER
    ctx.fillStyle = ink
    if (type === 'disk') {
      ctx.fillRect(x, y, 34, 36)
      ctx.fillStyle = paper
      ctx.fillRect(x + 7, y + 2, 20, 12)
      ctx.fillRect(x + 5, y + 21, 24, 12)
      ctx.fillStyle = ink
      ctx.fillRect(x + 20, y + 3, 5, 10)
    } else if (type === 'trash') {
      ctx.fillRect(x + 5, y + 6, 24, 29)
      ctx.fillStyle = paper
      ctx.fillRect(x + 6, y + 7, 22, 27)
      ctx.fillStyle = ink
      ctx.fillRect(x + 3, y + 3, 28, 3)
      ctx.fillRect(x + 12, y, 10, 3)
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 9 + i * 5, y + 10, 1, 21)
    } else if (type === 'note') {
      ctx.fillRect(x + 3, y, 28, 36)
      ctx.fillStyle = paper
      ctx.fillRect(x + 4, y + 1, 26, 34)
      ctx.fillStyle = ink
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 9, y + 9 + i * 6, 16, 1)
    } else {
      ctx.fillRect(x, y + 6, 34, 27)
      ctx.fillRect(x + 2, y + 1, 15, 10)
      ctx.fillStyle = paper
      ctx.fillRect(x + 1, y + 7, 32, 25)
      ctx.fillRect(x + 3, y + 2, 13, 8)
    }
  }

  _desktopIcon(app) {
    app = { ...app, label: t(app.label) }
    const ctx = this.ctx
    const active = this.selectedIcon === app.id
    const width = app.w || 88
    ctx.fillStyle = active ? INK : PAPER
    if (active) ctx.fillRect(app.x - 20, app.y - 2, 40, 40)
    this._folderIcon(app.x - 17, app.y, app.type, active)
    ctx.font = FONT
    ctx.textAlign = 'center'
    const labelWidth = Math.ceil(ctx.measureText(app.label).width) + 6
    ctx.fillStyle = active ? INK : PAPER
    ctx.fillRect(app.x - labelWidth / 2, app.y + 41, labelWidth, 16)
    ctx.fillStyle = active ? PAPER : INK
    ctx.fillText(app.label, app.x, app.y + 53)
    ctx.textAlign = 'left'
    this.hotspots.push({
      ...app,
      x: app.x - width / 2,
      y: app.y - 4,
      w: width,
      h: 64,
      page: app.page || app.id,
      action: 'icon',
    })
  }

  _drawDesktop() {
    const ctx = this.ctx
    this._desktopIcon({
      id: 'system-disk',
      page: 'desktop',
      label: 'System Disk',
      x: 457,
      y: 40,
      type: 'disk',
    })
    this._desktopIcon({
      id: 'trash',
      page: 'trash',
      label: 'Trash',
      x: 457,
      y: 338,
      type: 'trash',
    })
    if (this.welcomeClosed) return
    this._window('System Disk', { x: 20, y: 70, w: 378, h: 284 })
    ctx.fillStyle = INK
    ctx.font = FONT
    ctx.fillText('5 items', 32, 108)
    ctx.fillText('105K in disk', 145, 108)
    ctx.fillText('23K available', 280, 108)
    ctx.fillRect(21, 116, 376, 1)
    // Finder scroll bars and the lower-right resize box.
    ctx.strokeStyle = INK
    ctx.strokeRect(381.5, 117.5, 16, 235)
    ctx.strokeRect(20.5, 337.5, 377, 16)
    ctx.fillText('↑', 386, 130)
    ctx.fillText('↓', 386, 331)
    ctx.fillText('←', 25, 350)
    ctx.fillText('→', 367, 350)
    ctx.strokeRect(382.5, 338.5, 14, 14)
    const apps = [
      { id: 'about', label: '我的档案', type: 'note' },
      {
        id: 'work',
        label:
          this.site.sections.find((section) => section.id === 'work')
            ?.navLabel || '作品集',
      },
      { id: 'library', label: '影碟柜' },
      { id: 'write', label: 'Note Pad', type: 'note' },
      { id: 'links', label: '链接' },
    ]
    apps.forEach((app, i) => {
      if (!this.finderList) {
        this._desktopIcon({
          ...app,
          x: 83 + (i % 3) * 108,
          y: 142 + Math.floor(i / 3) * 94,
        })
      } else {
        const y = 128 + i * 36
        this._control({
          ...app,
          id: app.id,
          x: 30,
          y,
          w: 342,
          h: 30,
          flat: true,
          selected: this.selectedIcon === app.id,
          page: app.id,
          action: 'icon',
        })
      }
    })
    if (this.time < this.noticeUntil) {
      ctx.fillStyle = PAPER
      ctx.fillRect(24, 370, 374, 25)
      ctx.fillStyle = INK
      ctx.font = FONT
      ctx.fillText(t(this.notice), 32, 387, 358)
    }
  }

  _wrap(text, maxWidth) {
    const lines = []
    let line = ''
    for (const char of text) {
      if (char === '\n') {
        lines.push(line)
        line = ''
      } else if (line && this.ctx.measureText(line + char).width > maxWidth) {
        lines.push(line)
        line = char
      } else line += char
    }
    lines.push(line)
    return lines
  }

  _drawAbout() {
    const ctx = this.ctx
    const rect = this._window('About me')
    const identity = this.site.identity
    ctx.fillStyle = INK
    ctx.font = `40px ${LATIN_FONT_FAMILY}`
    ctx.fillText(identity.name, rect.x, rect.y + 30)
    ctx.font = FONT
    ctx.fillText(t(identity.role), rect.x, rect.y + 58, rect.w)
    ctx.font = MONO
    ctx.fillText(identity.location, rect.x, rect.y + 80, rect.w)
    ctx.font = FONT
    this._wrap(t(identity.bio), rect.w)
      .slice(0, 5)
      .forEach((line, index) =>
        ctx.fillText(line, rect.x, rect.y + 116 + index * 24),
      )
    this._control({
      id: 'about-work',
      label: t('查看{title} →', { title: t(this.site.sections.find((section) => section.id === 'work')?.navLabel || '我的作品') }),
      x: rect.x,
      y: 330,
      w: 190,
      h: 32,
      action: 'page',
      page: 'work',
    })
    this._control({
      id: 'about-links',
      label: '找到我 ↗',
      x: rect.x + 216,
      y: 330,
      w: 220,
      h: 32,
      action: 'page',
      page: 'links',
    })
  }

  _drawWork() {
    const ctx = this.ctx
    const section = this.site.sections.find((item) => item.id === 'work')
    const rect = this._window(section?.navLabel || 'Selected work')
    const works = section?.blocks?.[0]?.items || []
    works
      .slice(this.offsets.work, this.offsets.work + 3)
      .forEach((work, index) => {
        const y = 106 + index * 82
        const id = `work-${index + this.offsets.work}`
        const interactive = Boolean(work.href || work.disk || work.page)
        const selected =
          interactive && (this.hovered === id || this.pressed === id)
        ctx.fillStyle = selected ? INK : PAPER
        ctx.fillRect(rect.x - 7, y - 6, rect.w + 14, 74)
        ctx.fillStyle = selected ? PAPER : INK
        ctx.font = MENU_FONT
        ctx.fillText(t(work.title), rect.x + 4, y + 16, rect.w - 28)
        ctx.font = FONT
        this._wrap(t(work.desc), rect.w - 12)
          .slice(0, 2)
          .forEach((line, lineIndex) =>
            ctx.fillText(line, rect.x + 4, y + 38 + lineIndex * 18),
          )
        if (interactive)
          this.hotspots.push({
            id,
            label: t('打开作品 {title}', { title: t(work.title) }),
            x: rect.x - 7,
            y: y - 6,
            w: rect.w + 14,
            h: 74,
            action: 'work',
            index: index + this.offsets.work,
          })
      })
    this._pager('work', works.length, 3, 348)
  }

  _drawLinks() {
    const ctx = this.ctx
    const rect = this._window('Elsewhere on the internet')
    const links = getSiteLinks(this.site)
    links
      .slice(this.offsets.links, this.offsets.links + 4)
      .forEach((link, index) => {
        const y = rect.y + index * 60
        this._control({
          id: `link-${index}`,
          label: link.label,
          icon: link.icon || 'website',
          x: rect.x,
          y,
          w: rect.w,
          h: 44,
          action: 'link',
          href: link.href,
        })
      })
    ctx.font = SMALL
    ctx.fillStyle = INK
    ctx.fillText(t('在浏览器中打开'), rect.x, 358)
    this._pager('links', links.length, 4, 340)
  }

  _drawLibrary() {
    const ctx = this.ctx
    const rect = this._window('影碟柜')
    const disks = [...this.site.disks].sort((a, b) => Number(a.year) - Number(b.year))
    disks
      .slice(this.offsets.library, this.offsets.library + 4)
      .forEach((disk, index) => {
        const title = `${disk.year} · ${t(disk.title)}`
        const y = 106 + index * 55
        const selected = this.driveDisk === disk.id
        const id = `disk-${disk.id}`
        const active = this.hovered === id || this.pressed === id || selected
        ctx.fillStyle = active ? INK : PAPER
        ctx.fillRect(rect.x - 8, y - 6, rect.w + 16, 50)
        this._folderIcon(rect.x, y, 'disk', active)
        ctx.fillStyle = active ? PAPER : INK
        ctx.font = MENU_FONT
        ctx.fillText(title, rect.x + 50, y + 13, rect.w - 130)
        ctx.font = SMALL
        ctx.fillText(t(disk.note), rect.x + 50, y + 31, rect.w - 130)
        ctx.fillText(
          t(selected ? (this.driveBusy ? '读盘中…' : '已放入') : '播放 ↗'),
          rect.x + rect.w - 60,
          y + 21,
          60,
        )
        this.hotspots.push({
          id,
          label: t('播放 {title}', { title }),
          x: rect.x - 8,
          y: y - 6,
          w: rect.w + 16,
          h: 50,
          action: 'disk',
          disk: disk.id,
        })
      })
    this._control({
      id: 'upload',
      label: '＋ 放入本地视频',
      x: rect.x,
      y: 330,
      w: this.site.disks.length > 4 ? 216 : rect.w,
      h: 32,
      action: 'upload',
    })
    this._pager('library', this.site.disks.length, 4, 332)
  }

  revealControls() {
    this.controlsUntil = this.time + 2.5
    if (!this.controlsShown) this.dirty = true
  }

  get showMediaControls() {
    return (
      this.keyboardFocus ||
      this.paused ||
      this.mediaState !== 'ready' ||
      this.time < this.controlsUntil
    )
  }

  _drawReel() {
    const ctx = this.ctx
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, W, H)
    if (this.mediaState === 'ready') return
    ctx.fillStyle = PAPER
    ctx.textAlign = 'center'
    ctx.font = `24px ${FONT_FAMILY}`
    ctx.fillText(t(this.disk?.title || 'MoviePlayer'), W / 2, 166, W - 64)
    ctx.font = FONT
    const message =
      this.mediaState === 'missing'
        ? '请为这张影碟选择视频文件'
        : this.mediaError || '正在读取影碟…'
    ctx.fillText(t(message), W / 2, 208, W - 64)
    ctx.textAlign = 'left'
  }

  _mediaControls() {
    this.controlsShown = this.showMediaControls
    const controls = [
      {
        id: 'media-play',
        label:
          this.mediaState === 'missing'
            ? '选择影片'
            : this.mediaState === 'error'
              ? '重试'
              : this.paused
                ? '继续播放'
                : '暂停',
        action:
          this.mediaState === 'missing'
            ? 'upload'
            : this.mediaState === 'error'
              ? 'retry'
              : 'play',
      },
      { id: 'media-library', label: '换片', action: 'change-disk' },
      { id: 'media-eject', label: '退盘', action: 'eject' },
    ]
    const buttonWidth = 96
    const gap = 8
    const left =
      (W - controls.length * buttonWidth - (controls.length - 1) * gap) / 2
    const buttons = controls.map((control, index) => ({
      ...control,
      x: left + index * (buttonWidth + gap),
      y: 364,
      w: buttonWidth,
      h: 28,
    }))
    this.hotspots.push(...buttons)
    if (!this.controlsShown) return

    const ctx = this.ctx
    ctx.save()
    ctx.font = MENU_FONT
    ctx.fillStyle = PAPER
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
    ctx.shadowBlur = 2
    ctx.shadowOffsetY = 1
    buttons.forEach(({ id, label, x, y, w, h }) => {
      const active = this.hovered === id || this.pressed === id
      const text = t(label)
      ctx.globalAlpha = active ? 1 : 0.78
      ctx.fillText(text, x + w / 2, y + h / 2, w - 16)
      if (active) {
        const width = Math.min(ctx.measureText(text).width, w - 16)
        ctx.fillRect(x + (w - width) / 2, y + h - 5, width, 1)
      }
    })
    ctx.restore()
  }

  _drawMedia() {
    const source = this.video
    const width = source.videoWidth
    const height = source.videoHeight
    if (!width || !height) return
    const viewport = MEDIA_VIEWPORT
    // Fill the CRT height without stretching; crop horizontal overflow at the canvas edges.
    const scale = viewport.h / height
    const dw = width * scale
    const dh = height * scale
    this.ctx.save()
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'
    this.ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh)
    this.ctx.restore()
  }

  _drawWrite() {
    const ctx = this.ctx
    const rect = this._window('Note Pad')
    ctx.fillStyle = PAPER
    ctx.fillRect(rect.x - 8, 83, rect.w + 16, 256)
    ctx.fillStyle = INK
    ctx.fillRect(rect.x - 8, 102, rect.w + 16, 1)
    for (let tick = 0; tick <= 36; tick++) {
      const height = tick % 4 === 0 ? 10 : 4
      ctx.fillRect(rect.x + tick * 12, 102 - height, 1, height)
    }
    ctx.font = FONT
    const lines = this._wrap(this.typedText, rect.w - 12).slice(-8)
    if (!this.typedText) {
      ctx.fillText(t('点击这里，写点什么…'), rect.x + 4, 126)
    }
    lines.forEach((line, index) =>
      ctx.fillText(line, rect.x + 4, 126 + index * 25),
    )
    this.hotspots.push({
      id: 'write-area',
      label: '写一张便笺',
      x: rect.x - 4,
      y: 104,
      w: rect.w + 8,
      h: 226,
      action: 'write',
      input: true,
    })
    ctx.fillStyle = INK
    ctx.font = MONO
    ctx.fillText(`${this.typedText.length} / 240`, rect.x, 359)
  }
}
