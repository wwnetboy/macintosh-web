import * as THREE from 'three'

function createLettering(width, strokes) {
  const path = new Path2D()
  const svgPath = []
  const curve = new THREE.CurvePath()
  for (const { start, segments } of strokes) {
    let previous = new THREE.Vector2(...start)
    path.moveTo(previous.x, previous.y)
    svgPath.push(`M${start.join(' ')}`)
    for (const [x1, y1, x2, y2, x, y] of segments) {
      const end = new THREE.Vector2(x, y)
      curve.add(
        new THREE.CubicBezierCurve(
          previous,
          new THREE.Vector2(x1, y1),
          new THREE.Vector2(x2, y2),
          end,
        ),
      )
      path.bezierCurveTo(x1, y1, x2, y2, x, y)
      svgPath.push(`C${[x1, y1, x2, y2, x, y].join(' ')}`)
      previous = end
    }
  }
  return { path, svgPath: svgPath.join(' '), length: curve.getLength(), width, height: 74 }
}

// Shared pen geometry for the CRT greeting and the page wordmarks.
export const helloLettering = createLettering(164, [{
  start: [0, 62],
  segments: [
    [10, 49, 20, 19, 26, 9],
    [34, -3, 35, 15, 23, 35],
    [17, 46, 10, 60, 7, 70],
    [16, 51, 27, 35, 34, 41],
    [42, 47, 26, 65, 34, 68],
    [40, 71, 46, 59, 51, 53],
    [73, 43, 66, 34, 57, 40],
    [43, 49, 44, 68, 56, 68],
    [70, 68, 82, 40, 90, 16],
    [97, -5, 86, -2, 79, 20],
    [74, 35, 67, 58, 73, 66],
    [82, 79, 99, 48, 111, 15],
    [119, -6, 108, -2, 101, 21],
    [95, 39, 88, 62, 97, 67],
    [106, 73, 114, 57, 122, 47],
    [130, 36, 143, 37, 143, 49],
    [143, 61, 132, 72, 122, 67],
    [111, 61, 121, 42, 131, 41],
    [139, 40, 134, 55, 147, 53],
    [154, 52, 159, 46, 164, 41],
  ],
}])

export const vcoreLettering = createLettering(176, [
  {
    start: [0, 10],
    segments: [
      [10, 2, 11, 43, 17, 67],
      [28, 53, 38, 20, 52, 6],
      [56, 2, 59, 3, 56, 8],
    ],
  },
  {
    start: [78, 45],
    segments: [
      [65, 33, 53, 43, 52, 56],
      [49, 72, 65, 74, 85, 47],
      // The o repeats the loop and exit stroke from hello.
      [93, 36, 106, 37, 106, 49],
      [106, 61, 95, 72, 85, 67],
      [74, 61, 84, 42, 94, 41],
      [102, 40, 97, 55, 110, 53],
      [114, 47, 117, 41, 120, 39],
      [124, 35, 122, 44, 118, 51],
      [115, 58, 113, 64, 111, 68],
      [117, 56, 125, 40, 132, 41],
      [137, 42, 133, 48, 138, 49],
      [140, 49, 142, 51, 143, 53],
      // The e uses the same open loop and rounded baseline as hello.
      [165, 43, 158, 34, 149, 40],
      [135, 49, 136, 68, 148, 68],
      [159, 69, 170, 56, 176, 48],
    ],
  },
])

export function drawHandwriting(ctx, lettering, progress = 1, lineWidth = 3.8) {
  if (progress <= 0) return
  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([lettering.length, lettering.length])
  ctx.lineDashOffset = lettering.length * (1 - progress)
  ctx.stroke(lettering.path)
  ctx.restore()
}
