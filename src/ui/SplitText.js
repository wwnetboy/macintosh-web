// Adapted from David Haz / React Bits SplitText: rise reveal and lift springs.
// Source and full license: public/react-bits-splittext-notice.txt.
import { gsap } from 'gsap'
import { SplitText as GSAPSplitText } from 'gsap/SplitText'

gsap.registerPlugin(GSAPSplitText)

export const splitTextOptions = Object.freeze({
  effect: 'rise',
  splitType: 'chars',
  delay: 50,
  duration: 1.25,
  staggerFrom: 'start',
  trigger: 'view',
  hoverEffect: 'lift',
  loop: false,
  loopDelay: 1.5,
  mask: false,
  threshold: 0.1,
  rootMargin: '-100px',
})

const STIFFNESS = 180
const DAMPING = 19
const FROM = { opacity: 0, y: 40 }
const TO = { opacity: 1, y: 0 }

class SplitText {
  constructor(element, { completed, onComplete, motion, finePointer }) {
    this.element = element
    this.motion = motion
    this.finePointer = finePointer
    this.onComplete = onComplete
    this.completed = completed
    this.events = new AbortController()
    this.springs = []
    this.pointer = { x: 0, y: 0, inside: false }
    this.frame = 0
    this.em = parseFloat(getComputedStyle(element).fontSize) || 16

    // The hand-drawn wordmark is a canvas; keep its artwork and accessible text.
    if (element.classList.contains('handwritten')) {
      this.pieces = [element.querySelector('canvas')]
    } else {
      this.split = new GSAPSplitText(element, {
        type: 'chars',
        tag: 'span',
        charsClass: 'split-char',
        // Chinese body copy needs native character wrapping; titles keep phrases.
        smartWrap: !/[\u2e80-\u9fff]/u.test(element.textContent) || !!element.closest('.chapter-title'),
        reduceWhiteSpace: false,
      })
      this.pieces = this.split.chars
    }
    element.dataset.splitText = completed ? 'complete' : 'pending'
    if (!completed) gsap.set(this.pieces, FROM)

    const { signal } = this.events
    element.addEventListener('pointerenter', (event) => this.locate(event, true), { signal })
    element.addEventListener('pointermove', (event) => this.locate(event), { signal })
    element.addEventListener('pointerleave', () => {
      this.pointer.inside = false
      if (this.completed) this.wake()
    }, { signal })
  }

  get totalDuration() {
    return splitTextOptions.duration + Math.max(0, this.pieces.length - 1) * splitTextOptions.delay / 1000
  }

  reveal() {
    if (this.completed || this.intro) return
    this.element.dataset.splitText = 'running'
    this.intro = gsap.fromTo(this.pieces, { ...FROM, willChange: 'transform, opacity' }, {
      ...TO,
      duration: splitTextOptions.duration,
      ease: 'power3.out',
      stagger: { each: splitTextOptions.delay / 1000, from: splitTextOptions.staggerFrom },
      onComplete: () => {
        gsap.set(this.pieces, { clearProps: 'transform,opacity,willChange' })
        this.completed = true
        this.intro = null
        this.element.dataset.splitText = 'complete'
        this.onComplete()
        if (this.pointer.inside) {
          this.measure()
          this.wake()
        }
      },
    })
    return this.intro
  }

  finish() {
    this.intro?.progress(1)
    this.resetHover()
  }

  measure() {
    const box = this.element.getBoundingClientRect()
    this.centers = this.pieces.map((node, index) => {
      const rect = node.getBoundingClientRect()
      return {
        x: rect.left + rect.width / 2 - box.left,
        y: rect.top + rect.height / 2 - box.top - (this.springs[index]?.y || 0),
      }
    })
  }

  locate(event, entering = false) {
    if (event.pointerType === 'touch' || !this.finePointer.matches || this.motion.matches) return
    const box = this.element.getBoundingClientRect()
    this.pointer = { x: event.clientX - box.left, y: event.clientY - box.top, inside: true }
    if (!this.completed) return
    if (entering || !this.centers) this.measure()
    this.wake()
  }

  // Copied lift model: a Gaussian pointer influence with damped letter springs.
  tick(now) {
    this.frame = 0
    const dt = Math.min(0.032, Math.max(0.001, (now - this.last) / 1000))
    this.last = now
    const spots = this.pointer.inside ? this.centers : null
    const radius = this.em * 1.15
    const lift = this.em * 0.2
    let moving = false
    this.pieces.forEach((node, index) => {
      const spring = this.springs[index] || (this.springs[index] = { y: 0, v: 0 })
      const spot = spots?.[index]
      let target = 0
      if (spot) {
        const dx = (spot.x - this.pointer.x) / radius
        const dy = (spot.y - this.pointer.y) / (radius * 1.4)
        target = -lift * Math.exp(-(dx * dx + dy * dy) * 0.5)
      }
      spring.v += (STIFFNESS * (target - spring.y) - DAMPING * spring.v) * dt
      spring.y += spring.v * dt
      if (Math.abs(target - spring.y) < 0.02 && Math.abs(spring.v) < 0.05) {
        spring.y = target
        spring.v = 0
      } else {
        moving = true
      }
      node.style.translate = Math.abs(spring.y) > 0.01 ? `0 ${spring.y.toFixed(2)}px` : ''
    })
    if (moving) this.frame = requestAnimationFrame((time) => this.tick(time))
  }

  wake() {
    if (this.frame || this.motion.matches) return
    this.last = performance.now()
    this.frame = requestAnimationFrame((time) => this.tick(time))
  }

  resetHover() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.centers = null
    this.pointer.inside = false
    this.springs = []
    this.pieces.forEach((node) => { node.style.translate = '' })
  }

  dispose() {
    this.events.abort()
    this.intro?.kill()
    this.resetHover()
    gsap.set(this.pieces, { clearProps: 'transform,opacity,willChange' })
    this.split?.revert()
    delete this.element.dataset.splitText
  }
}

class DividerEntrance {
  constructor(element, { completed, duration, onComplete }) {
    this.element = element
    this.completed = completed
    this.duration = duration
    this.onComplete = onComplete
    element.classList.add('entrance-divider')
    element.dataset.dividerEntrance = completed ? 'complete' : 'pending'
    element.style.setProperty('--divider-progress', completed ? '1' : '0')
  }

  reveal() {
    if (this.completed || this.intro) return
    this.element.dataset.dividerEntrance = 'running'
    this.intro = gsap.to(this.element, {
      '--divider-progress': 1,
      duration: this.duration,
      // Steady growth follows the letter stagger instead of racing to full width.
      ease: 'none',
      onComplete: () => {
        this.completed = true
        this.intro = null
        this.element.dataset.dividerEntrance = 'complete'
        this.onComplete()
      },
    })
    return this.intro
  }

  finish() {
    this.intro?.progress(1)
  }

  dispose() {
    this.finish()
    this.element.classList.remove('entrance-divider')
    this.element.style.removeProperty('--divider-progress')
    delete this.element.dataset.dividerEntrance
  }
}

/** Observe chapters so copy and dividers reveal together, including short pages. */
export class TextEntrances {
  constructor(sections) {
    this.sections = sections
    this.groups = sections.map((section) => ({ section, entries: [], visible: false, timeline: null }))
    this.completedText = new WeakMap()
    this.completedDividers = new WeakSet()
    this.motion = matchMedia('(prefers-reduced-motion: reduce)')
    this.finePointer = matchMedia('(hover: hover) and (pointer: fine)')
    this.events = new AbortController()
    this.generation = 0
    this.page = document.getElementById('page')
    this.page.classList.add('has-text-entrances')
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        this.groups.find((group) => group.section === entry.target).visible =
          entry.isIntersecting && entry.intersectionRatio >= splitTextOptions.threshold
      }
      this.update()
    }, { threshold: splitTextOptions.threshold, rootMargin: splitTextOptions.rootMargin })
    sections.forEach((section) => this.observer.observe(section))
    const { signal } = this.events
    this.motion.addEventListener('change', () => this.refresh(), { signal })
    window.addEventListener('resize', () => {
      this.groups.forEach(({ entries }) => entries.forEach((entry) => entry.resetHover?.()))
    }, { signal })
    this.refresh()
  }

  beforeTextChange() {
    this.generation++
    this.groups.forEach((group) => {
      group.entries.forEach((entry) => entry.dispose())
      group.timeline?.kill()
      group.timeline = null
      group.entries = []
    })
  }

  refresh() {
    this.beforeTextChange()
    const generation = this.generation
    const prepare = () => {
      if (generation !== this.generation) return
      for (const group of this.groups) {
        const targets = group.section.querySelectorAll('.chapter-content [data-i18n], .chapter-title.handwritten, .scroll-cue [data-i18n]')
        for (const element of targets) {
          if (!element.textContent.trim() || element.closest('a, button, [role="button"], footer')) continue
          const text = element.textContent
          if (this.motion.matches) {
            this.completedText.set(element, text)
            continue
          }
          group.entries.push(new SplitText(element, {
            completed: this.completedText.get(element) === text,
            motion: this.motion,
            finePointer: this.finePointer,
            onComplete: () => {
              this.completedText.set(element, text)
              element.dispatchEvent(new CustomEvent('split-text:complete', { bubbles: true }))
            },
          }))
        }
        const dividers = group.section.querySelectorAll('.chapter-right .chapter-body, .blk-spec, .practice-list > div, .chapter-links, .works-rail')
        dividers.forEach((element) => {
          if (this.motion.matches) {
            this.completedDividers.add(element)
            return
          }
          // Row separators follow their own copy; other lines follow their block.
          const scope = element.closest('.practice-list > div, .chapter-body, .chapter-content') || group.section
          const durations = group.entries
            .filter((entry) => entry instanceof SplitText && scope.contains(entry.element))
            .map((entry) => entry.totalDuration)
          group.entries.push(new DividerEntrance(element, {
            completed: this.completedDividers.has(element),
            duration: Math.max(splitTextOptions.duration, ...durations),
            onComplete: () => this.completedDividers.add(element),
          }))
        })
      }
      this.update()
    }
    if (!document.fonts || document.fonts.status === 'loaded') prepare()
    else document.fonts.ready.then(prepare)
  }

  update() {
    if (!document.body.classList.contains('booted')) return
    for (const group of this.groups) {
      const { section, entries, visible } = group
      const active = section.classList.contains('is-current') || document.body.classList.contains('scene-failed')
      if (active && visible && !group.timeline && entries.length) {
        group.timeline = gsap.timeline({ paused: true })
        entries.forEach((entry) => {
          const tween = entry.reveal()
          if (tween) group.timeline.add(tween, 0)
        })
        group.timeline.play()
      } else if (!active) {
        group.timeline?.progress(1)
        entries.forEach((entry) => entry.finish())
      }
    }
  }

  dispose() {
    this.events.abort()
    this.observer.disconnect()
    this.beforeTextChange()
    this.page.classList.remove('has-text-entrances')
  }
}
