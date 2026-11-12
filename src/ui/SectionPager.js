const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const WHEEL_THRESHOLD = 220
const RELEASE_DELAY = 280
const INERTIA_GAP = 220
const TOUCH_THRESHOLD = 80
const IGNORE_INPUT =
  'input, textarea, [contenteditable="true"], .site-menu, .screen-access'
const IGNORE_TOUCH = `${IGNORE_INPUT}, .hud, .focus-back, .page-indicator`

/** One gesture previews or commits one chapter, using the document scroll position. */
export class SectionPager {
  constructor(sections, onChange) {
    this.sections = sections
    this.onChange = onChange
    this.index = 0
    this.position = scrollY
    this.target = scrollY
    this.velocity = 0
    this.phase = 'idle'
    this.input = 0
    this.lastWheelAt = 0
    this.wheelLocked = false
    this.frame = 0
    this.contentFrame = 0
    this.lastFrame = 0
    this.resizeUntil = 0
    this.controller = new AbortController()
    this.motion = matchMedia('(prefers-reduced-motion: reduce)')
    this.previousRestoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    document.documentElement.classList.add('paged')
    this.measure()
    this.go(this.hashIndex(location.hash) ?? 0, { instant: true })

    const { signal } = this.controller
    window.addEventListener('wheel', (event) => this.wheel(event), {
      passive: false,
      signal,
    })
    window.addEventListener('touchstart', (event) => this.touchStart(event), {
      passive: true,
      signal,
    })
    window.addEventListener('touchmove', (event) => this.touchMove(event), {
      passive: false,
      signal,
    })
    window.addEventListener('touchend', () => this.touchEnd(), {
      passive: true,
      signal,
    })
    window.addEventListener(
      'touchcancel',
      () => {
        if (this.touch) this.settle()
      },
      { signal },
    )
    window.addEventListener('keydown', (event) => this.key(event), { signal })
    window.addEventListener('scroll', () => this.readScroll(), {
      passive: true,
      signal,
    })
    window.addEventListener(
      'hashchange',
      () => {
        const index = this.hashIndex(location.hash)
        if (index !== null) this.go(index)
      },
      { signal },
    )
    document.addEventListener(
      'click',
      (event) => {
        const link = event.target.closest('a[href^="#"]')
        if (
          !link ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return
        const index = this.hashIndex(link.getAttribute('href'))
        if (index === null) return
        event.preventDefault()
        this.go(index, { pushHistory: true })
      },
      { signal },
    )
    window.addEventListener('blur', () => this.settle(), { signal })
    this.motion.addEventListener(
      'change',
      () => {
        this.stop()
        if (!this.blocked) this.go(this.index, { instant: true })
      },
      { signal },
    )
    this.observer = new ResizeObserver(() => {
      const resized =
        this.viewportWidth !== innerWidth || this.viewportHeight !== innerHeight
      this.measure()
      // Do not replace an in-flight gesture when fonts or translated copy reflow.
      if (resized) this.go(this.index, { instant: true })
    })
    this.observer.observe(document.getElementById('page'))
    window.addEventListener(
      'resize',
      () => {
        this.measure()
        this.go(this.index, { instant: true })
      },
      { passive: true, signal },
    )
  }

  measure() {
    if (
      this.viewportHeight !== undefined &&
      (this.viewportWidth !== innerWidth || this.viewportHeight !== innerHeight)
    ) {
      this.resizeUntil = performance.now() + 200
    }
    this.anchors = this.sections.map((section) => section.offsetTop)
    this.limit = this.anchors.at(-1) || 0
    this.viewportWidth = innerWidth
    this.viewportHeight = innerHeight
  }

  hashIndex(hash) {
    let id
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      return null
    }
    if (id === 'about') id = 'home'
    const index = this.sections.findIndex((section) => section.id === id)
    return index < 0 ? null : index
  }

  get blocked() {
    return (
      !document.body.classList.contains('booted') ||
      document.body.matches(
        '.is-focus, .menu-open, .language-open, .scene-failed, .is-orbiting',
      )
    )
  }

  get resizing() {
    return performance.now() < this.resizeUntil
  }

  nearest(position) {
    let nearest = 0
    for (let i = 1; i < this.anchors.length; i++) {
      if (
        Math.abs(this.anchors[i] - position) <
        Math.abs(this.anchors[nearest] - position)
      )
        nearest = i
    }
    return nearest
  }

  scrollContent(delta) {
    const section = this.sections[this.index]
    const remaining =
      section.scrollHeight - section.clientHeight - section.scrollTop
    if ((delta > 0 && remaining > 2) || (delta < 0 && section.scrollTop > 2)) {
      section.scrollTop += delta
      return true
    }
    return false
  }

  wheel(event) {
    if (
      this.blocked ||
      event.ctrlKey ||
      event.metaKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return
    if (event.target.closest(IGNORE_INPUT)) return
    event.preventDefault()
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1
    const delta = clamp(event.deltaY * unit, -120, 120)
    if (!delta) return
    cancelAnimationFrame(this.contentFrame)
    this.contentFrame = 0
    const now = performance.now()
    const idle = now - this.lastWheelAt
    this.lastWheelAt = now
    if (this.wheelLocked) {
      if (this.phase === 'snap' || idle < INERTIA_GAP) return
      this.wheelLocked = false
    }
    if (this.phase === 'idle' && this.scrollContent(delta)) return
    if (idle > RELEASE_DELAY) this.input = 0
    this.input += delta
    clearTimeout(this.returnTimer)
    if (Math.abs(this.input) >= WHEEL_THRESHOLD) {
      this.go(this.index + Math.sign(this.input))
      return
    }
    this.preview(this.input / WHEEL_THRESHOLD)
    this.returnTimer = setTimeout(() => this.settle(), RELEASE_DELAY)
  }

  preview(amount) {
    const next = clamp(
      this.index + Math.sign(amount),
      0,
      this.sections.length - 1,
    )
    const offset =
      next === this.index
        ? 0
        : Math.sign(amount) *
          innerHeight *
          0.18 *
          (1 - Math.exp(-Math.abs(amount) * 1.3))
    this.target = this.anchors[this.index] + offset
    this.phase = 'preview'
    if (!this.motion.matches) this.animate()
  }

  go(index, { instant = false, pushHistory = false } = {}) {
    clearTimeout(this.returnTimer)
    cancelAnimationFrame(this.contentFrame)
    this.contentFrame = 0
    this.input = 0
    this.touch = null
    this.index = clamp(index, 0, this.sections.length - 1)
    this.target = this.anchors[this.index]
    this.wheelLocked = true
    this.lastWheelAt = performance.now()
    const hash = `#${encodeURIComponent(this.sections[this.index].id)}`
    if (pushHistory && location.hash !== hash) {
      history.pushState(null, '', hash)
    }
    this.phase = 'snap'
    if (instant || this.motion.matches) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.velocity = 0
      this.write(this.target)
      this.finish()
    } else {
      this.animate()
    }
  }

  settle() {
    this.touch = null
    if (this.blocked) {
      this.stop()
      return
    }
    this.go(this.index)
  }

  animate() {
    if (this.frame) return
    this.lastFrame = 0
    this.frame = requestAnimationFrame((now) => this.tick(now))
  }

  tick(now) {
    this.frame = 0
    const dt = this.lastFrame
      ? Math.min((now - this.lastFrame) / 1000, 0.033)
      : 1 / 60
    this.lastFrame = now
    // Solve a critically damped spring exactly, including on slower phones.
    const omega = this.phase === 'preview' ? 28 : 22
    const offset = this.position - this.target
    const spring = this.velocity + omega * offset
    const decay = Math.exp(-omega * dt)
    this.velocity = (this.velocity - omega * spring * dt) * decay
    this.write(this.target + (offset + spring * dt) * decay)
    if (
      Math.abs(this.position - this.target) < 0.5 &&
      Math.abs(this.velocity) < 5
    ) {
      this.velocity = 0
      this.write(this.target)
      if (this.phase === 'snap') this.finish()
      return
    }
    this.frame = requestAnimationFrame((time) => this.tick(time))
  }

  write(position) {
    this.position = clamp(position, 0, this.limit)
    window.scrollTo({ top: this.position, behavior: 'instant' })
    this.onChange(this.nearest(this.position))
  }

  finish() {
    this.phase = 'idle'
    const hash = `#${encodeURIComponent(this.sections[this.index].id)}`
    if (location.hash !== hash) history.replaceState(null, '', hash)
  }

  readScroll() {
    // A shorter viewport can clamp native scroll before ResizeObserver runs.
    // Re-pin the committed chapter before interpreting that as navigation.
    if (
      this.viewportWidth !== innerWidth ||
      this.viewportHeight !== innerHeight
    ) {
      this.measure()
      this.go(this.index, { instant: true })
      return
    }
    if (Math.abs(scrollY - this.position) < 2) return
    this.stop()
    this.onChange(this.index)
    if (!this.blocked) this.returnTimer = setTimeout(() => this.settle(), 180)
  }

  touchStart(event) {
    if (event.touches.length !== 1) {
      if (this.touch) this.settle()
      return
    }
    if (this.blocked || event.target.closest(IGNORE_TOUCH)) return
    // A new swipe can start as soon as the preceding chapter was committed.
    if (this.phase === 'snap') this.go(this.index, { instant: true })
    const point = event.touches[0]
    this.stop()
    this.touch = {
      x: point.clientX,
      y: point.clientY,
      lastY: point.clientY,
      amount: 0,
      axis: null,
      content: false,
      velocity: 0,
      lastMoveAt: performance.now(),
    }
  }

  touchMove(event) {
    if (!this.touch || this.blocked) return
    if (event.touches.length !== 1) {
      this.settle()
      return
    }
    const point = event.touches[0]
    const dx = this.touch.x - point.clientX
    const dy = this.touch.y - point.clientY
    if (!this.touch.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      this.touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (this.touch.axis !== 'y') return
    if (event.cancelable) event.preventDefault()
    const delta = this.touch.lastY - point.clientY
    const now = performance.now()
    this.touch.velocity = delta / Math.max(8, now - this.touch.lastMoveAt)
    this.touch.lastMoveAt = now
    this.touch.lastY = point.clientY
    if (this.touch.content || this.scrollContent(delta)) {
      // Finish reading this chapter before a separate swipe changes chapters.
      if (this.touch.content) this.scrollContent(delta)
      this.touch.content = true
      return
    }
    this.touch.amount = dy
    this.preview(dy / this.touchThreshold)
  }

  get touchThreshold() {
    return Math.max(48, Math.min(TOUCH_THRESHOLD, innerHeight * 0.12))
  }

  touchEnd() {
    if (!this.touch) return
    const { amount, axis, content, velocity, lastMoveAt } = this.touch
    this.touch = null
    if (content) {
      if (performance.now() - lastMoveAt < 100) this.flingContent(velocity)
      return
    }
    const flick =
      Math.abs(amount) >= 32 &&
      Math.abs(velocity) >= 0.25 &&
      Math.sign(velocity) === Math.sign(amount) &&
      performance.now() - lastMoveAt < 100
    if (
      axis === 'y' &&
      (Math.abs(amount) >= this.touchThreshold || flick)
    ) {
      this.go(this.index + Math.sign(amount))
    } else if (this.phase === 'preview') this.settle()
  }

  flingContent(velocity) {
    if (this.motion.matches || Math.abs(velocity) < 0.1) return
    const section = this.sections[this.index]
    let speed = clamp(velocity, -2.5, 2.5)
    let previous = performance.now()
    const tick = (now) => {
      this.contentFrame = 0
      if (this.blocked) return
      const dt = Math.min(now - previous, 32)
      previous = now
      const before = section.scrollTop
      section.scrollTop += speed * dt
      speed *= Math.exp(-dt / 160)
      // Momentum stops at the content boundary; it never advances a chapter.
      if (Math.abs(speed) > 0.03 && Math.abs(section.scrollTop - before) > 0.1)
        this.contentFrame = requestAnimationFrame(tick)
    }
    this.contentFrame = requestAnimationFrame(tick)
  }

  key(event) {
    if (this.blocked || event.ctrlKey || event.metaKey || event.altKey) return
    const indicator = event.target.closest('.page-indicator')
    if (
      !indicator &&
      event.target.closest(
        'input, textarea, button, a, [contenteditable="true"]',
      )
    )
      return
    const direction = {
      ArrowDown: 1,
      PageDown: 1,
      ' ': event.shiftKey ? -1 : 1,
      ArrowUp: -1,
      PageUp: -1,
    }[event.key]
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (
      direction &&
      !indicator &&
      this.scrollContent(direction * innerHeight * 0.75)
    )
      return
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? this.sections.length - 1
          : this.index + direction
    this.go(index)
    if (indicator)
      indicator
        .querySelectorAll('a')
        [this.index]?.focus({ preventScroll: true })
  }

  stop() {
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.contentFrame)
    clearTimeout(this.returnTimer)
    this.frame = 0
    this.contentFrame = 0
    this.phase = 'idle'
    this.velocity = 0
    this.input = 0
    this.position = this.target = scrollY
    this.index = this.nearest(scrollY)
  }

  dispose() {
    this.stop()
    this.controller.abort()
    this.observer.disconnect()
    history.scrollRestoration = this.previousRestoration
    document.documentElement.classList.remove('paged')
    for (const section of this.sections) {
      section.inert = false
      section.removeAttribute('aria-hidden')
    }
  }
}
