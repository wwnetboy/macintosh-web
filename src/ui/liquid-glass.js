import './liquid-glass.css'
import polarDisplacementMap from './assets/liquid-glass-polar.jpg?url'
import standardDisplacementMap from './assets/liquid-glass-standard.jpg?url'
// Native DOM adaptation of rdev/liquid-glass-react (MIT, MAX ROVENSKY).
// Keep the backdrop separate so refraction never distorts labels or icons.
const SVG_NS = 'http://www.w3.org/2000/svg'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const REFRACTION_MAPS = {
  polar: polarDisplacementMap,
  standard: standardDisplacementMap,
}
const CARD_SELECTOR = '.site-menu, .failure-notice'
export const PRESS_COMPRESSION_RATIO = 0.035
let glassInstance = 0
export const BUTTON_GLASS_OPTIONS = {
  elasticity: 0.3,
  mode: 'polar',
  aberrationIntensity: 6,
  displacementScale: 80,
  blurAmount: 0.125,
  saturation: 145,
}
// Optics from the upstream User Info Card defaults, with compact menu padding.
export const CARD_GLASS_OPTIONS = {
  elasticity: 0,
  mode: 'standard',
  aberrationIntensity: 2,
  displacementScale: 100,
  blurAmount: 0.5,
  saturation: 140,
  cornerRadius: 32,
  padding: '12px',
}
const ENVIRONMENT_CARD_GLASS_OPTIONS = {
  ...CARD_GLASS_OPTIONS,
  elasticity: BUTTON_GLASS_OPTIONS.elasticity,
}
function glassOptions(element) {
  if (element.matches('.site-menu')) return ENVIRONMENT_CARD_GLASS_OPTIONS
  return element.matches(CARD_SELECTOR)
    ? CARD_GLASS_OPTIONS
    : BUTTON_GLASS_OPTIONS
}
export function elasticPointerOffset(offset, size, referenceSize) {
  const distance = Math.abs(offset)
  const halfSize = size / 2
  // Map the interior to a circle-sized response, preserving distance outside the edge.
  return (
    Math.sign(offset) *
    ((Math.min(distance, halfSize) * referenceSize) / size +
      Math.max(0, distance - halfSize))
  )
}
function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value))
  return element
}
function createFilter(id, width, height, options) {
  const filter = svgElement('filter', {
    id,
    x: -16,
    y: -16,
    width: width + 32,
    height: height + 32,
    filterUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  })
  filter.append(
    svgElement('feImage', {
      href: REFRACTION_MAPS[options.mode],
      x: 0,
      y: 0,
      width,
      height,
      preserveAspectRatio: 'xMidYMid slice',
      result: 'lens-map',
    }),
  )
  // Recombine independently refracted RGB channels, as in the reference library.
  const { displacementScale, aberrationIntensity } = options
  for (const [channel, scale, matrix] of [
    ['red', -displacementScale, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
    [
      'green',
      -displacementScale * (1 + aberrationIntensity * 0.05),
      '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
    ],
    [
      'blue',
      -displacementScale * (1 + aberrationIntensity * 0.1),
      '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
    ],
  ]) {
    filter.append(
      svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'lens-map',
        scale,
        xChannelSelector: 'R',
        yChannelSelector: 'B',
        result: `${channel}-displaced`,
      }),
    )
    filter.append(
      svgElement('feColorMatrix', {
        in: `${channel}-displaced`,
        type: 'matrix',
        values: matrix,
        result: channel,
      }),
    )
  }
  filter.append(
    svgElement('feBlend', {
      in: 'red',
      in2: 'green',
      mode: 'screen',
      result: 'rg',
    }),
  )
  filter.append(
    svgElement('feBlend', { in: 'rg', in2: 'blue', mode: 'screen' }),
  )
  return filter
}
export function initLiquidGlass(root) {
  const selector = `.sound-btn, .language-toggle, .menu-toggle, .primary-btn, .text-link, .work-action, .menu-close, .menu-footer .menu-link, .loader-skip, .chapter-links a, ${CARD_SELECTOR}`
  const elements = [
    ...(root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ]
  const instance = glassInstance++
  const events = new AbortController()
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
  const svg = svgElement('svg', { 'aria-hidden': 'true', width: 0, height: 0 })
  svg.classList.add('liquid-glass-defs')
  const defs = svgElement('defs', {})
  svg.append(defs)
  document.body.append(svg)
  const supportsRefraction = /(?:Chrome|Chromium|Edg)\//.test(
    navigator.userAgent,
  )
  const filters = new Map()
  const sizes = new WeakMap()
  const anchoredCards = new Set()
  const environmentCards = elements.filter((element) =>
    element.matches('.site-menu'),
  )
  const referenceControl = root.querySelector('.menu-toggle')
  let pointer = null
  let frame = 0
  const motionReferenceSize = (element, width, height) => {
    if (!element.matches('.site-menu')) return Math.min(width, height)
    const controlSize =
      referenceControl &&
      Math.min(referenceControl.offsetWidth, referenceControl.offsetHeight)
    const configuredSize =
      Number.parseFloat(
        getComputedStyle(root).getPropertyValue('--control-size'),
      ) || 46
    return Math.min(width, height, controlSize || configuredSize)
  }
  const updateMotionSize = (
    element,
    width = element.offsetWidth,
    height = element.offsetHeight,
  ) => {
    if (!width || !height) return
    const referenceSize = motionReferenceSize(element, width, height)
    const compressionPixels = PRESS_COMPRESSION_RATIO * referenceSize
    const scaleX = String(1 - compressionPixels / width)
    const scaleY = String(1 - compressionPixels / height)
    // Share physical edge movement with the circular control, not its scale ratio.
    element.style.setProperty('--glass-press-scale-x', scaleX)
    element.style.setProperty('--glass-press-scale-y', scaleY)
  }
  const resize = new ResizeObserver((entries) => {
    entries.forEach(({ target }) => {
      const element = target
      const width = element.offsetWidth
      const height = element.offsetHeight
      // Hidden focus/seat controls receive their filter when they become visible.
      if (!width || !height || sizes.get(element) === `${width}:${height}`)
        return
      sizes.set(element, `${width}:${height}`)
      updateMotionSize(element, width, height)
      if (!supportsRefraction) return
      const id = `touch-glass-${instance}-${elements.indexOf(element)}`
      const existing = filters.get(element)
      if (existing) {
        // The persistent Touch Bar changes width during its spring. Resize the
        // existing lens instead of rebuilding its SVG graph on every frame.
        existing.setAttribute('width', String(width + 32))
        existing.setAttribute('height', String(height + 32))
        const map = existing.querySelector('feImage')
        map.setAttribute('width', String(width))
        map.setAttribute('height', String(height))
      } else {
        const filter = createFilter(id, width, height, glassOptions(element))
        defs.append(filter)
        filters.set(element, filter)
        element.style.setProperty('--liquid-filter', `url(#${id})`)
      }
    })
    // The anchor can resize at a breakpoint even when the card dimensions do not.
    environmentCards.forEach((element) => updateMotionSize(element))
  })
  const reset = (element) => {
    ;[
      '--glass-x',
      '--glass-y',
      '--glass-scale-x',
      '--glass-scale-y',
      '--glass-light-x',
      '--glass-light-y',
      '--glass-angle',
    ].forEach((property) => element.style.removeProperty(property))
    element.classList.remove('is-glass-pressed')
  }
  const paintPointer = () => {
    frame = 0
    if (!pointer || reducedMotion.matches || !finePointer.matches) {
      elements.forEach(reset)
      return
    }
    elements.forEach((element) => {
      if (element.closest('[inert]')) {
        reset(element)
        return
      }
      if (anchoredCards.has(element)) return
      if (!element.getClientRects().length) return
      const rect = element.getBoundingClientRect()
      const width = element.offsetWidth
      const height = element.offsetHeight
      if (!width || !height) return
      const referenceSize = motionReferenceSize(element, width, height)
      const dx = pointer.x - rect.left - rect.width / 2
      const dy = pointer.y - rect.top - rect.height / 2
      const distance = Math.hypot(
        Math.max(0, Math.abs(dx) - width / 2),
        Math.max(0, Math.abs(dy) - height / 2),
      )
      const proximity = Math.max(0, 1 - distance / 160)
      if (!proximity) {
        reset(element)
        return
      }
      const elasticX = elasticPointerOffset(dx, width, referenceSize)
      const elasticY = elasticPointerOffset(dy, height, referenceSize)
      const length = Math.hypot(elasticX, elasticY) || 1
      const { elasticity } = glassOptions(element)
      const stretch = Math.min(length / 300, 1) * elasticity * proximity
      element.style.setProperty(
        '--glass-x',
        `${clamp(elasticX * elasticity * 0.1 * proximity, -4, 4)}px`,
      )
      element.style.setProperty(
        '--glass-y',
        `${clamp(elasticY * elasticity * 0.1 * proximity, -3, 3)}px`,
      )
      element.style.setProperty(
        '--glass-scale-x',
        String(
          1 +
            ((Math.abs(elasticX / length) * stretch * 0.3 -
              Math.abs(elasticY / length) * stretch * 0.15) *
              referenceSize) /
              width,
        ),
      )
      element.style.setProperty(
        '--glass-scale-y',
        String(
          1 +
            ((Math.abs(elasticY / length) * stretch * 0.3 -
              Math.abs(elasticX / length) * stretch * 0.15) *
              referenceSize) /
              height,
        ),
      )
      element.style.setProperty(
        '--glass-light-x',
        `${clamp(((pointer.x - rect.left) / rect.width) * 100, 0, 100)}%`,
      )
      element.style.setProperty(
        '--glass-light-y',
        `${clamp(((pointer.y - rect.top) / rect.height) * 100, 0, 100)}%`,
      )
      element.style.setProperty(
        '--glass-angle',
        `${135 + clamp(dx / rect.width, -1, 1) * 70}deg`,
      )
    })
  }
  const schedulePointer = () => {
    if (!frame) frame = requestAnimationFrame(paintPointer)
  }
  elements.forEach((element) => {
    const isCard = element.matches(CARD_SELECTOR)
    element.classList.add('liquid-glass')
    if (isCard) {
      element.classList.add('liquid-glass--card')
      // Scroll the controls independently of the stationary glass backdrop.
      const content = document.createElement('div')
      content.className = 'liquid-glass__content'
      content.append(...element.childNodes)
      element.append(content)
    }
    const options = glassOptions(element)
    element.dataset.refractionMode = options.mode
    element.style.setProperty(
      '--glass-blur',
      `${4 + options.blurAmount * 32}px`,
    )
    element.style.setProperty('--glass-saturation', `${options.saturation}%`)
    if (options.cornerRadius !== undefined)
      element.style.setProperty(
        '--glass-corner-radius',
        `${options.cornerRadius}px`,
      )
    if (options.padding !== undefined)
      element.style.setProperty('--glass-padding', options.padding)
    const surface = document.createElement('span')
    surface.className = 'liquid-glass__surface'
    surface.setAttribute('aria-hidden', 'true')
    surface.append(document.createElement('span'))
    element.prepend(surface)
    resize.observe(element)
    if (!isCard || element.matches('.site-menu')) {
      element.addEventListener(
        'pointerdown',
        (event) => {
          const target = event.target
          if (
            event.button !== 0 ||
            reducedMotion.matches ||
            target.closest(':disabled')
          )
            return
          // Keep range dragging and native touch scrolling on a stationary surface.
          if (
            isCard &&
            target.closest('input, select, textarea, [contenteditable]')
          ) {
            anchoredCards.add(element)
            return
          }
          if (isCard && (element.inert || !target.closest('button'))) return
          element.classList.add('is-glass-pressed')
        },
        { signal: events.signal },
      )
      element.addEventListener(
        'pointerleave',
        () => element.classList.remove('is-glass-pressed'),
        { signal: events.signal },
      )
      if (isCard)
        element.addEventListener(
          'scroll',
          () => element.classList.remove('is-glass-pressed'),
          { capture: true, passive: true, signal: events.signal },
        )
    }
  })
  const release = () => {
    elements.forEach((element) => element.classList.remove('is-glass-pressed'))
    anchoredCards.clear()
    schedulePointer()
  }
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return
      pointer = { x: event.clientX, y: event.clientY }
      schedulePointer()
    },
    { passive: true, signal: events.signal },
  )
  window.addEventListener('pointerup', release, { signal: events.signal })
  window.addEventListener('pointercancel', release, { signal: events.signal })
  const clearPointer = () => {
    pointer = null
    release()
    schedulePointer()
  }
  document.documentElement.addEventListener('pointerleave', clearPointer, {
    signal: events.signal,
  })
  window.addEventListener('blur', clearPointer, { signal: events.signal })
  reducedMotion.addEventListener('change', schedulePointer, {
    signal: events.signal,
  })
  finePointer.addEventListener('change', schedulePointer, {
    signal: events.signal,
  })
  return () => {
    events.abort()
    resize.disconnect()
    cancelAnimationFrame(frame)
    svg.remove()
    elements.forEach((element) => {
      reset(element)
      element.classList.remove('liquid-glass', 'liquid-glass--card')
      delete element.dataset.refractionMode
      element.style.removeProperty('--liquid-filter')
      ;[
        '--glass-blur',
        '--glass-saturation',
        '--glass-corner-radius',
        '--glass-padding',
        '--glass-press-scale-x',
        '--glass-press-scale-y',
        '--glass-open-scale-x',
        '--glass-open-scale-y',
        '--glass-open-offset',
      ].forEach((property) => element.style.removeProperty(property))
      element.querySelector('.liquid-glass__surface')?.remove()
      const content = element.querySelector('.liquid-glass__content')
      if (content) content.replaceWith(...content.childNodes)
    })
  }
}
