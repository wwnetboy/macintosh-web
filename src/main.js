import * as THREE from 'three'
import { site } from './content/site.js'
import { t } from './content/i18n.js'
import { Stage } from './core/Stage.js'
import { CameraRig } from './core/CameraRig.js'
import { Audio } from './core/Audio.js'
import { CrtScreen } from './scene/CrtScreen.js'
import { Mac } from './scene/Mac.js'
import { Disks } from './scene/Disks.js'
import { AppUI } from './ui/AppUI.js'
import { compactLayout } from './core/viewport.js'

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
const pointerQuery = matchMedia('(hover: hover) and (pointer: fine)')
const ui = new AppUI()
if (import.meta.hot) import.meta.hot.dispose(() => ui.dispose())

async function main() {
  const canvas = document.getElementById('stage')
  const stage = new Stage(canvas, { reduceMotion: motionQuery.matches })
  if (import.meta.hot) import.meta.hot.dispose(() => stage.disposeAtmosphere())
  const audio = new Audio(site.sound)
  const crt = new CrtScreen(site)
  ui.onLanguageChange = () => {
    crt.dirty = true
    ui.hotspotSignature = null
    ui.setScreenPage(crt.page)
    ui.setMedia(crt)
  }
  crt.reduceMotion = motionQuery.matches
  const chapterPages = [site.hero, ...site.sections].map(
    section => section.screenPage || 'desktop',
  )
  let screenChapter = ui.pager.index
  crt.setChapterPage(chapterPages[screenChapter])
  const rig = new CameraRig(stage.camera, site.camera.presets, {
    reduceMotion: motionQuery.matches,
  })
  const mac = new Mac(stage, site, crt)
  const localVideoUrls = new Map()
  let soundOn = false
  let focusAfterDisk = false
  let contextLost = false
  let animationFrame = 0
  let lastFrame = 0
  let elapsed = 0
  let focusScrollY = scrollY
  let lastDocumentScrollY = scrollY
  let pointerDown = null

  const initialPreset = ui.sections[ui.pager.index].dataset.camera
  rig.framingTarget =
    compactLayout.matches ? 0 : site.camera.presets[initialPreset].framing
  rig.framingSmooth = rig.framingTarget
  rig.snap(initialPreset)
  ui.setLoading(0.02)
  await mac.load((progress) => ui.setLoading(0.04 + progress * 0.87))
  const disks = new Disks(site, mac, { reduceMotion: motionQuery.matches })
  if (import.meta.hot) import.meta.hot.dispose(() => disks.dispose())
  await disks.ready
  const sceneHints = [
    {
      kind: 'computer',
      label: '查看电脑',
      point: mac.screen.center
        .clone()
        .add(new THREE.Vector3(0.015, -0.125, 0.08)),
    },
  ]
  if (mac.anchors.keyboard)
    sceneHints.push({
      kind: 'keyboard',
      label: '写张便笺',
      point: mac.anchors.keyboard.clone().add(new THREE.Vector3(0, 0.02, 0)),
    })
  if (disks.list.length)
    sceneHints.push({
      kind: 'disk',
      label: `${disks.list[0].data.title} · 开盒放映`,
      point: disks.list[0].home.position
        .clone()
        .add(new THREE.Vector3(0, 0.013, 0)),
      disk: disks.list[0].data.id,
    })
  ui.setSceneHints(sceneHints)
  crt.onDraw = () => ui.syncScreenHotspots(crt, mac)

  function notify(message) {
    if (rig.focused) crt.notify(message)
    else ui.toast(message)
  }

  function focusScreen(page, preset = 'screen') {
    cancelDrag()
    if (!page && preset === 'screen' && crt.page === 'hello') page = 'desktop'
    if (page && crt.powered) crt.setPage(page)
    if (!rig.focused) {
      focusScrollY = scrollY
      rig.framingTarget = 0
      ui.enterFocus()
    }
    rig.focus(preset)
    document.body.dataset.focusView = preset
    ui.screenAccess.hidden = preset !== 'screen'
    if (preset !== 'screen') {
      crt.openMenu = null
      crt.dirty = true
    }
    ui.setScreenPage(crt.page)
    ui.setMedia(crt)
    ui.hideTip()
  }

  function exitFocus() {
    focusAfterDisk = false
    if (!rig.focused) return
    cancelDrag()
    rig.unfocus()
    ui.exitFocus()
    ui.hideTip()
    crt.setHover(null)
    screenChapter = ui.pager.nearest(scrollY)
    crt.setChapterPage(chapterPages[screenChapter])
  }
  ui.focusBack.addEventListener('click', exitFocus)

  function openNotebook() {
    focusScreen('write')
    if (crt.page !== 'write') return
    audio.play('key')
    requestAnimationFrame(() => ui.noteInput.focus({ preventScroll: true }))
  }

  function selectDisk(id) {
    const disk = disks.list.find((item) => item.data.id === id)
    if (!disk) return
    ui.pager.stop()
    lastDocumentScrollY = scrollY
    focusAfterDisk = true
    if (disk === disks.current && disk.state === 'inside' && !disks.busy) {
      crt.playDisk(disk.data)
      focusScreen(null, 'computer')
      return
    }
    crt.eject()
    focusScreen(null, 'disks')
    disks.pick(disk)
  }

  function togglePower() {
    focusAfterDisk = false
    crt.restartPending = false
    crt.togglePower()
    ui.screenStatus.textContent = t(crt.powered ? '电脑正在开机' : '电脑正在关机')
  }

  function ejectDisk(page = crt.chapterPage) {
    focusAfterDisk = false
    disks.eject()
    crt.eject(page)
    notify('已退盘')
  }

  crt.onPageChange = (page) => {
    ui.setScreenPage(page)
    ui.setMedia(crt)
  }
  crt.onMediaChange = () => ui.setMedia(crt)
  crt.onPowerChange = (on) => {
    audio.setPower(on)
    audio.play(on ? 'power' : 'power-off')
  }
  disks.onSound = (name) => audio.play(name)
  disks.onChange = (disk, busy) => {
    crt.driveDisk = disk?.data.id || null
    crt.driveBusy = busy
    crt.dirty = true
    if (busy) crt.notify(disk ? t('正在读取 {title}', { title: t(disk.data.title) }) : '正在退盘…')
  }
  disks.onPlay = (disk) => {
    crt.playDisk(disk)
    audio.play('read')
    if (focusAfterDisk) focusScreen(null, 'computer')
    notify(t('已放入《{title}》', { title: t(disk.title) }))
  }

  // Both pointer hotspots and semantic controls use the same application actions.
  document.addEventListener('click', (event) => {
    if (event.target.closest('a[href^="#"]')) exitFocus()
    const button = event.target.closest('button')
    if (!button || button.disabled) return
    if (button.dataset.hotspot === 'hardware-power') togglePower()
    else if (button.dataset.hotspot)
      runHotspot(
        crt.hotspots.find((hotspot) => hotspot.id === button.dataset.hotspot),
        event.detail === 0,
      )
    if (button.dataset.page) focusScreen(button.dataset.page)
    if (button.dataset.scene === 'computer') focusScreen(null, 'computer')
    if (button.dataset.scene === 'keyboard') openNotebook()
    if (button.dataset.disk) selectDisk(button.dataset.disk)
  })
  ui.soundBtn.addEventListener('click', async () => {
    ui.soundBtn.disabled = true
    try {
      if (soundOn) {
        audio.disable()
        soundOn = false
      } else soundOn = await audio.enable()
      crt.setMuted(!soundOn)
      audio.setPower(crt.powered)
      ui.setSound(soundOn)
      if (soundOn && crt.powered) audio.play('power')
    } catch {
      notify('声音暂时无法开启，请再试一次')
    } finally {
      ui.soundBtn.disabled = false
    }
  })
  ui.noteInput.addEventListener('input', () => {
    crt.typedText = ui.noteInput.value.slice(0, 240)
    crt.dirty = true
  })
  window.addEventListener('pointerup', () => crt.setPressed(null))
  window.addEventListener('pointercancel', () => crt.setPressed(null))
  window.addEventListener('blur', () => crt.setPressed(null))
  ui.fileInput.addEventListener('change', () => {
    const file = ui.fileInput.files?.[0]
    ui.fileInput.value = ''
    if (!file) return
    if (
      !file.type.startsWith('video/') &&
      !/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(file.name)
    ) {
      notify('请选择 MP4、WebM 或其他浏览器支持的视频文件')
      return
    }
    const disk = disks.current || disks.list[0]
    if (!disk) return
    crt.eject()
    const previousUrl = localVideoUrls.get(disk.data.id)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    const localVideoUrl = URL.createObjectURL(file)
    localVideoUrls.set(disk.data.id, localVideoUrl)
    Object.assign(disk.data, {
      kind: 'video',
      src: localVideoUrl,
    })
    selectDisk(disk.data.id)
    notify('录像已放入，文件仅在当前浏览器中播放')
  })

  let frames = []
  function measure() {
    frames = ui.sections.map((section) => ({
      preset: section.dataset.camera || 'wide',
      y: section.offsetTop,
    }))
  }
  measure()
  const layoutObserver = new ResizeObserver(measure)
  layoutObserver.observe(document.getElementById('page'))
  document.fonts?.ready.then(measure)

  function readTimeline() {
    const chapter = ui.pager.nearest(scrollY)
    if (chapter !== screenChapter) {
      screenChapter = chapter
      crt.setChapterPage(chapterPages[chapter])
    }
    const y = window.scrollY
    let index = frames.findIndex(
      (frame, i) => i < frames.length - 1 && y < frames[i + 1].y,
    )
    if (index < 0) index = frames.length - 1
    const a = frames[index]
    const b = frames[Math.min(index + 1, frames.length - 1)]
    const t = a === b ? 0 : THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1)
    const blend = motionQuery.matches ? Math.round(t) : t
    rig.setBlend(a.preset, b.preset, blend)
    const framingA = site.camera.presets[a.preset].framing || 0
    const framingB = site.camera.presets[b.preset].framing || 0
    rig.framingTarget =
      compactLayout.matches
        ? 0
        : THREE.MathUtils.lerp(
            framingA,
            framingB,
            blend * blend * (3 - 2 * blend),
          )
  }

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const pickables = mac.targets.map(({ object, kind }) => ({
    obj: object,
    kind,
  }))
  function pickAt(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2)
    raycaster.setFromCamera(ndc, stage.camera)
    // The model participates as an occluder, so a hidden screen or disk cannot
    // be clicked through the computer, chair, or desk.
    const hits = raycaster.intersectObjects(
      [mac.group, ...disks.pickables],
      true,
    )
    for (const hit of hits) {
      let object = hit.object
      let result = null
      let visible = true
      while (object) {
        if (!object.visible) visible = false
        if (object.userData.disk?.state === 'idle')
          result = { kind: 'disk', disk: object.userData.disk, hit }
        const target = pickables.find((entry) => entry.obj === object)
        if (target) result = { ...target, hit }
        object = object.parent
      }
      if (visible) return result
    }
    return null
  }

  function runHotspot(hotspot, direct = false) {
    if (!hotspot) return
    if (!crt.powered) return
    audio.play('click')
    if (hotspot.action !== 'menu') crt.openMenu = null
    crt.dirty = true
    if (hotspot.action === 'menu') crt.toggleMenu(hotspot.menu)
    if (hotspot.action === 'icon') crt.activateIcon(hotspot, direct)
    if (hotspot.action === 'open-icon') {
      const page =
        crt.selectedIcon === 'system-disk' ? 'desktop' : crt.selectedIcon
      crt.activateIcon({ id: crt.selectedIcon, page }, true)
    }
    if (hotspot.action === 'view') {
      crt.finderList = hotspot.list
      crt.welcomeClosed = false
      crt.setPage('desktop')
    }
    if (hotspot.action === 'clean-up') crt.selectedIcon = null
    if (hotspot.action === 'restart') crt.restart()
    if (hotspot.action === 'power') togglePower()
    if (hotspot.action === 'clear-note') {
      crt.typedText = ''
      ui.noteInput.value = ''
    }
    if (hotspot.action === 'select-note') {
      ui.noteInput.focus({ preventScroll: true })
      ui.noteInput.select()
    }
    if (hotspot.action === 'page') crt.setPage(hotspot.page)
    if (hotspot.action === 'desktop') crt.closeWindow()
    if (hotspot.action === 'paginate') crt.paginate(hotspot)
    if (hotspot.action === 'link')
      window.open(hotspot.href, '_blank', 'noopener,noreferrer')
    if (hotspot.action === 'eject') ejectDisk()
    if (hotspot.action === 'change-disk') ejectDisk('library')
    if (hotspot.action === 'play') crt.togglePlayback()
    if (hotspot.action === 'exit') exitFocus()
    if (hotspot.action === 'disk') selectDisk(hotspot.disk)
    if (hotspot.action === 'upload') ui.fileInput.click()
    if (hotspot.action === 'retry' && crt.disk) {
      if (crt.mediaState === 'blocked') crt.togglePlayback()
      else crt.playDisk(crt.disk)
    }
    if (hotspot.action === 'work') {
      const work = site.sections.find((section) => section.id === 'work')
        ?.blocks[0]?.items[hotspot.index]
      if (work?.href) window.open(work.href, '_blank', 'noopener,noreferrer')
      else if (work?.disk) selectDisk(work.disk)
      else if (work?.page) crt.setPage(work.page)
    }
  }

  // Use the whole viewport so text and scene share one continuous pointer input.
  window.addEventListener(
    'pointermove',
    (event) => {
      if (
        event.pointerType !== 'mouse' ||
        event.buttons ||
        !pointerQuery.matches ||
        motionQuery.matches ||
        rig.focused ||
        ui.menu.open
      )
        return
      rig.setPointer(
        (event.clientX / innerWidth) * 2 - 1,
        (event.clientY / innerHeight) * 2 - 1,
      )
    },
    { passive: true },
  )
  const resetPointer = () => rig.setPointer(0, 0)
  document.documentElement.addEventListener('pointerleave', resetPointer)
  window.addEventListener('blur', resetPointer)
  window.addEventListener('resize', resetPointer, { passive: true })
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'mouse') resetPointer()
      if (!event.isPrimary) cancelDrag()
    },
    { passive: true },
  )
  pointerQuery.addEventListener('change', resetPointer)

  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch' || pointerDown) return
      const hit = pickAt(event.clientX, event.clientY)
      disks.setHover(hit?.kind === 'disk' ? hit.disk : null)
      crt.setHover(null)
      if (!hit) return ui.hideTip()
      let label = '点击放大屏幕 · 拖动旋转'
      if (hit.kind === 'disk') label = t('{title} · 开盒放映', { title: t(hit.disk.data.title) })
      if (hit.kind === 'computer') label = '点击查看机身 · 拖动旋转'
      if (hit.kind === 'power') label = crt.powered ? '关闭电源' : '打开电源'
      if (hit.kind === 'drive')
        label = disks.current ? '点击退盘' : '选择一张光盘'
      if (hit.kind === 'keyboard') label = '键盘 · 写一张便笺'
      if (hit.kind === 'screen' && rig.lockName === 'screen') {
        crt.revealControls()
        const uv = mac.uvToScreen(hit.hit.uv)
        const hotspot = uv && crt.hitTest(uv.nx, uv.ny)
        crt.setHover(hotspot?.id)
        label = crt.page === 'reel' ? '点击暂停 / 继续' : '点击屏幕图标'
      }
      canvas.style.cursor = 'pointer'
      if (rig.lockName !== 'screen')
        ui.showTip(label, event.clientX, event.clientY)
    },
    { passive: true },
  )
  canvas.addEventListener('pointerleave', () => {
    if (rig.dragging) return
    disks.setHover(null)
    crt.setHover(null)
    ui.hideTip()
  })

  function cancelDrag() {
    const start = pointerDown
    pointerDown = null
    rig.endOrbit()
    document.body.classList.remove('is-orbiting')
    canvas.classList.remove('is-dragging')
    if (start && canvas.hasPointerCapture(start.id))
      canvas.releasePointerCapture(start.id)
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return
    pointerDown = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      scroll: scrollY,
      moved: false,
      axis: null,
      canOrbit:
        rig.lockName !== 'screen' &&
        !ui.menu.open &&
        !contextLost &&
        document.body.classList.contains('booted') &&
        (ui.pager.phase === 'idle' || event.pointerType === 'touch'),
    }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    const start = pointerDown
    if (!start || event.pointerId !== start.id) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) <= 8) return
    start.moved = true
    // Browsing uses vertical swipes for paging. Focused objects use both axes.
    start.axis ||=
      event.pointerType === 'touch' &&
      !rig.focused &&
      Math.abs(dy) > Math.abs(dx)
        ? 'page'
        : 'orbit'
    if (!start.canOrbit || start.axis === 'page') return
    if (!rig.dragging) {
      ui.pager.stop()
      ui.pager.touch = null
      focusAfterDisk = false
      rig.beginOrbit()
      disks.setHover(null)
      crt.setHover(null)
      ui.hideTip()
      document.body.classList.add('is-orbiting')
      canvas.classList.add('is-dragging')
    }
    rig.rotate(
      (event.clientX - start.lastX) / canvas.clientWidth,
      event.pointerType === 'touch' && !rig.focused
        ? 0
        : (event.clientY - start.lastY) / canvas.clientHeight,
    )
    start.lastX = event.clientX
    start.lastY = event.clientY
  })
  canvas.addEventListener(
    'touchmove',
    (event) => {
      if (rig.dragging && event.touches.length === 1 && event.cancelable)
        event.preventDefault()
    },
    { passive: false },
  )
  canvas.addEventListener('pointercancel', cancelDrag)
  canvas.addEventListener('lostpointercapture', (event) => {
    if (pointerDown?.id === event.pointerId) cancelDrag()
  })
  window.addEventListener('blur', cancelDrag)
  window.addEventListener('resize', cancelDrag, { passive: true })
  window.addEventListener('wheel', cancelDrag, { capture: true, passive: true })
  canvas.addEventListener('pointerup', (event) => {
    const start = pointerDown
    if (start && event.pointerId !== start.id) return
    cancelDrag()
    if (
      !start ||
      start.moved ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8 ||
      Math.abs(scrollY - start.scroll) > 8
    )
      return
    const hit = pickAt(event.clientX, event.clientY)
    if (!hit) return
    if (hit.kind === 'power') togglePower()
    if (hit.kind === 'computer') focusScreen(null, 'computer')
    if (hit.kind === 'screen') {
      if (rig.lockName !== 'screen') focusScreen()
      else {
        const uv = mac.uvToScreen(hit.hit.uv)
        if (uv) runHotspot(crt.hitTest(uv.nx, uv.ny) || crt.defaultAction)
      }
    }
    if (hit.kind === 'disk') selectDisk(hit.disk.data.id)
    if (hit.kind === 'drive') {
      if (disks.current) ejectDisk()
      else notify('请从桌面选择一张光盘')
    }
    if (hit.kind === 'keyboard') {
      openNotebook()
    }
  })

  let typed = ''
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (ui.menu.open) ui.toggleMenu(false)
      else if (crt.openMenu) {
        crt.openMenu = null
        crt.dirty = true
      } else {
        cancelDrag()
        rig.resetOrbit()
        exitFocus()
      }
      return
    }
    if (
      event.target.closest(
        'input, textarea, button, a, [contenteditable="true"]',
      ) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return
    if (
      rig.focused &&
      crt.powered &&
      event.key === ' ' &&
      crt.page === 'reel'
    ) {
      event.preventDefault()
      crt.togglePlayback()
      return
    }
    if (rig.focused && event.key === 'Enter' && crt.page === 'hello') {
      crt.setPage('desktop')
      return
    }
    if (rig.focused && event.key === 'Enter' && crt.selectedIcon) {
      runHotspot({ action: 'open-icon' })
      return
    }
    if (event.key.length === 1)
      typed = (typed + event.key.toLowerCase()).slice(-5)
    if (!rig.focused && typed === 'hello') {
      focusScreen('hello')
      notify('hello, you. 很高兴遇见你。')
      typed = ''
    }
  })
  window.addEventListener(
    'scroll',
    () => {
      if (ui.pager.resizing) {
        lastDocumentScrollY = focusScrollY = scrollY
        return
      }
      if (scrollY !== lastDocumentScrollY) {
        // A fresh touch may finish the previous chapter's snap immediately.
        // Keep that touch alive so its horizontal movement can still orbit.
        if (pointerDown && ui.pager.touch && !ui.pager.touch.axis)
          pointerDown.scroll = scrollY
        else cancelDrag()
        rig.resetOrbit()
      }
      if (rig.focused && Math.abs(scrollY - focusScrollY) > 2) exitFocus()
      if (Math.abs(scrollY - lastDocumentScrollY) > 2) focusAfterDisk = false
      lastDocumentScrollY = scrollY
    },
    { passive: true },
  )
  window.addEventListener(
    'wheel',
    (event) => {
      if (
        rig.focused &&
        !event.target.closest('.screen-access, .site-menu, .language-control') &&
        Math.abs(event.deltaY) > 8
      ) {
        event.preventDefault()
        exitFocus()
      }
    },
    { passive: false },
  )
  motionQuery.addEventListener('change', () => {
    rig.reduceMotion = motionQuery.matches
    disks.reduceMotion = motionQuery.matches
    stage.reduceMotion = motionQuery.matches
    crt.reduceMotion = motionQuery.matches
    crt.dirty = true
    rig.setPointer(0, 0)
  })

  ui.setLoading(0.95)
  readTimeline()
  rig.update(1, 0)
  crt.powerOn()
  await stage.renderer.compileAsync(stage.scene, stage.camera)
  await stage.renderer.compileAsync(stage.sideRays.scene, stage.sideRays.camera)
  await stage.renderer.compileAsync(stage.sideRays.compositeScene, stage.sideRays.camera)
  ui.setLoading(1)
  ui.ready()

  function frame(now) {
    animationFrame = 0
    if (document.hidden || contextLost) return
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 1 / 60
    lastFrame = now
    elapsed += dt
    if (!rig.focused) readTimeline()
    if (ui.menu.open && pointerDown) cancelDrag()
    const pointerEnabled =
      pointerQuery.matches && !motionQuery.matches && !rig.dragging
    if (!pointerEnabled || rig.focused || ui.menu.open) resetPointer()
    rig.update(dt, elapsed)
    ui.updateChapterTilt(rig.pointerSmooth, pointerEnabled)
    disks.update(dt)
    crt.update(dt, elapsed)
    ui.updateScreenProjection(stage.camera)
    mac.setUniformTime(motionQuery.matches ? 0 : elapsed)
    mac.update(dt)
    stage.render(elapsed, dt, rig.lockName === 'screen')
    ui.updateSceneHints(stage.camera, rig.focused, pickAt)
    ui.updateFps(now)
    animationFrame = requestAnimationFrame(frame)
  }
  function resume() {
    lastFrame = 0
    ui.updateFps()
    if (!animationFrame && !contextLost)
      animationFrame = requestAnimationFrame(frame)
  }
  document.addEventListener('visibilitychange', () => {
    crt.setVisible(!document.hidden)
    if (document.hidden) {
      ui.updateFps()
      cancelDrag()
      cancelAnimationFrame(animationFrame)
      animationFrame = 0
      audio.ctx?.suspend()
    } else {
      if (soundOn) audio.ctx?.resume()
      resume()
    }
  })
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    cancelDrag()
    contextLost = true
    cancelAnimationFrame(animationFrame)
    crt.setVisible(false)
    audio.disable()
    soundOn = false
    ui.setSound(false)
    ui.showFailure('3D 画面暂时中断。')
  })
  canvas.addEventListener('webglcontextrestored', () => location.reload())
  window.addEventListener('pagehide', () => {
    ui.updateFps()
    cancelDrag()
    cancelAnimationFrame(animationFrame)
    animationFrame = 0
    crt.setVisible(false)
    audio.ctx?.suspend()
  })
  window.addEventListener('pageshow', () => {
    crt.setVisible(true)
    if (soundOn) audio.ctx?.resume()
    resume()
  })
  resume()

  if (import.meta.env.DEV)
    window.__mac = {
      stage,
      rig,
      crt,
      mac,
      disks,
      ui,
      site,
      focusScreen,
      exitFocus,
      selectDisk,
      ejectDisk,
      togglePower,
      pickAt,
    }
}

main().catch((error) => {
  console.error('[macintosh] failed to start', error)
  ui.showFailure('3D 书桌加载失败，请检查浏览器或网络后重试。')
})
