const icons = {
  github: {
    size: 16,
    className: 'github-logo',
    fill: 'currentColor',
    stroke: 'none',
    path: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z',
  },
  tools: {
    size: 24,
    className: '',
    fill: 'none',
    stroke: 'currentColor',
    path: 'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2 12h20M9 11v3m6-3v3',
  },
  website: {
    size: 24,
    className: '',
    fill: 'none',
    stroke: 'currentColor',
    path: 'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0ZM16 12a4 10 0 1 1-8 0 4 10 0 1 1 8 0ZM2 12h20',
  },
}

export function linkIconSvg(name) {
  const icon = icons[name] || icons.website
  return `<svg class="link-icon ${icon.className}" viewBox="0 0 ${icon.size} ${icon.size}" width="20" height="20" fill="${icon.fill}" stroke="${icon.stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${icon.path}"/></svg>`
}

export function drawLinkIcon(ctx, name, x, y, size, color) {
  const icon = icons[name] || icons.website
  const path = new Path2D(icon.path)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / icon.size, size / icon.size)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (icon.fill === 'none') ctx.stroke(path)
  else ctx.fill(path)
  ctx.restore()
}
