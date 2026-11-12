import { site, getSiteLinks } from '../content/site.js'
import { initLiquidGlass } from './liquid-glass.js'
import { SectionPager } from './SectionPager.js'
import { helloLettering, drawHandwriting } from './handwriting.js'
import { linkIconSvg } from './linkIcons.js'
import { getLanguage, languages, setLanguage, t, translateDOM } from '../content/i18n.js'
import { TextEntrances } from './SplitText.js'

const escape = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  )

const translated = (value) =>
  `<span data-i18n="${escape(value)}">${escape(t(value))}</span>`

export class AppUI {
  constructor() {
    this.sections = []
    this.screenControls = []
    this.progressIndex = null
    this.events = new AbortController()
    this._build()
    this.applyLanguage()
    this.chapterSurfaces = this.sections.map((section) =>
      section.querySelector('.chapter-content'),
    )
    this.tiltedSurface = null
    this.pager = new SectionPager(this.sections, (index) =>
      this.setProgress(index - 1),
    )
    this.textEntrances = new TextEntrances(this.sections)
    this.disposeGlass = initLiquidGlass(document.body)
  }

  _build() {
    document.title = site.meta.title
    document.documentElement.lang = site.meta.lang
    document.querySelector('meta[name="description"]').content =
      site.meta.description
    document.querySelector('meta[name="author"]').content =
      site.meta.author || site.identity.name
    document.querySelector('meta[property="og:title"]').content =
      site.meta.title
    document.querySelector('meta[property="og:description"]').content =
      site.meta.description
    const page = document.getElementById('page')
    const hero = document.createElement('section')
    hero.className = 'hero chapter-portrait'
    hero.id = 'home'
    hero.dataset.camera = 'boot'
    hero.innerHTML = `
      <span id="about" class="home-anchor" aria-hidden="true"></span>
      <div class="hero-inner chapter-inner">
        <div class="chapter-content">
          <header class="chapter-heading">
            <h1 class="chapter-title">${translated(site.hero.title)}</h1>
            <p class="chapter-lead">${translated(site.hero.line)}</p>
          </header>
          <div class="chapter-body">
            ${this._block({ type: 'p', text: site.hero.description })}
            ${this._block({ type: 'kv', items: site.hero.details || [] })}
          </div>
        </div>
      </div>
      <div class="scroll-cue">${translated(site.hero.hint)}<span class="cue-chevrons" aria-hidden="true"></span></div>`
    page.append(hero)
    this.sections.push(hero)

    for (const section of site.sections) {
      const element = document.createElement('section')
      element.className = `chapter chapter-${section.layout}`
      element.dataset.camera = section.camera
      element.id = section.id
      element.innerHTML = `
        <div class="chapter-inner">
          <div class="chapter-content">
            <header class="chapter-heading">
              <h2 class="chapter-title">${translated(section.title)}</h2>
              ${section.lead ? `<p class="chapter-lead">${translated(section.lead)}</p>` : ''}
            </header>
            <div class="chapter-body">${(section.blocks || []).map((block) => this._block(block)).join('')}</div>
            ${section.links ? this._links() : ''}
          </div>
        </div>`
      page.append(element)
      this.sections.push(element)
    }

    const footer = document.createElement('footer')
    footer.className = 'site-footer'
    footer.innerHTML = `
      <div class="footer-inner">
        <p class="footer-copyright">© ${new Date().getFullYear()} ${escape(site.identity.name)}</p>
        <p>${translated('代码采用 MIT 许可 · 第三方素材版权归原作者')}</p>
      </div>`
    this.sections.at(-1).append(footer)

    const header = document.createElement('header')
    header.className = 'hud'
    header.innerHTML = `
      <a class="brand" href="#home" data-i18n-label="hello. 首页" aria-label="hello. 首页">
        <svg class="brand-face" viewBox="0 0 19 17" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
          <path d="M0 0h2v4H0z M9 0h2v10H7V8h2z M17 0h2v4h-2z M2 12h2v1H2z M15 12h2v1h-2z M2 13h3v1H2z M14 13h3v1h-3z M3 14h4v1H3z M12 14h4v1h-4z M5 15h9v1H5z M7 16h5v1H7z"/>
        </svg>
        <svg class="brand-wordmark" viewBox="-6 -6 188 86" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path class="brand-lettering" d="${helloLettering.svgPath}"/>
          <circle class="brand-period" cx="173" cy="67" r="2.6"/>
        </svg>
      </a>
      <div class="header-controls">
        <button type="button" class="sound-btn" aria-label="打开声音" aria-pressed="false" data-requires-3d disabled>
          <svg class="sound-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M11 5 6 9H3v6h3l5 4Z"/>
            <g class="sound-waves"><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></g>
            <g class="sound-muted"><path d="m16 9 5 6m0-6-5 6"/></g>
          </svg>
        </button>
        <div class="language-control">
          <button type="button" class="language-toggle" data-i18n-label="切换语言" aria-label="切换语言" aria-haspopup="menu" aria-expanded="false" aria-controls="language-menu">${linkIconSvg('website')}</button>
          <div class="language-menu" id="language-menu" role="menu" data-i18n-label="切换语言" aria-label="切换语言" hidden>
            ${languages.map(({ code, label }) => `<button type="button" role="menuitemradio" aria-checked="false" tabindex="-1" data-language="${code}" lang="${code}"><span>${label}</span><span class="language-check" aria-hidden="true">✓</span></button>`).join('')}
          </div>
        </div>
        <button class="menu-toggle" aria-label="打开导航" aria-expanded="false" aria-controls="site-menu"><span></span><span></span></button>
      </div>`
    document.body.append(header)
    this.soundBtn = header.querySelector('.sound-btn')
    this.menuButton = header.querySelector('.menu-toggle')
    this.languageButton = header.querySelector('.language-toggle')
    this.languageMenu = header.querySelector('.language-menu')
    this.languageOptions = [...this.languageMenu.querySelectorAll('[data-language]')]
    this._bindLanguageMenu(header.querySelector('.language-control'))

    const menu = document.createElement('dialog')
    menu.className = 'site-menu'
    menu.id = 'site-menu'
    menu.setAttribute('aria-labelledby', 'menu-title')
    const navigation = [
      { id: 'home', label: '关于 {name}' },
      ...site.sections.map((section) => ({
        id: section.id,
        label:
          section.navLabel ||
          {
            machine: '这台电脑',
            screen: '进入桌面',
            work: '作品',
            end: '保持好奇',
          }[section.id],
      })),
    ]
    menu.innerHTML = `
      <div class="menu-heading"><span id="menu-title" data-i18n="目录">目录</span><button class="menu-close" data-i18n-label="收起导航" aria-label="收起导航">×</button></div>
      <nav data-i18n-label="页面导航" aria-label="页面导航">${navigation.map((item) => `<a class="menu-link" href="#${item.id}" data-section="${item.id}">${translated(item.label)}</a>`).join('')}</nav>
      ${
        site.identity.website || site.repositoryUrl
          ? `<div class="menu-footer">
        ${site.identity.website ? `<a class="menu-link menu-website" href="${escape(site.identity.website)}" target="_blank" rel="noopener noreferrer" data-i18n-label="打开个人网站（新窗口）" aria-label="打开个人网站（新窗口）">${translated('个人网站')}</a>` : ''}
        ${site.repositoryUrl ? `<a class="menu-link menu-github" href="${escape(site.repositoryUrl)}" target="_blank" rel="noopener noreferrer" data-i18n-label="打开项目 GitHub 仓库（新窗口）" aria-label="打开项目 GitHub 仓库（新窗口）">${linkIconSvg('github')}<span>GitHub</span></a>` : ''}
      </div>`
          : ''
      }`
    document.body.append(menu)
    this.menu = menu
    const indicator = document.createElement('nav')
    indicator.className = 'page-indicator'
    indicator.setAttribute('aria-label', '章节切换')
    indicator.dataset.i18nLabel = '章节切换'
    indicator.innerHTML = navigation
      .map(
        (item) =>
          `<a href="#${item.id}" data-section="${item.id}" data-i18n-label="${escape(item.label)}" aria-label="${escape(item.label)}"><span aria-hidden="true"></span></a>`,
      )
      .join('')
    document.body.append(indicator)
    this.pageIndicator = indicator
    this.chapterStatus = document.createElement('p')
    this.chapterStatus.className = 'sr-only'
    this.chapterStatus.setAttribute('role', 'status')
    document.body.append(this.chapterStatus)
    this.menuButton.addEventListener('click', () => this.toggleMenu())
    menu
      .querySelector('.menu-close')
      .addEventListener('click', () => this.toggleMenu(false))
    menu.addEventListener('cancel', (event) => {
      event.preventDefault()
      this.toggleMenu(false)
    })
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) this.toggleMenu(false)
      if (event.target === menu) {
        const bounds = menu.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          this.toggleMenu(false)
      }
    })

    const access = document.createElement('div')
    access.className = 'screen-access'
    access.setAttribute('role', 'region')
    access.setAttribute('aria-label', 'Macintosh 屏幕')
    access.dataset.i18nLabel = 'Macintosh 屏幕'
    access.hidden = true
    document.body.append(access)
    this.screenAccess = access
    const focusBack = document.createElement('button')
    focusBack.type = 'button'
    focusBack.className = 'focus-back'
    focusBack.hidden = true
    focusBack.innerHTML = `<span aria-hidden="true">←</span>${translated('返回书桌')}`
    document.body.append(focusBack)
    this.focusBack = focusBack
    this.noteInput = document.createElement('textarea')
    this.noteInput.className = 'screen-hit screen-note'
    this.noteInput.setAttribute('aria-label', t('写一张便笺'))
    this.noteInput.maxLength = 240
    this.noteInput.spellcheck = false
    const status = document.createElement('p')
    status.className = 'sr-only'
    status.setAttribute('role', 'status')
    document.body.append(status)
    this.screenStatus = status

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/*,.mp4,.webm,.ogv'
    input.hidden = true
    input.setAttribute('aria-label', '选择本地视频')
    input.dataset.i18nLabel = '选择本地视频'
    document.body.append(input)
    this.fileInput = input

    const tip = document.createElement('div')
    tip.className = 'tip'
    document.body.append(tip)
    this.tip = tip
    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.setAttribute('role', 'status')
    document.body.append(toast)
    this.toastElement = toast

    this.fpsCounter = document.createElement('div')
    this.fpsCounter.className = 'fps-counter'
    this.updateFps()
    document.body.append(this.fpsCounter)

    const loader = document.createElement('div')
    loader.className = 'loader'
    loader.innerHTML = `
      <div class="loader-inner">
        <div class="loader-logo">hello.</div>
        <p>${translated('正在唤醒这台电脑')}</p>
        <div class="loader-track" role="progressbar" data-i18n-label="加载模型" aria-label="加载模型" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        <span class="loader-pct">0%</span>
      </div>`
    document.body.append(loader)
    this.loader = loader
    this.loaderBar = loader.querySelector('.loader-track i')
    this.loaderPct = loader.querySelector('.loader-pct')
    this.drawLoaderLogo = this._handwriting(
      loader.querySelector('.loader-logo'),
      helloLettering,
      true,
      0,
    )
    this.loadingProgress = 0
    this.loadingTarget = 0
    this.loadingFrame = 0
  }

  _block(block) {
    if (block.type === 'p') return `<p class="blk-p">${translated(block.text)}</p>`
    if (block.type === 'kv' || block.type === 'spec')
      return `<dl class="blk-spec">${block.items.map(([key, value]) => `<div><dt>${translated(key)}</dt><dd>${translated(value)}</dd></div>`).join('')}</dl>`
    if (block.type === 'practice')
      return `<dl class="practice-list">${block.items.map((item) => `<div><dt>${translated(item.title)}</dt><dd>${translated(item.desc)}</dd></div>`).join('')}</dl>`
    if (block.type === 'works') {
      const cards = block.items.map((work) => {
        const action = work.disk
          ? `data-disk="${escape(work.disk)}"`
          : `data-page="${escape(work.page || 'work')}"`
        const link = work.href
          ? `<a class="work-action" href="${escape(work.href)}" target="_blank" rel="noopener noreferrer">${translated('查看作品 ↗')}</a>`
          : `<button class="work-action" ${action} data-requires-3d disabled>${translated('进入体验 ↗')}</button>`
        return `<article class="work"><h3>${translated(work.title)}</h3><p>${translated(work.desc)}</p><div class="work-bottom">${link}</div></article>`
      })
      return `<div class="works-rail">${cards.join('')}</div>`
    }
    return ''
  }

  _links() {
    const links = getSiteLinks(site)
    return `<div class="chapter-links">${links
      .map(link => `<a href="${escape(link.href)}" target="_blank" rel="noopener noreferrer" data-link-label="${escape(link.label)}" aria-label="${escape(link.label)}（新窗口）">${linkIconSvg(link.icon)}${translated(link.label)}</a>`)
      .join('')}</div>`
  }

  _bindLanguageMenu(control) {
    const { signal } = this.events
    this.languageButton.addEventListener('click', () => this.toggleLanguageMenu(), { signal })
    this.languageMenu.addEventListener('click', (event) => {
      const option = event.target.closest('[data-language]')
      if (!option) return
      setLanguage(option.dataset.language)
      this.applyLanguage()
      this.onLanguageChange?.()
      this.toggleLanguageMenu(false, true)
    }, { signal })
    control.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        this.toggleLanguageMenu(false, true)
        return
      }
      if (this.languageMenu.hidden) {
        this.toggleLanguageMenu(true)
        return
      }
      const current = this.languageOptions.indexOf(document.activeElement)
      let next = current + (event.key === 'ArrowUp' ? -1 : 1)
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = this.languageOptions.length - 1
      const index = (next + this.languageOptions.length) % this.languageOptions.length
      this.languageOptions[index].focus({ preventScroll: true })
    }, { signal })
    document.addEventListener('pointerdown', (event) => {
      if (!control.contains(event.target)) this.toggleLanguageMenu(false)
    }, { signal })
    control.addEventListener('focusout', (event) => {
      if (!control.contains(event.relatedTarget)) this.toggleLanguageMenu(false)
    }, { signal })
  }

  toggleLanguageMenu(open = this.languageMenu.hidden, restoreFocus = false) {
    if (open) this.pager?.settle()
    this.languageMenu.hidden = !open
    this.languageButton.setAttribute('aria-expanded', String(open))
    document.body.classList.toggle('language-open', open)
    if (open) {
      this.languageOptions.find((option) => option.dataset.language === getLanguage())
        ?.focus({ preventScroll: true })
    } else if (restoreFocus) {
      this.languageButton.focus({ preventScroll: true })
    }
  }

  applyLanguage() {
    this.textEntrances?.beforeTextChange()
    translateDOM(document.body, { name: site.identity.name })
    document.documentElement.lang = getLanguage()
    document.title = t(site.meta.title)
    document.querySelector('meta[name="description"]').content = t(site.meta.description)
    document.querySelector('meta[property="og:title"]').content = t(site.meta.title)
    document.querySelector('meta[property="og:description"]').content = t(site.meta.description)
    this.setSound(this.soundBtn.getAttribute('aria-pressed') === 'true')
    this.menuButton.setAttribute('aria-label', t(this.menuWanted ? '收起导航' : '打开导航'))
    this.languageButton.title = t('切换语言')
    this.noteInput.setAttribute('aria-label', t('写一张便笺'))
    this.languageOptions.forEach((option) => {
      option.setAttribute('aria-checked', String(option.dataset.language === getLanguage()))
    })
    document.querySelectorAll('[data-link-label]').forEach((link) => {
      link.setAttribute('aria-label', t(link.dataset.linkLabel) + t('（新窗口）'))
    })
    this.hintControls?.forEach((control) => {
      const label = control.disk
        ? t('{title} · 开盒放映', { title: t(site.disks.find((disk) => disk.id === control.disk)?.title || '') })
        : t(control.label)
      control.element.setAttribute('aria-label', label)
      control.element.querySelector('.hint-label').textContent = label
    })
    const title = this.sections.find((section) => section.classList.contains('is-current'))
      ?.querySelector('h1,h2').textContent
    if (title) this.chapterStatus.textContent = t('当前章节，{title}', { title })
    if (this.failureMessage) this.showFailure(this.failureMessage)
    this.hideTip()
    this.textEntrances?.refresh()
  }

  toggleMenu(open = !this.menuWanted) {
    if (open) {
      this.toggleLanguageMenu(false)
      this.pager?.settle()
    }
    this.menuWanted = open
    const wasOpen = this.menu.open
    const currentTransform = wasOpen
      ? getComputedStyle(this.menu).transform
      : 'translateY(-8px) scale(.97)'
    this.menuAnimation?.cancel()
    if (open && !wasOpen) this.menu.showModal()
    this.menu.classList.toggle('is-glass-closing', !open)
    this.menuButton.setAttribute('aria-expanded', String(open))
    this.menuButton.setAttribute('aria-label', t(open ? '收起导航' : '打开导航'))
    document.body.classList.toggle('menu-open', open)
    if (!open) this.pager?.settle()
    const complete = () => {
      if (!this.menuWanted) {
        this.menu.close()
        this.menuButton.focus({ preventScroll: true })
      }
    }
    if (
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !this.menu.open
    ) {
      complete()
      return
    }
    this.menuAnimation = this.menu.animate(
      [
        { transform: currentTransform },
        {
          transform: open
            ? 'translateY(0) scale(1)'
            : 'translateY(-8px) scale(.97)',
        },
      ],
      { duration: open ? 320 : 160, easing: 'cubic-bezier(.22,1.5,.36,1)' },
    )
    this.menuAnimation.onfinish = complete
  }

  _handwriting(element, lettering, period = false, initialProgress = 1) {
    const label = document.createElement('span')
    label.className = 'sr-only'
    label.textContent = element.textContent
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    const resolution = period ? 3 : 8
    const padding = 6
    const width = lettering.width + padding * 2 + (period ? 12 : 0)
    canvas.width = Math.ceil(width * 1.14 * resolution)
    canvas.height = Math.ceil((lettering.height + padding * 2) * 0.96 * resolution)
    const ctx = canvas.getContext('2d')
    const style = getComputedStyle(element)
    const draw = (progress) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.scale(1.14 * resolution, 0.96 * resolution)
      ctx.translate(padding, padding)
      ctx.strokeStyle = style.color
      // Reserve the final part of the wordmark's reveal for its period.
      const writingEnd = period ? 0.96 : 1
      drawHandwriting(ctx, lettering, Math.min(1, progress / writingEnd))
      if (period && progress > writingEnd) {
        ctx.fillStyle = style.getPropertyValue('--accent')
        ctx.globalAlpha = Math.min(1, (progress - writingEnd) / (1 - writingEnd))
        ctx.beginPath()
        ctx.arc(lettering.width + 9, 67, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    draw(initialProgress)
    element.replaceChildren(label, canvas)
    element.classList.add('handwritten')
    return draw
  }

  syncScreenHotspots(crt, mac) {
    const hotspots = [...crt.hotspots]
    if (mac.powerCenter)
      hotspots.push({
        id: 'hardware-power',
        label: t(crt.powered ? '关闭电脑电源' : '打开电脑电源'),
        hardware: true,
      })
    const signature = JSON.stringify(
      hotspots.map(({ id, label, x, y, w, h }) => [id, label, x, y, w, h]),
    )
    if (signature === this.hotspotSignature) return
    this.hotspotSignature = signature
    const focusedId = document.activeElement?.dataset.hotspot
    const previous = new Map(
      this.screenControls.map((control) => [
        control.element.dataset.hotspot,
        control.element,
      ]),
    )
    this.screenControls = hotspots.map((hotspot, index) => {
      const element = hotspot.input
        ? this.noteInput
        : previous.get(hotspot.id) || document.createElement('button')
      element.className = hotspot.input
        ? 'screen-hit screen-note'
        : 'screen-hit'
      element.dataset.hotspot = hotspot.id
      element.style.zIndex = String(hotspots.length - index)
      element.setAttribute('aria-label', t(hotspot.label || hotspot.id))
      if (!hotspot.input) element.textContent = t(hotspot.label || hotspot.id)
      const points = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y]) =>
        hotspot.hardware
          ? mac.powerCenter
              .clone()
              .add({ x: 0.01, y: (0.5 - y) * 0.032, z: (0.5 - x) * 0.032 })
          : mac.screenPoint(
              (hotspot.x + x * hotspot.w) / site.screen.width,
              (hotspot.y + y * hotspot.h) / site.screen.height,
            ),
      )
      element.onpointerenter = () => crt.setHover(hotspot.id)
      element.onpointerdown = (event) => {
        if (event.button === 0) crt.setPressed(hotspot.id)
      }
      element.onpointercancel = () => crt.setPressed(null)
      element.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ')
          crt.setPressed(hotspot.id)
      }
      element.onkeyup = () => crt.setPressed(null)
      element.onpointerleave = () => crt.setHover(null)
      element.onfocus = () => {
        crt.keyboardFocus = element.matches(':focus-visible')
        crt.setHover(hotspot.id)
      }
      element.onblur = () => {
        crt.keyboardFocus = false
        crt.setHover(null)
      }
      return { element, points }
    })
    const activeIds = new Set(hotspots.map((hotspot) => hotspot.id))
    for (const [id, element] of previous) {
      if (!activeIds.has(id)) element.remove()
    }
    for (const { element } of this.screenControls) {
      if (element.parentElement !== this.screenAccess)
        this.screenAccess.append(element)
    }
    if (focusedId)
      this.screenControls
        .find((control) => control.element.dataset.hotspot === focusedId)
        ?.element.focus({ preventScroll: true })
  }

  updateScreenProjection(camera) {
    if (this.screenAccess.hidden) return
    for (const control of this.screenControls) {
      const points = control.points.map((point) => {
        const projected = point.clone().project(camera)
        return {
          x: ((projected.x + 1) * innerWidth) / 2,
          y: ((1 - projected.y) * innerHeight) / 2,
        }
      })
      const left = Math.min(...points.map((point) => point.x))
      const top = Math.min(...points.map((point) => point.y))
      const width = Math.max(...points.map((point) => point.x)) - left
      const height = Math.max(...points.map((point) => point.y)) - top
      control.element.hidden =
        control.element.dataset.hotspot === 'hardware-power' &&
        (left < 0 ||
          top < 0 ||
          left + width > innerWidth ||
          top + height > innerHeight)
      Object.assign(control.element.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        clipPath: `polygon(${points.map((point) => `${((point.x - left) / width) * 100}% ${((point.y - top) / height) * 100}%`).join(',')})`,
      })
    }
  }

  setSceneHints(targets) {
    const sectionId = site.sections.find((section) => section.interactive)?.id
    this.hintSection = this.sections.find((section) => section.id === sectionId)
    this.sceneHints = document.createElement('div')
    this.sceneHints.className = 'scene-hints'
    this.sceneHints.setAttribute('role', 'group')
    this.sceneHints.setAttribute('aria-label', '桌面物件')
    this.sceneHints.dataset.i18nLabel = '桌面物件'
    this.sceneHints.hidden = true
    this.hintControls = targets.map((target) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'scene-hint'
      element.dataset.scene = target.kind
      element.setAttribute('data-requires-3d', '')
      element.disabled = true
      if (target.disk) element.dataset.disk = target.disk
      element.setAttribute('aria-label', target.label)
      element.innerHTML = `<span class="hint-dot" aria-hidden="true"></span><span class="hint-label" aria-hidden="true">${escape(target.label)}</span>`
      this.sceneHints.append(element)
      return { ...target, element }
    })
    document.body.append(this.sceneHints)
    this.applyLanguage()
  }

  updateSceneHints(camera, focused, pickAt) {
    const active =
      !focused &&
      this.hintSection?.classList.contains('is-current') &&
      Math.abs(scrollY - this.hintSection.offsetTop) < 8
    this.sceneHints.hidden = !active
    if (!active) {
      this.pendingHintFocus = null
      return
    }
    for (const control of this.hintControls) {
      const point = control.point.clone().project(camera)
      const x = ((point.x + 1) * innerWidth) / 2
      const y = ((1 - point.y) * innerHeight) / 2
      const inView =
        point.z > -1 &&
        point.z < 1 &&
        x > 22 &&
        x < innerWidth - 22 &&
        y > 80 &&
        y < innerHeight - 22
      const hit = inView && pickAt(x, y)
      const matches =
        control.kind === 'computer'
          ? hit && ['screen', 'computer'].includes(hit.kind)
          : hit?.kind === control.kind &&
            (!control.disk || hit.disk?.data.id === control.disk)
      control.element.hidden = !matches
      control.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
      if (matches && this.pendingHintFocus === control.element) {
        if (document.activeElement === document.body)
          control.element.focus({ preventScroll: true })
        this.pendingHintFocus = null
      }
    }
  }

  updateFps(now) {
    if (now === undefined) {
      this.fpsSampleStart = null
      this.fpsFrames = 0
      this.fpsCounter.textContent = '-- FPS'
      return
    }
    if (this.fpsSampleStart === null) {
      this.fpsSampleStart = now
      return
    }
    this.fpsFrames += 1
    // Use real frame intervals rather than the animation's clamped delta.
    const duration = now - this.fpsSampleStart
    if (duration < 500) return
    this.fpsCounter.textContent = `${Math.round(this.fpsFrames * 1000 / duration)} FPS`
    this.fpsSampleStart = now
    this.fpsFrames = 0
  }

  ready() {
    document.querySelectorAll('[data-requires-3d]').forEach((button) => {
      button.disabled = false
    })
    this.loaderReady = true
    this.setLoading(1)
  }

  setLoading(progress) {
    if (!Number.isFinite(progress) || this.loader.inert) return
    this.loadingTarget = Math.max(this.loadingTarget, Math.min(1, progress))
    cancelAnimationFrame(this.loadingFrame)
    const from = this.loadingProgress
    const target = this.loadingTarget
    const started = performance.now()
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduceMotion || from === target ? 0 : 220
    const update = (now) => {
      const fraction = duration ? Math.min(1, (now - started) / duration) : 1
      this._renderLoading(from + (target - from) * fraction)
      if (fraction < 1) {
        this.loadingFrame = requestAnimationFrame(update)
      } else {
        this.loadingFrame = 0
        if (this.loaderReady) this.hideLoader()
      }
    }
    update(started)
  }

  _renderLoading(progress) {
    this.loadingProgress = progress
    const pct = Math.round(progress * 100)
    this.drawLoaderLogo(progress)
    this.loaderBar.style.width = `${progress * 100}%`
    this.loaderBar.parentElement.setAttribute('aria-valuenow', pct)
    this.loaderPct.textContent = `${pct}%`
  }

  hideLoader() {
    cancelAnimationFrame(this.loadingFrame)
    this.loadingFrame = 0
    this.loader.classList.add('done')
    this.loader.inert = true
    document.body.classList.add('booted')
    this.textEntrances?.update()
  }

  showFailure(message) {
    this.failureMessage = message
    this.updateFps()
    this.updateChapterTilt({ x: 0, y: 0 }, false)
    this.hideLoader()
    this.exitFocus()
    document.body.classList.add('scene-failed')
    this.textEntrances?.update()
    if (this.sceneHints) this.sceneHints.hidden = true
    this.pager?.dispose()
    this.pageIndicator.hidden = true
    document.querySelectorAll('[data-requires-3d]').forEach((button) => {
      button.disabled = true
    })
    let notice = document.querySelector('.failure-notice')
    if (!notice) {
      notice = document.createElement('aside')
      notice.className = 'failure-notice'
      notice.setAttribute('role', 'alert')
      notice.innerHTML = `<p></p><button>${translated('重新加载')}</button>`
      notice
        .querySelector('button')
        .addEventListener('click', () => location.reload())
      document.body.append(notice)
      this.disposeFailureGlass = initLiquidGlass(notice)
    }
    notice.querySelector('p').textContent =
      `${t(message)} ${t('你可以继续阅读页面内容。')}`
  }

  setProgress(index) {
    if (this.progressIndex === index) return
    this.progressIndex = index
    const id = index < 0 ? 'home' : site.sections[index].id
    document.body.dataset.chapter = id
    for (const section of this.sections) {
      const active = section.id === id
      section.classList.toggle('is-current', active)
      section.inert = !active
      section.setAttribute('aria-hidden', String(!active))
      if (active) {
        this.chapterStatus.textContent = t('当前章节，{title}', { title: section.querySelector('h1,h2').textContent.replace(/\s+/g, ' ') })
      }
    }
    document.querySelectorAll('[data-section]').forEach((link) => {
      if (link.dataset.section === id)
        link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    })
    this.textEntrances?.update()
  }

  updateChapterTilt(pointer, enabled) {
    const surface = enabled
      ? this.chapterSurfaces[this.progressIndex + 1]
      : null
    if (surface !== this.tiltedSurface) {
      this.tiltedSurface?.style.removeProperty('transform')
      this.tiltedSurface = surface
    }
    if (!surface) return
    const { x, y } = pointer
    // A single transform gives all content the same perspective and pivot.
    surface.style.transform =
      Math.abs(x) + Math.abs(y) < 0.0001
        ? ''
        : `perspective(1100px) translate3d(${(x * 10).toFixed(3)}px, ${(y * 6).toFixed(3)}px, 0) rotateX(${(-y * 3.2).toFixed(3)}deg) rotateY(${(x * 4.5).toFixed(3)}deg)`
  }

  showTip(text, x, y) {
    this.tip.textContent = t(text)
    this.tip.classList.add('show')
    this.tip.style.transform = `translate(${Math.min(x + 18, innerWidth - this.tip.offsetWidth - 12)}px, ${Math.min(y + 20, innerHeight - 50)}px)`
  }

  hideTip() {
    this.tip.classList.remove('show')
    document.getElementById('stage').style.cursor = ''
  }

  enterFocus() {
    this.pager.stop()
    this.returnFocus = document.activeElement
    if (this.sceneHints) this.sceneHints.hidden = true
    document.body.classList.add('is-focus')
    this.focusBack.hidden = false
    document.getElementById('page').inert = true
    this.hideTip()
  }

  exitFocus() {
    this.screenAccess.hidden = true
    this.noteInput.blur()
    this.focusBack.hidden = true
    delete document.body.dataset.focusView
    document.body.classList.remove('is-focus')
    document.getElementById('page').inert = false
    if (this.sceneHints)
      this.sceneHints.hidden =
        !this.hintSection?.classList.contains('is-current')
    if (this.returnFocus?.classList.contains('scene-hint'))
      this.pendingHintFocus = this.returnFocus
    else this.returnFocus?.focus({ preventScroll: true })
    this.returnFocus = null
    this.pager?.settle()
  }

  setScreenPage(page) {
    this.screenStatus.textContent =
      page === 'about'
        ? `${site.identity.name}。${t(site.identity.bio)}`
        : t('电脑屏幕 · {page}', { page })
  }

  setMedia(crt) {
    if (crt.page === 'reel')
      this.screenStatus.textContent =
        t(crt.mediaError) ||
        `${t(crt.paused ? '已暂停' : '正在放映')} · ${t(crt.disk?.title || '')}`
  }

  setSound(on) {
    this.soundBtn.setAttribute('aria-pressed', String(on))
    const label = t(on ? '关闭声音' : '打开声音')
    this.soundBtn.setAttribute('aria-label', label)
    this.soundBtn.title = label
  }

  toast(text, ms = 2200) {
    this.toastElement.textContent = t(text)
    this.toastElement.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(
      () => this.toastElement.classList.remove('show'),
      ms,
    )
  }

  dispose() {
    this.events.abort()
    this.fpsCounter.remove()
    document.body.classList.remove('language-open')
    cancelAnimationFrame(this.loadingFrame)
    this.menuAnimation?.cancel()
    this.textEntrances?.dispose()
    this.pager.dispose()
    this.disposeGlass?.()
    this.disposeFailureGlass?.()
  }
}
