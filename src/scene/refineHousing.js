import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Measurements use the bundled GLB's world axes. The front faces +X.
const SIDE_Z = 0.1487436
const FRONT_PANEL = [-0.003, 0.884, 0.127, 0.919]
const VENT_PANEL = [-0.174, 0.7625, 0.099, 0.8008]
const BADGE_BOUNDS = [-0.1218, 0.8563, -0.103, 0.8817]

function clipPolygon(vertices, axis, boundary, direction) {
  const inside = []
  const outside = []
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index]
    const b = vertices[(index + 1) % vertices.length]
    const distanceA = ((typeof axis === 'function' ? axis(a) : a[axis]) - boundary) * direction
    const distanceB = ((typeof axis === 'function' ? axis(b) : b[axis]) - boundary) * direction
    const da = Math.abs(distanceA) < 1e-10 ? 0 : distanceA
    const db = Math.abs(distanceB) < 1e-10 ? 0 : distanceB
    if (da >= 0) inside.push(a)
    if (da <= 0) outside.push(a)
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db)
      const intersection = a.map((value, channel) =>
        THREE.MathUtils.lerp(value, b[channel], t),
      )
      inside.push(intersection)
      outside.push(intersection)
    }
  }
  return { inside, outside }
}

function appendTriangles(output, polygon) {
  for (let index = 1; index < polygon.length - 1; index++) {
    output.push(polygon[0], polygon[index], polygon[index + 1])
  }
}

// Subtract a box from the actual triangles, including hidden inner surfaces.
// Interpolating all attributes keeps the original contour and shading intact.
function cutHousing(mesh, boxes) {
  const source = mesh.geometry
  const world = source.clone().applyMatrix4(mesh.matrixWorld)
  const geometry = world.index ? world.toNonIndexed() : world.clone()
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const uv = geometry.attributes.uv
  let vertices = Array.from({ length: position.count }, (_, index) => [
    position.getX(index), position.getY(index), position.getZ(index),
    normal.getX(index), normal.getY(index), normal.getZ(index),
    uv.getX(index), uv.getY(index),
  ])
  for (const box of boxes) {
    const output = []
    for (let index = 0; index < vertices.length; index += 3) {
      let polygon = vertices.slice(index, index + 3)
      const overlaps = [0, 1, 2].every(axis =>
        Math.max(...polygon.map(v => v[axis])) > box.min[axis] &&
        Math.min(...polygon.map(v => v[axis])) < box.max[axis],
      )
      if (!overlaps) {
        output.push(...polygon)
        continue
      }
      const planes = box.planes || [0, 1, 2].flatMap(axis => [
        [axis, box.min[axis], 1], [axis, box.max[axis], -1],
      ])
      for (const [axis, boundary, direction] of planes) {
        if (!polygon.length) break
        const split = clipPolygon(polygon, axis, boundary, direction)
        appendTriangles(output, split.outside)
        polygon = split.inside
      }
    }
    vertices = output
  }
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(v => v.slice(0, 3)), 3))
  result.setAttribute('normal', new THREE.Float32BufferAttribute(vertices.flatMap(v => v.slice(3, 6)), 3))
  result.setAttribute('uv', new THREE.Float32BufferAttribute(vertices.flatMap(v => v.slice(6, 8)), 2))
  result.applyMatrix4(mesh.matrixWorld.clone().invert())
  mesh.geometry = result
  source.dispose()
  world.dispose()
  geometry.dispose()
}

function roundedPolygon(points, radius) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], index) => {
    const corner = new THREE.Vector2(x, y)
    const previous = new THREE.Vector2(...points[(index + points.length - 1) % points.length])
    const next = new THREE.Vector2(...points[(index + 1) % points.length])
    const start = previous.sub(corner).normalize().multiplyScalar(radius).add(corner)
    const end = next.sub(corner).normalize().multiplyScalar(radius).add(corner)
    if (index === 0) shape.moveTo(start.x, start.y)
    else shape.lineTo(start.x, start.y)
    shape.quadraticCurveTo(x, y, end.x, end.y)
  })
  shape.closePath()
  return shape
}

function rectangle(bounds, radius = 0) {
  const [left, bottom, right, top] = bounds
  if (!radius) {
    const shape = new THREE.Shape()
    shape.moveTo(left, bottom)
    shape.lineTo(right, bottom)
    shape.lineTo(right, top)
    shape.lineTo(left, top)
    shape.closePath()
    return shape
  }
  return roundedPolygon([[left, bottom], [right, bottom], [right, top], [left, top]], radius)
}

function transformSurface(geometry, surface, depth = 0) {
  const position = geometry.attributes.position
  for (let index = 0; index < position.count; index++) {
    const point = surface(position.getX(index), position.getY(index), depth)
    position.setXYZ(index, ...point)
  }
  geometry.computeVertexNormals()
  return geometry
}

function addMesh(group, name, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function liningGeometry(outer, inner, surface, depth) {
  const outside = outer.getPoints(6)
  const inside = inner.getPoints(6)
  const positions = []
  const colors = []
  const indices = []
  const rings = [[outside, 0], [inside, -0.001], [inside, -depth]]
  for (const [ring, [points, inset]] of rings.entries()) {
    const occlusion = [1, 0.74, 0.12][ring]
    for (const point of points) {
      positions.push(...surface(point.x, point.y, inset))
      colors.push(occlusion, occlusion, occlusion)
    }
  }
  const count = outside.length
  for (let ring = 0; ring < 2; ring++) {
    for (let index = 0; index < count - 1; index++) {
      const a = ring * count + index
      const b = a + count
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function addPanel(group, name, bounds, openings, surface, material, darkMaterial, depth, includeFace = true) {
  if (includeFace) {
    const face = rectangle(bounds)
    face.holes = openings.map(opening => opening.outer)
    addMesh(group, name, transformSurface(new THREE.ShapeGeometry(face, 6), surface), material)
  }
  const linings = openings.map(({ outer, inner }) => liningGeometry(outer, inner, surface, depth))
  const liningMaterial = material.clone()
  liningMaterial.vertexColors = true
  addMesh(group, `${name}Walls`, mergeGeometries(linings), liningMaterial)
  linings.forEach(geometry => geometry.dispose())
  addMesh(group, `${name}Interior`, transformSurface(new THREE.ShapeGeometry(rectangle(bounds)), surface, -depth - 0.003), darkMaterial)
}

function driveOpening(inset) {
  return roundedPolygon([
    [0.003 + inset, 0.8935 + inset],
    [0.085 + inset, 0.8935 + inset],
    [0.085 + inset, 0.887 + inset],
    [0.122 - inset, 0.887 + inset],
    [0.122 - inset, 0.915 - inset],
    [0.085 + inset, 0.915 - inset],
    [0.085 + inset, 0.9045 - inset],
    [0.003 + inset, 0.9045 - inset],
  ], 0.0012)
}

// Decompose a concave aperture into convex prisms. Cutting these directly out
// of the source fascia preserves its continuous surface around the opening.
function frontOpeningCuts(shape) {
  const contour = shape.getPoints(6)
  contour.pop()
  return THREE.ShapeUtils.triangulateShape(contour, []).map(ids => {
    const points = ids.map(index => contour[index])
    const [a, b, c] = points
    const winding = Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
    const planes = [[0, 0.128, 1], [0, 0.2, -1]]
    for (let index = 0; index < 3; index++) {
      const start = points[index]
      const end = points[(index + 1) % 3]
      const du = end.x - start.x
      const dy = end.y - start.y
      const length = Math.hypot(du, dy)
      planes.push([vertex => (du * vertex[1] + dy * vertex[2]) / length, (du * start.y - dy * start.x) / length, winding])
    }
    return {
      min: [0.128, Math.min(...points.map(p => p.y)), -Math.max(...points.map(p => p.x))],
      max: [0.2, Math.max(...points.map(p => p.y)), -Math.min(...points.map(p => p.x))],
      planes,
    }
  })
}

function createPlastic() {
  const size = 128
  const pixels = new Uint8Array(size * size)
  let seed = 128
  for (let index = 0; index < pixels.length; index++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    pixels[index] = 100 + (seed >>> 26)
  }
  const grain = new THREE.DataTexture(pixels, size, size, THREE.RedFormat)
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping
  grain.magFilter = THREE.LinearFilter
  grain.minFilter = THREE.LinearMipmapLinearFilter
  grain.generateMipmaps = true
  grain.needsUpdate = true
  return new THREE.MeshStandardMaterial({
    name: 'Macintosh molded ABS',
    color: '#d9d5c4',
    roughness: 0.84,
    metalness: 0,
    envMapIntensity: 0.2,
    bumpMap: grain,
    bumpScale: 0.000008,
    side: THREE.DoubleSide,
  })
}

// Keep the broad side panels planar under moving light. Their imported vertex
// normals blend across the entire panel and produce large diagonal artifacts.
function finishPlasticGeometry(mesh) {
  const source = mesh.geometry
  const world = source.clone().applyMatrix4(mesh.matrixWorld)
  const geometry = world.index ? world.toNonIndexed() : world.clone()
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const uv = new Float32Array(position.count * 2)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index)
    b.fromBufferAttribute(position, index + 1)
    c.fromBufferAttribute(position, index + 2)
    const faceNormal = b.sub(a).cross(c.sub(a)).normalize()
    const sidePanel = Math.abs(faceNormal.z) > 0.9999
    const frontPanel = faceNormal.x > 0.99 && a.x > 0.16 && a.y < 0.94
    const axes = Math.abs(faceNormal.x) > 0.7 ? [2, 1] : Math.abs(faceNormal.y) > 0.7 ? [0, 2] : [0, 1]
    for (let vertex = index; vertex < index + 3; vertex++) {
      if (sidePanel) normal.setXYZ(vertex, 0, 0, Math.sign(faceNormal.z))
      if (frontPanel) normal.setXYZ(vertex, 0.999277, 0.038, 0)
      a.fromBufferAttribute(position, vertex)
      uv[vertex * 2] = a.getComponent(axes[0]) * 24
      uv[vertex * 2 + 1] = a.getComponent(axes[1]) * 24
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.applyMatrix4(mesh.matrixWorld.clone().invert())
  mesh.geometry = geometry
  source.dispose()
  world.dispose()
}

function addBadge(group, surface, plastic, darkMaterial) {
  const rim = rectangle(BADGE_BOUNDS, 0.0011)
  const inset = rectangle([-0.1212, 0.8569, -0.1036, 0.8811], 0.0008)
  addMesh(group, 'MacintoshBadgeBevel', liningGeometry(rim, inset, surface, 0.0008), plastic)
  const backing = darkMaterial.clone()
  backing.color.set('#b2ad99')
  backing.roughness = 0.64
  addMesh(group, 'MacintoshBadgeBacking', transformSurface(new THREE.ShapeGeometry(inset, 10), surface, -0.00075), backing)

  // Solid enamel outline with six separate color bands and a green leaf.
  const apple = new THREE.Shape()
  apple.moveTo(51, 76)
  apple.bezierCurveTo(39, 76, 35, 83, 23, 79)
  apple.bezierCurveTo(4, 73, 4, 49, 10, 32)
  apple.bezierCurveTo(16, 15, 25, 3, 34, 4)
  apple.bezierCurveTo(42, 4, 44, 9, 52, 9)
  apple.bezierCurveTo(60, 9, 63, 3, 71, 5)
  apple.bezierCurveTo(80, 7, 89, 22, 93, 33)
  apple.bezierCurveTo(74, 40, 71, 59, 89, 70)
  apple.bezierCurveTo(82, 81, 69, 84, 59, 79)
  apple.bezierCurveTo(56, 78, 54, 77, 51, 76)
  const leaf = new THREE.Shape()
  leaf.moveTo(51, 82)
  leaf.bezierCurveTo(50, 93, 60, 103, 73, 105)
  leaf.bezierCurveTo(74, 94, 63, 82, 51, 82)
  const geometry = new THREE.ShapeGeometry([apple, leaf], 16).toNonIndexed()
  const position = geometry.attributes.position
  const colors = ['#1598ce', '#8c368e', '#df3538', '#ee8b27', '#f1cc31', '#56a64a']
  const bands = [0, 18, 31, 44, 57, 70, 106]
  const points = []
  const vertexColors = []
  for (let band = 0; band < colors.length; band++) {
    const color = new THREE.Color(colors[band])
    for (let index = 0; index < position.count; index += 3) {
      let polygon = [0, 1, 2].map(offset => [position.getX(index + offset), position.getY(index + offset)])
      polygon = clipPolygon(polygon, 1, bands[band], 1).inside
      polygon = clipPolygon(polygon, 1, bands[band + 1], -1).inside
      const triangles = []
      appendTriangles(triangles, polygon)
      for (const [x, y] of triangles) {
        points.push(...surface(-0.1124 + (x - 50) * 0.000163, 0.8603 + y * 0.000163, -0.00045))
        vertexColors.push(color.r, color.g, color.b)
      }
    }
  }
  geometry.dispose()
  const emblem = new THREE.BufferGeometry()
  emblem.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  emblem.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3))
  emblem.computeVertexNormals()
  addMesh(group, 'MacintoshRainbowEmblem', emblem, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.08, side: THREE.DoubleSide }))
}

/** Replace the shallow textured control with a raised, beveled button cap. */
export function refinePowerButton(mesh, plastic) {
  const bounds = new THREE.Box3().setFromObject(mesh)
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const back = bounds.min.x - 0.0011
  const shape = rectangle([
    -size.z / 2 + 0.0006, -size.y / 2 + 0.0006,
    size.z / 2 - 0.0006, size.y / 2 - 0.0006,
  ], 0.0014)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.0052,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0006,
    bevelSegments: 4,
    curveSegments: 12,
    steps: 1,
  })
  const position = geometry.attributes.position
  const colors = []
  for (let index = 0; index < position.count; index++) {
    const exposed = THREE.MathUtils.smoothstep(position.getZ(index), 0, 0.0052)
    const shade = THREE.MathUtils.lerp(0.6, 1, exposed)
    colors.push(shade, shade, shade)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.rotateY(Math.PI / 2)
  geometry.translate(back, center.y, center.z)
  geometry.applyMatrix4(mesh.matrixWorld.clone().invert())
  mesh.geometry.dispose()
  mesh.geometry = geometry
  mesh.material = plastic.clone()
  mesh.material.vertexColors = true
  finishPlasticGeometry(mesh)

  const collarShape = rectangle([
    -size.z / 2 - 0.0006, -size.y / 2 - 0.0006,
    size.z / 2 + 0.0006, size.y / 2 + 0.0006,
  ], 0.0019)
  const collarGeometry = new THREE.ExtrudeGeometry(collarShape, {
    depth: 0.0006,
    bevelEnabled: true,
    bevelThickness: 0.0002,
    bevelSize: 0.0002,
    bevelSegments: 3,
    curveSegments: 12,
    steps: 1,
  })
  collarGeometry.rotateY(Math.PI / 2)
  collarGeometry.translate(back - 0.0003, center.y, center.z)
  const collarMaterial = plastic.clone()
  collarMaterial.color.set('#817d6d')
  const collar = new THREE.Mesh(collarGeometry, collarMaterial)
  collar.name = 'MacintoshPowerButtonCollar'
  collar.castShadow = collar.receiveShadow = true
  finishPlasticGeometry(collar)
  return collar
}

/** Refine the bundled housing after the display aperture has been rebuilt. */
export function refineHousing(root, bezel, computerNames = []) {
  const front = root.getObjectByName('Cube000_hello_4_0')
  const rear = root.getObjectByName('Cube008_hello_4_0')
  if (!front || !rear) return null
  const group = new THREE.Group()
  group.name = 'MacintoshHousingDetails'
  const plastic = createPlastic()
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#171814', roughness: 0.96, side: THREE.DoubleSide })

  // Sample the original front before cutting so the new molding follows its rake.
  const originalFront = new THREE.Mesh(front.geometry.clone().applyMatrix4(front.matrixWorld), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(-1, 0, 0))
  const surface = (u, y, depth = 0) => {
    ray.ray.origin.set(0.3, y, -u)
    const hit = ray.intersectObject(originalFront)[0]
    return [(hit?.point.x ?? 0.17765) + depth, y, -u]
  }
  const frontCuts = [driveOpening(0), rectangle(BADGE_BOUNDS, 0.0011)].flatMap(frontOpeningCuts)
  const [left, bottom, right, top] = VENT_PANEL
  const ventBoxes = [-1, 1].map(sign => ({
    min: [left, bottom, sign > 0 ? 0.125 : -0.16],
    max: [right, top, sign > 0 ? 0.16 : -0.125],
  }))
  const shells = computerNames.map(name => root.getObjectByName(name))
    .filter(mesh => mesh?.material.name === 'hello_4')
  for (const mesh of shells) {
    cutHousing(mesh, [...frontCuts, ...ventBoxes])
    mesh.material = plastic
    finishPlasticGeometry(mesh)
  }
  addPanel(group, 'MacintoshFloppyDrive', FRONT_PANEL, [{ outer: driveOpening(0), inner: driveOpening(0.0015) }], surface, plastic, darkMaterial, 0.024, false)
  // The wider finger recess contains a shallow molded shelf above and below
  // the continuous insertion slot, with the drive mechanism deeper inside.
  const shelves = [
    [0.087, 0.889, 0.1205, 0.895],
    [0.087, 0.903, 0.1205, 0.9135],
  ].map(bounds => transformSurface(new THREE.ShapeGeometry(rectangle(bounds, 0.0007), 6), surface, -0.0045))
  addMesh(group, 'MacintoshDriveFingerRecess', mergeGeometries(shelves), plastic)
  shelves.forEach(geometry => geometry.dispose())
  addBadge(group, surface, plastic, darkMaterial)
  const ventDecal = root.getObjectByName('Cube006_Macintosh_2_0')
  if (ventDecal) ventDecal.visible = false
  for (const sign of [-1, 1]) {
    const openings = []
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 8; column++) {
        const x = -0.168 + column * 0.0328
        const y = 0.765 + row * 0.0058
        openings.push({
          outer: rectangle([x, y, x + 0.028, y + 0.0031], 0.00065),
          inner: rectangle([x + 0.00035, y + 0.00035, x + 0.02765, y + 0.00275], 0.00045),
        })
      }
    }
    addPanel(group, `MacintoshSideVents${sign > 0 ? 'Left' : 'Right'}`, VENT_PANEL, openings, (x, y, depth = 0) => [x, y, sign * (SIDE_Z + depth)], plastic, darkMaterial, 0.008)
  }
  originalFront.geometry.dispose()
  originalFront.material.dispose()
  if (bezel) {
    bezel.material.dispose()
    bezel.material = plastic
    finishPlasticGeometry(bezel)
  }
  // Generated parts get the same physical grain scale as the retained housing.
  group.updateMatrixWorld(true)
  group.traverse(mesh => {
    if (mesh.isMesh && mesh.material.bumpMap === plastic.bumpMap) finishPlasticGeometry(mesh)
  })
  group.userData.ventCount = 96
  return group
}
