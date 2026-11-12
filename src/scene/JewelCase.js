import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { assetUrl } from '../core/assets.js'

export const CASE_WIDTH = 0.146
export const CASE_DEPTH = 0.132
export const CASE_BASE_THICKNESS = 0.012
export const CASE_LID_Y = 0.009
export const DISC_REST_Y = 0.0044
const W = CASE_WIDTH
const D = CASE_DEPTH
const BOOKLET = 0.121

function canvasTexture(canvas, anisotropy, color = true) {
  const texture = new THREE.CanvasTexture(canvas)
  if (color) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = anisotropy
  return texture
}

function paperTexture(data, anisotropy, spine = false) {
  const canvas = document.createElement('canvas')
  canvas.width = spine ? 1024 : 512
  canvas.height = spine ? 64 : 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#eae4d4'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = data.color
  if (spine) {
    ctx.fillRect(0, 0, 88, 64)
    ctx.fillStyle = '#f9f0da'
    ctx.font = 'bold 22px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('VCD', 44, 41)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#252824'
    ctx.font = 'bold 35px "Microsoft YaHei", sans-serif'
    ctx.fillText(data.title, 111, 43, 700)
    ctx.textAlign = 'right'
    ctx.font = '28px Georgia, serif'
    ctx.fillText(data.year, 996, 42)
  } else {
    ctx.fillRect(36, 40, 440, 5)
    ctx.font = '18px Arial, sans-serif'
    ctx.fillText('MEMORY ARCHIVE  /  VIDEO CD', 36, 78)
    ctx.fillStyle = '#33342f'
    ctx.font = 'bold 37px "Microsoft YaHei", sans-serif'
    ctx.fillText(data.title, 36, 155, 440)
    ctx.font = '22px "Microsoft YaHei", sans-serif'
    ctx.fillText(data.note || '', 36, 210, 440)
    ctx.fillStyle = '#77766d'
    ctx.font = '16px Arial, sans-serif'
    ctx.fillText('COLOR / STEREO', 36, 274)
    ctx.fillText(`ARCHIVE ${data.year}`, 36, 302)
    ctx.strokeStyle = '#bab6a9'
    for (const y of [338, 355, 372, 389]) {
      ctx.beginPath(); ctx.moveTo(36, y); ctx.lineTo(420 - (y % 3) * 35, y); ctx.stroke()
    }
    ctx.fillStyle = data.color
    ctx.font = '54px Georgia, serif'
    ctx.fillText(data.year, 36, 470)
  }
  return canvasTexture(canvas, anisotropy)
}

function artwork(data, anisotropy) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')
  // A legible fallback also lets custom discs omit the optional cover asset.
  ctx.fillStyle = data.color
  ctx.fillRect(0, 0, 1024, 1024)
  ctx.fillStyle = '#f3e8cc'
  ctx.font = 'bold 84px "Microsoft YaHei", sans-serif'
  ctx.fillText(data.title, 70, 730, 884)
  ctx.font = '100px Georgia, serif'
  ctx.fillText(data.year, 70, 900)
  const texture = canvasTexture(canvas, anisotropy)
  texture.name = `${data.id}:printed-cover`
  const ready = data.cover ? new Promise(resolve => {
    const image = new Image()
    image.onload = () => {
      ctx.drawImage(image, 0, 0, 1024, 1024)
      texture.needsUpdate = true
      resolve(true)
    }
    image.onerror = () => {
      console.warn(`[discs] Cover unavailable: ${data.cover}`)
      resolve(false)
    }
    if (/^https?:/i.test(data.cover)) image.crossOrigin = 'anonymous'
    image.src = assetUrl(data.cover)
  }) : Promise.resolve(false)
  return { texture, ready }
}

/** Shared materials avoid an extra transmission render pass for these tiny props. */
export function createCaseMaterials(anisotropy) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#c7c7c7'
  ctx.fillRect(0, 0, 256, 256)
  ctx.lineWidth = .5
  for (let i = 0; i < 55; i++) {
    const x = (i * 73.79) % 256
    const y = (i * 31.31) % 256
    ctx.strokeStyle = i % 3 ? '#dddddd' : '#a9a9a9'
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5 + i % 23, y + 1.5); ctx.stroke()
  }
  const roughnessMap = canvasTexture(canvas, anisotropy, false)
  const clear = new THREE.MeshPhysicalMaterial({
    name: 'Clear polystyrene lid', color: '#f3f7f6', metalness: 0,
    roughness: .19, roughnessMap, clearcoat: 1, clearcoatRoughness: .08,
    ior: 1.49, transparent: true, opacity: .14, depthWrite: false,
    envMapIntensity: 1.25,
  })
  const edge = new THREE.MeshPhysicalMaterial({
    name: 'Polished molded edges', color: '#b8c6c5', metalness: 0,
    roughness: .24, clearcoat: .9, clearcoatRoughness: .11,
    transparent: true, opacity: .5, depthWrite: false, envMapIntensity: 1.1,
  })
  const silver = new THREE.MeshPhysicalMaterial({
    color: '#ccd5d5', metalness: .88, roughness: .24,
    iridescence: .38, iridescenceIOR: 1.35, iridescenceThicknessRange: [100, 390],
    side: THREE.DoubleSide,
  })
  return { clear, edge, silver, anisotropy }
}

function mesh(parent, name, geometry, material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material)
  object.name = name
  object.position.set(x, y, z)
  parent.add(object)
  return object
}

function boxes(parent, name, parts, material) {
  const geometries = parts.map(([w, h, d, x, y, z]) =>
    new THREE.BoxGeometry(w, h, d).translate(x, y, z),
  )
  const combined = mergeGeometries(geometries)
  geometries.forEach(geometry => geometry.dispose())
  return mesh(parent, name, combined, material)
}

function repeated(parent, name, geometry, material, positions) {
  const instances = new THREE.InstancedMesh(geometry, material, positions.length)
  instances.name = name
  const dummy = new THREE.Object3D()
  positions.forEach(([x, y, z, angle = 0], index) => {
    dummy.position.set(x, y, z)
    dummy.rotation.y = angle
    dummy.updateMatrix()
    instances.setMatrixAt(index, dummy.matrix)
  })
  instances.instanceMatrix.needsUpdate = true
  parent.add(instances)
  return instances
}

export function buildJewelCase(disk, materials) {
  const { data, radius } = disk
  const { clear, edge, silver, anisotropy } = materials
  const print = artwork(data, anisotropy)
  disk.coverReady = print.ready
  disk.coverTexture = print.texture
  disk.bodyMat = new THREE.MeshStandardMaterial({
    name: 'Charcoal injection molded tray', color: '#242826', roughness: .47,
    metalness: 0, emissive: '#d0c5a8', emissiveIntensity: 0,
  })

  // Keep the first mesh's underside at -6 mm, the original tabletop support.
  const bottom = mesh(disk.case, 'Clear case base',
    new RoundedBoxGeometry(W + .004, .0016, D + .004, 2, .0005),
    edge, 0, -.0052)
  bottom.receiveShadow = true

  const trayOutline = new THREE.Shape()
  trayOutline.moveTo(-W / 2 + .001, -D / 2 + .001)
  trayOutline.lineTo(W / 2 - .001, -D / 2 + .001)
  trayOutline.lineTo(W / 2 - .001, D / 2 - .001)
  trayOutline.lineTo(-W / 2 + .001, D / 2 - .001)
  trayOutline.closePath()
  const well = new THREE.Path()
  well.absarc(0, 0, radius + .0014, 0, Math.PI * 2, true)
  trayOutline.holes.push(well)
  const trayGeometry = new THREE.ExtrudeGeometry(trayOutline, {
    depth: .0068, bevelEnabled: true, bevelSegments: 1,
    steps: 1, bevelSize: .0003, bevelThickness: .0003, curveSegments: 48,
  })
  trayGeometry.rotateX(-Math.PI / 2)
  const tray = mesh(disk.case, 'Recessed circular disc tray', trayGeometry, disk.bodyMat, 0, -.0039)
  tray.castShadow = tray.receiveShadow = true
  mesh(disk.case, 'Tray well floor', new THREE.CylinderGeometry(radius + .001, radius + .001, .0008, 64), disk.bodyMat, 0, -.0037)
  for (const r of [radius + .0007, .012]) {
    const ring = mesh(disk.case, 'Molded tray ring', new THREE.TorusGeometry(r, .00045, 5, 64), disk.bodyMat, 0, .001)
    ring.rotation.x = -Math.PI / 2
  }

  boxes(disk.case, 'Clear perimeter walls', [
    [W + .004, .009, .0015, 0, -.0002, -D / 2 - .0012],
    [W + .004, .009, .0015, 0, -.0002, D / 2 + .0012],
    [.0015, .009, D, W / 2 + .0012, -.0002, 0],
    [.0015, .009, D, -W / 2 - .0012, -.0002, 0],
  ], edge)
  mesh(disk.case, 'Solid hinge strip', new THREE.BoxGeometry(.013, .003, D - .004),
    disk.bodyMat, -W / 2 + .006, .0044)
  const ribs = Array.from({ length: 38 }, (_, i) => [-W / 2 + .006, .0061, -D / 2 + .004 + i * (D - .008) / 37])
  repeated(disk.case, 'Ribbed hinge strip', new THREE.BoxGeometry(.012, .0005, .00065), disk.bodyMat, ribs)
  boxes(disk.case, 'Hinge knuckles and clasp', [
    [.007, .007, .01, -W / 2 + .001, .004, -D / 2 + .008],
    [.007, .007, .01, -W / 2 + .001, .004, D / 2 - .008],
    [.002, .005, .014, W / 2 + .0005, .004, 0],
  ], edge)

  const spine = mesh(disk.case, 'Printed edge label',
    new THREE.PlaneGeometry(D - .006, .0068),
    new THREE.MeshStandardMaterial({ map: paperTexture(data, anisotropy, true), roughness: .78 }),
    W / 2 + .0013, -.0001)
  spine.rotation.y = Math.PI / 2

  disk.lid = new THREE.Group()
  disk.lid.name = 'Hinged clear lid'
  disk.lid.position.set(-W / 2, CASE_LID_Y, 0)
  disk.case.add(disk.lid)
  mesh(disk.lid, 'Polished transparent lid',
    new RoundedBoxGeometry(W - .012, .0016, D + .002, 2, .0005),
    clear, (W + .012) / 2, .0008)
  boxes(disk.lid, 'Lid rim and booklet clips', [
    [W - .012, .0021, .0012, (W + .012) / 2, -.0001, -D / 2],
    [W - .012, .0021, .0012, (W + .012) / 2, -.0001, D / 2],
    [.0012, .0021, D, W, -.0001, 0],
    [.004, .001, .006, .03, -.0014, -D / 2 + .003],
    [.004, .001, .006, .03, -.0014, D / 2 - .003],
    [.004, .001, .006, W - .016, -.0014, -D / 2 + .003],
    [.004, .001, .006, W - .016, -.0014, D / 2 - .003],
  ], edge)
  mesh(disk.lid, 'Booklet paper edge', new THREE.BoxGeometry(BOOKLET, .00035, BOOKLET),
    new THREE.MeshStandardMaterial({ color: '#e3ddce', roughness: .9 }), W / 2 + .006, -.00065)
  const cover = mesh(disk.lid, 'Photographic printed cover', new THREE.PlaneGeometry(BOOKLET, BOOKLET),
    new THREE.MeshStandardMaterial({ map: print.texture, roughness: .77 }), W / 2 + .006, -.00046)
  cover.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  const inside = mesh(disk.lid, 'Booklet inside liner', new THREE.PlaneGeometry(BOOKLET, BOOKLET),
    new THREE.MeshStandardMaterial({ map: paperTexture(data, anisotropy), roughness: .9 }), W / 2 + .006, -.00084)
  inside.rotation.set(Math.PI / 2, 0, -Math.PI / 2)

  mesh(disk.case, 'Spindle collar', new THREE.CylinderGeometry(.0068, .0075, .007, 24), disk.bodyMat, 0, .0009)
  repeated(disk.case, 'Twelve spindle retention teeth', new THREE.BoxGeometry(.0012, .0028, .0026), disk.bodyMat,
    Array.from({ length: 12 }, (_, i) => {
      const angle = i / 12 * Math.PI * 2
      return [Math.sin(angle) * .007, .0046, Math.cos(angle) * .007, angle]
    }))

  disk.disc = new THREE.Group()
  disk.disc.name = 'Printed optical disc'
  const surface = mesh(disk.disc, 'Iridescent silver recording surface', new THREE.RingGeometry(.0075, radius, 96), silver)
  surface.rotation.x = -Math.PI / 2
  surface.castShadow = true
  const underside = mesh(disk.disc, 'Disc underside', new THREE.RingGeometry(.0075, radius, 96), silver, 0, -.001)
  underside.rotation.x = Math.PI / 2
  mesh(disk.disc, 'Disc thickness', new THREE.CylinderGeometry(radius, radius, .001, 96, 1, true), silver, 0, -.0005)
  const label = mesh(disk.disc, 'Screen printed disc artwork', new THREE.RingGeometry(.014, radius * .91, 96),
    new THREE.MeshStandardMaterial({ map: print.texture, roughness: .68, side: THREE.DoubleSide }), 0, .00012)
  label.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  const ring = mesh(disk.disc, 'Clear center ring', new THREE.RingGeometry(.0075, .012, 48), edge, 0, .0002)
  ring.rotation.x = -Math.PI / 2
  disk.group.add(disk.disc)
}
