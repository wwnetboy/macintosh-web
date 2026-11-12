import * as THREE from 'three'

function cubic(a, b, c, d, t) {
  return (
    b +
    0.5 *
      t *
      (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)))
  )
}

/** Refine the supplied glass's regular control grid, preserving its UV atlas. */
export function refineScreenSurface(mesh, segments = 48, bulge = 0.018) {
  const source = mesh.geometry
  const world = source.clone().applyMatrix4(mesh.matrixWorld)
  const positions = world.attributes.position
  const uv = source.attributes.uv
  if (!uv) {
    world.dispose()
    return false
  }
  const columns = new Map()
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getZ(i)
    const key = Math.round(z * 100000)
    if (!columns.has(key)) columns.set(key, [])
    columns
      .get(key)
      .push([positions.getX(i), positions.getY(i), z, uv.getX(i), uv.getY(i)])
  }
  const grid = [...columns]
    .sort(([a], [b]) => b - a)
    .map(([, points]) => points.sort((a, b) => a[1] - b[1]))
  const rows = grid[0]?.length || 0
  if (
    grid.length < 4 ||
    rows < 4 ||
    grid.some((column) => column.length !== rows)
  ) {
    world.dispose()
    return false
  }
  const outputPositions = []
  const outputUv = []
  const indices = []
  const sample = (column, row, channel) =>
    grid[Math.max(0, Math.min(grid.length - 1, column))][
      Math.max(0, Math.min(rows - 1, row))
    ][channel]
  for (let row = 0; row <= segments; row++) {
    const gy = (row / segments) * (rows - 1)
    const iy = Math.floor(gy)
    for (let column = 0; column <= segments; column++) {
      const gx = (column / segments) * (grid.length - 1)
      const ix = Math.floor(gx)
      const values = []
      for (let channel = 0; channel < 5; channel++) {
        const alongRows = []
        for (let offset = -1; offset <= 2; offset++) {
          alongRows.push(
            cubic(
              sample(ix + offset, iy - 1, channel),
              sample(ix + offset, iy, channel),
              sample(ix + offset, iy + 1, channel),
              sample(ix + offset, iy + 2, channel),
              gy - iy,
            ),
          )
        }
        values.push(cubic(...alongRows, gx - ix))
      }
      // The glass faces +X. Keep its perimeter seated in the original aperture
      // while bringing the centre forward into a continuous convex surface.
      const horizontal = values[2] / INNER.topHalf
      const vertical =
        ((values[1] - INNER.bottom) / (INNER.top - INNER.bottom)) * 2 - 1
      values[0] +=
        bulge *
        Math.max(0, 1 - horizontal * horizontal) *
        Math.max(0, 1 - vertical * vertical)
      outputPositions.push(...values.slice(0, 3))
      outputUv.push(...values.slice(3))
      if (row < segments && column < segments) {
        const a = row * (segments + 1) + column
        const b = a + 1
        const c = a + segments + 1
        indices.push(a, b, c, b, c + 1, c)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(outputPositions, 3),
  )
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outputUv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.userData.screenGridSegments = segments
  geometry.applyMatrix4(mesh.matrixWorld.clone().invert())
  mesh.geometry = geometry
  source.dispose()
  world.dispose()
  return true
}

// Aperture measurements from the bundled Macintosh GLB, in world coordinates.
// The upper and lower radii match the original corner contours.
const INNER = {
  top: 1.142388,
  bottom: 0.960807,
  topHalf: 0.112808,
  bottomHalf: 0.112808,
  topRadiusZ: 0.0135,
  topRadiusY: 0.013017,
  bottomRadiusZ: 0.013044,
  bottomRadiusY: 0.01418,
  topX: 0.145079,
  bottomX: 0.154343,
}
const OUTER = {
  top: 1.152722,
  bottom: 0.947249,
  topHalf: 0.12396,
  bottomHalf: 0.123311,
  topRadiusZ: 0.013458,
  topRadiusY: 0.013007,
  bottomRadiusZ: 0.013091,
  bottomRadiusY: 0.014192,
  topX: 0.164989,
  bottomX: 0.176131,
}

function contour(profile, segments) {
  const corners = [
    {
      z: profile.topHalf - profile.topRadiusZ,
      y: profile.top - profile.topRadiusY,
      rz: profile.topRadiusZ,
      ry: profile.topRadiusY,
    },
    {
      z: -profile.topHalf + profile.topRadiusZ,
      y: profile.top - profile.topRadiusY,
      rz: profile.topRadiusZ,
      ry: profile.topRadiusY,
    },
    {
      z: -profile.bottomHalf + profile.bottomRadiusZ,
      y: profile.bottom + profile.bottomRadiusY,
      rz: profile.bottomRadiusZ,
      ry: profile.bottomRadiusY,
    },
    {
      z: profile.bottomHalf - profile.bottomRadiusZ,
      y: profile.bottom + profile.bottomRadiusY,
      rz: profile.bottomRadiusZ,
      ry: profile.bottomRadiusY,
    },
  ]
  const point = (corner, angle) => {
    const y = corner.y + Math.sin(angle) * corner.ry
    const z = corner.z + Math.cos(angle) * corner.rz
    const t = (profile.top - y) / (profile.top - profile.bottom)
    return new THREE.Vector3(
      THREE.MathUtils.lerp(profile.topX, profile.bottomX, t),
      y,
      z,
    )
  }
  const points = []
  for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
    const corner = corners[cornerIndex]
    for (let step = 0; step < segments; step++) {
      points.push(
        point(corner, ((cornerIndex + step / segments) * Math.PI) / 2),
      )
    }
    const end = point(corner, ((cornerIndex + 1) * Math.PI) / 2)
    const next = point(
      corners[(cornerIndex + 1) % 4],
      ((cornerIndex + 1) * Math.PI) / 2,
    )
    for (let step = 0; step < segments; step++)
      points.push(end.clone().lerp(next, step / segments))
  }
  return points
}

/** Round the aperture molding and reconnect it to the textured front housing. */
export function refineDisplayBezel(mesh) {
  const source = mesh.geometry
  const world = source.clone().applyMatrix4(mesh.matrixWorld)
  const positions = world.attributes.position
  const keptIndices = []
  let replacedFaces = 0
  const indexCount = source.index?.count || positions.count
  for (let index = 0; index < indexCount; index += 3) {
    const ids = [0, 1, 2].map((offset) =>
      source.index ? source.index.getX(index + offset) : index + offset,
    )
    const points = ids.map((id) =>
      new THREE.Vector3().fromBufferAttribute(positions, id),
    )
    const insideMolding = points.every(
      (point) =>
        point.y > 0.945 && point.y < 1.155 && Math.abs(point.z) < 0.126,
    )
    if (insideMolding) replacedFaces++
    else keptIndices.push(...ids)
  }
  if (!replacedFaces) {
    world.dispose()
    return null
  }
  const retained = source.clone()
  retained.setIndex(keptIndices)
  mesh.geometry = retained
  const segments = 20
  const crossSections = 8
  const inner = contour(INNER, segments)
  const outer = contour(OUTER, segments)
  const count = inner.length
  const outputPositions = []
  const indices = []
  for (let ring = -1; ring <= crossSections; ring++) {
    for (let index = 0; index < count; index++) {
      const t = ((Math.max(0, ring) / crossSections) * Math.PI) / 2
      const point = inner[index].clone().lerp(outer[index], 1 - Math.cos(t))
      point.x =
        ring < 0
          ? inner[index].x - 0.025
          : THREE.MathUtils.lerp(inner[index].x, outer[index].x, Math.sin(t)) +
            0.00012
      outputPositions.push(...point.toArray())
      if (ring < crossSections) {
        const a = (ring + 1) * count + index
        const b = (ring + 1) * count + ((index + 1) % count)
        indices.push(a, b, a + count, b, b + count, a + count)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(outputPositions, 3),
  )
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const material = mesh.material.clone()
  material.map = null
  material.color.set('#d9d5c4')
  material.roughness = 0.85
  material.envMapIntensity = 0.2
  const bezel = new THREE.Mesh(geometry, material)
  bezel.name = 'MacintoshSmoothDisplayBezel'
  bezel.castShadow = true
  bezel.receiveShadow = true
  source.dispose()
  world.dispose()
  return bezel
}
