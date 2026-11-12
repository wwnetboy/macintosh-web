import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createCrtMaterial } from './crtMaterial.js'
import { assetUrl } from '../core/assets.js'
import { refineScreenSurface, refineDisplayBezel } from './refineDisplay.js'
import { refineHousing, refinePowerButton } from './refineHousing.js'

/**
 * Mac — loads the Macintosh model, swaps the baked screen for a live CRT,
 * and exposes the spots the site can interact with.
 */
export class Mac {
  constructor(stage, site, crt) {
    this.stage = stage
    this.site = site
    this.crt = crt
    this.group = new THREE.Group()
    this.anchors = {}
    this.targets = []
    this.materials = []
  }

  async load(onProgress) {
    const loader = new GLTFLoader()
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        assetUrl(this.site.parts.modelUrl),
        resolve,
        (e) => {
          if (onProgress && e.total) onProgress(e.loaded / e.total)
        },
        reject,
      )
    })

    const root = gltf.scene
    this.root = root
    this.group.add(root)

    const maxAniso = this.stage.renderer.capabilities.getMaxAnisotropy()

    root.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      o.receiveShadow = true
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!m) continue
        if (m.map) {
          m.map.anisotropy = Math.min(4, maxAniso)
          m.map.colorSpace = THREE.SRGBColorSpace
        }
        if ('envMapIntensity' in m) m.envMapIntensity = 0.55
        // Give the supplied tabletop a matte wood finish.
        if (m.name === 'mahagon_3') m.roughness = 0.84
        m.shadowSide = THREE.DoubleSide
      }
    })

    root.updateMatrixWorld(true)

    // ---------------------------------------------------------- the screen
    const screenMesh =
      root.getObjectByName(this.site.parts.screenMesh) ||
      this._findScreenFallback(root)

    if (!screenMesh)
      throw new Error('找不到屏幕网格，请检查 site.parts.screenMesh 配置。')

    const attachmentCenter = new THREE.Box3()
      .setFromObject(screenMesh)
      .getCenter(new THREE.Vector3())
    if (this.site.parts.displayBezelMesh) {
      const bezelMesh = root.getObjectByName(this.site.parts.displayBezelMesh)
      if (bezelMesh) {
        this.refinedBezel = refineDisplayBezel(bezelMesh)
        if (this.refinedBezel) this.group.add(this.refinedBezel)
      }
      refineScreenSurface(screenMesh, 48, this.site.screen.glassBulge)
      this.refinedHousing = refineHousing(root, this.refinedBezel, this.site.parts.computerMeshes)
      if (this.refinedHousing) this.group.add(this.refinedHousing)
    }

    const box = new THREE.Box3().setFromObject(screenMesh)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    // the glass faces +X (towards the chair); width runs along Z, height along Y
    const width = size.z
    const height = size.y

    this.screen = {
      mesh: screenMesh,
      center,
      width,
      height,
      normal: new THREE.Vector3(1, 0, 0),
      quaternion: new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 2,
      ),
    }

    // the mesh may only use a small sub-rectangle of an atlas: normalise its UVs
    const uvAttr = screenMesh.geometry.getAttribute('uv')
    const uvb = { u0: 0, v0: 0, u1: 1, v1: 1 }
    if (uvAttr) {
      uvb.u0 = 9
      uvb.u1 = -9
      uvb.v0 = 9
      uvb.v1 = -9
      for (let i = 0; i < uvAttr.count; i++) {
        uvb.u0 = Math.min(uvb.u0, uvAttr.getX(i))
        uvb.u1 = Math.max(uvb.u1, uvAttr.getX(i))
        uvb.v0 = Math.min(uvb.v0, uvAttr.getY(i))
        uvb.v1 = Math.max(uvb.v1, uvAttr.getY(i))
      }
    }
    this.uvBox = [uvb.u0, uvb.v0, uvb.u1 - uvb.u0, uvb.v1 - uvb.v0]

    const mat = createCrtMaterial(this.crt.texture, {
      previousTexture: this.crt.previousTexture,
      width: this.site.screen.width,
      height: this.site.screen.height,
      contentRect: this.site.screen.contentRect,
      uvBox: this.uvBox,
      cornerRadius: this.site.screen.cornerRadius,
      windowDirection: this.stage.windowDirection,
    })
    screenMesh.material = mat
    screenMesh.castShadow = false
    this.crtMaterial = mat
    this.screenMesh = screenMesh
    this.stage.screenGlow.setScreen(this.screen)
    this.targets.push({ id: 'screen', object: screenMesh, kind: 'screen' })
    this.computerMeshes = (this.site.parts.computerMeshes || [])
      .map((name) => root.getObjectByName(name))
      .filter(mesh => mesh?.visible)
    if (this.refinedBezel) this.computerMeshes.push(this.refinedBezel)
    this.refinedHousing?.traverse(mesh => {
      if (mesh.isMesh) this.computerMeshes.push(mesh)
    })
    for (const mesh of this.computerMeshes)
      this.targets.push({ id: 'computer', object: mesh, kind: 'computer' })

    const switchMesh = root.getObjectByName(this.site.parts.powerMesh)
    if (switchMesh) {
      if (this.refinedHousing) {
        const housingMaterial = root.getObjectByName(this.site.parts.displayBezelMesh).material
        this.powerButtonCollar = refinePowerButton(switchMesh, housingMaterial)
        this.group.add(this.powerButtonCollar)
      }
      const bounds = new THREE.Box3().setFromObject(switchMesh)
      const position = bounds.getCenter(new THREE.Vector3())
      // Expand the tiny control's hit area without covering the surrounding case.
      this.powerMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.028, 0.027),
        new THREE.MeshBasicMaterial({ visible: false }),
      )
      this.powerMesh.position.copy(position).add(new THREE.Vector3(0.012, 0, 0))
      this.group.add(this.powerMesh)
      this.powerCenter = this.powerMesh.position.clone()
      this.targets.push({ id: 'power', object: this.powerMesh, kind: 'power' })
      this.switchMesh = switchMesh
      this.switchRestPosition = switchMesh.position.clone()
      this.switchTravel = switchMesh.parent
        .worldToLocal(position.clone().add(new THREE.Vector3(-0.0012, 0, 0)))
        .sub(switchMesh.parent.worldToLocal(position.clone()))
    }
    for (const name of this.site.parts.hiddenMeshes || []) {
      const mesh = root.getObjectByName(name)
      if (mesh) mesh.visible = false
    }

    if (import.meta.env.DEV && new URLSearchParams(location.search).get('uv')) {
      console.log(
        '[uv]',
        screenMesh.name,
        'uvBox',
        this.uvBox.map((n) => n.toFixed(3)).join(' '),
        'aspect',
        (size.z / size.y).toFixed(3),
      )
    }

    if (import.meta.env.DEV) {
      const q = new URLSearchParams(location.search)
      if (q.get('probe')) {
        const rows = []
        root.traverse((o) => {
          if (!o.isMesh) return
          const b = new THREE.Box3().setFromObject(o)
          if (
            b.max.x > 0.13 &&
            b.max.y > 0.92 &&
            b.min.y < 1.2 &&
            b.min.x < 0.22
          ) {
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            const mdesc = mats
              .map(
                (m) =>
                  `${m.type}/${m.name}/transp:${m.transparent}/op:${m.opacity}/aTest:${m.alphaTest}/side:${m.side}/map:${m.map ? m.map.name || 'tex' : 'none'}`,
              )
              .join('+')
            rows.push(
              `${o.name}|${mdesc}|x ${b.min.x.toFixed(3)}..${b.max.x.toFixed(3)}` +
                ` y ${b.min.y.toFixed(3)}..${b.max.y.toFixed(3)} z ${b.min.z.toFixed(3)}..${b.max.z.toFixed(3)}` +
                ` | renderOrder:${o.renderOrder}`,
            )
          }
        })
        for (const r of rows) console.log('[probe]', r)
        if (!rows.length) console.log('[probe] none')
      }
      if (q.get('mat')) {
        root.traverse((o) => {
          if (!o.isMesh) return
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            if (!m || m.name !== q.get('mat')) continue
            console.log(
              '[mat]',
              m.type,
              m.name,
              'transmission:',
              m.transmission,
              'thickness:',
              m.thickness,
              'attenuationColor:',
              m.attenuationColor && m.attenuationColor.getHexString(),
              'attenuationDistance:',
              m.attenuationDistance,
              'roughness:',
              m.roughness,
              'metalness:',
              m.metalness,
              'emissive:',
              m.emissive && m.emissive.getHexString(),
              'emissiveIntensity:',
              m.emissiveIntensity,
              'ior:',
              m.ior,
              'clearcoat:',
              m.clearcoat,
              'map:',
              m.map && m.map.name,
              'mapsize:',
              m.map &&
                m.map.image &&
                m.map.image.width + 'x' + m.map.image.height,
              'alphaMap:',
              !!m.alphaMap,
            )
          }
        })
      }
      if (q.get('hide')) {
        for (const n of q.get('hide').split(',')) {
          const o = root.getObjectByName(n)
          if (o) o.visible = false
          console.log('[hide]', n, !!o)
        }
      }
    }

    // ------------------------------------------------------- drive slot
    const driveCfg = this.site.parts.drive
    const drivePos = driveCfg.position
      ? new THREE.Vector3(...driveCfg.position)
      : attachmentCenter.clone().add(new THREE.Vector3(...driveCfg.offset))
    const driveGeo = new THREE.BoxGeometry(
      driveCfg.size[0],
      driveCfg.size[1],
      driveCfg.size[2],
    )
    const driveMesh = new THREE.Mesh(
      driveGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3355,
        transparent: true,
        opacity: 0,
        visible: false,
      }),
    )
    driveMesh.position.copy(drivePos)
    driveMesh.visible = true
    driveMesh.name = '__drive'
    this.group.add(driveMesh)
    this.drive = {
      mesh: driveMesh,
      center: drivePos,
      size: new THREE.Vector3(...driveCfg.size),
    }
    this.targets.push({ id: 'drive', object: driveMesh, kind: 'drive' })

    // --------------------------------------------------------- keyboard
    this.keyboardMeshes = this.site.parts.keyboardMeshes
      .map((n) => root.getObjectByName(n))
      .filter(Boolean)
    for (const m of this.keyboardMeshes) {
      this.targets.push({ id: 'keyboard', object: m, kind: 'keyboard' })
    }
    if (this.keyboardMeshes.length) {
      const kb = new THREE.Box3()
        .setFromObject(this.keyboardMeshes[0])
        .getCenter(new THREE.Vector3())
      this.anchors.keyboard = kb
    }

    // ---------------------------------------------------------- anchors
    this.anchors.screen = center.clone()
    this.anchors.monitor = center
      .clone()
      .add(new THREE.Vector3(-0.08, -0.05, 0))
    this.anchors.desk = new THREE.Vector3(0.15, 0.74, 0)
    this.anchors.scene = new THREE.Box3()
      .setFromObject(root)
      .getCenter(new THREE.Vector3())

    this.stage.scene.add(this.group)

    // the light that the glass throws into the room
    this.stage.screenLight.position
      .copy(center)
      .add(new THREE.Vector3(0.14, 0, 0))

    return this
  }

  _findScreenFallback(root) {
    // if the model is replaced: take the largest flat plate facing +X high on the desk
    let best = null
    let bestScore = 0
    root.traverse((o) => {
      if (!o.isMesh) return
      const b = new THREE.Box3().setFromObject(o)
      const s = b.getSize(new THREE.Vector3())
      const c = b.getCenter(new THREE.Vector3())
      if (c.y < 0.6) return
      if (s.x > 0.2) return
      const score = s.y * s.z
      if (score > bestScore) {
        bestScore = score
        best = o
      }
    })
    return best
  }

  /** map a UV hit on the glass to 0..1 coordinates inside the raster */
  uvToScreen(uv) {
    const r = this.site.screen.contentRect
    const [u0, v0, uw, vh] = this.uvBox
    const cX = (uv.x - u0) / uw
    const cY = (uv.y - v0) / vh
    const x = (cX - r[0]) / r[2]
    const y = (cY - r[1]) / r[3]
    const cx = x * 2 - 1
    const cy = y * 2 - 1
    const curve =
      (cx * cx + cy * cy) * 0.055 * this.crtMaterial.uniforms.uCurve.value
    const nx = x + cx * curve
    const ny = 1 - (y + cy * curve)
    const aspect = this.site.screen.width / this.site.screen.height
    const radius = this.site.screen.cornerRadius ?? 0.065
    const edgeX = Math.max(Math.abs(nx - 0.5) * aspect - aspect / 2 + radius, 0)
    const edgeY = Math.max(Math.abs(ny - 0.5) - 0.5 + radius, 0)
    if (Math.hypot(edgeX, edgeY) > radius) return null
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
    return { nx, ny }
  }

  /** Map a drawn control back onto the curved GLB surface for keyboard access. */
  screenPoint(nx, ny) {
    const curve = 0.055 * this.crtMaterial.uniforms.uCurve.value
    let x = nx
    let y = 1 - ny
    for (let iteration = 0; iteration < 6; iteration++) {
      const cx = x * 2 - 1
      const cy = y * 2 - 1
      const warp = (cx * cx + cy * cy) * curve
      x = nx - cx * warp
      y = 1 - ny - cy * warp
    }
    const rect = this.site.screen.contentRect
    const box = this.uvBox
    const u = box[0] + (rect[0] + x * rect[2]) * box[2]
    const v = box[1] + (rect[1] + y * rect[3]) * box[3]
    const geometry = this.screenMesh.geometry
    const uv = geometry.attributes.uv
    const positions = geometry.attributes.position
    const count = geometry.index?.count || positions.count
    const segments = geometry.userData.screenGridSegments
    const candidates = []
    if (segments) {
      const column = Math.floor(((u - box[0]) / box[2]) * segments)
      const row = Math.floor(((v - box[1]) / box[3]) * segments)
      for (
        let y = Math.max(0, row - 1);
        y <= Math.min(segments - 1, row + 1);
        y++
      ) {
        for (
          let x = Math.max(0, column - 1);
          x <= Math.min(segments - 1, column + 1);
          x++
        ) {
          const start = (y * segments + x) * 6
          candidates.push(start, start + 3)
        }
      }
    } else {
      for (let i = 0; i < count; i += 3) candidates.push(i)
    }
    for (const i of candidates) {
      const ids = [0, 1, 2].map((offset) =>
        geometry.index ? geometry.index.getX(i + offset) : i + offset,
      )
      const [a, b, c] = ids.map((id) => ({ u: uv.getX(id), v: uv.getY(id) }))
      const determinant = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v)
      if (Math.abs(determinant) < 1e-9) continue
      const wa =
        ((b.v - c.v) * (u - c.u) + (c.u - b.u) * (v - c.v)) / determinant
      const wb =
        ((c.v - a.v) * (u - c.u) + (a.u - c.u) * (v - c.v)) / determinant
      const weights = [wa, wb, 1 - wa - wb]
      if (Math.min(...weights) < -1e-5) continue
      const point = new THREE.Vector3()
      for (let vertex = 0; vertex < 3; vertex++) {
        point.addScaledVector(
          new THREE.Vector3().fromBufferAttribute(positions, ids[vertex]),
          weights[vertex],
        )
      }
      return this.screenMesh.localToWorld(point)
    }
    return this.screen.center.clone()
  }

  /** per-frame: CRT brightness flows into the room */
  update() {
    const mat = this.crtMaterial
    if (!mat) return
    const level = this.crt.powerLevel
    const reduced = this.crt.reduceMotion
    mat.uniforms.uTransition.value = this.crt.transitionProgress
    mat.uniforms.uContent.value = this.crt.contentVisibility
    mat.uniforms.uMotion.value = reduced ? 0 : 1
    mat.uniforms.uVideo.value =
      this.crt.page === 'reel' &&
      this.crt.video?.readyState >= 2 &&
      !this.crt.mediaError
        ? 1
        : 0
    mat.uniforms.uPower.value = reduced ? level : Math.min(1, level * 8)
    const width = THREE.MathUtils.smoothstep(level, 0.02, 0.35)
    const height = THREE.MathUtils.smoothstep(level, 0.35, 1)
    mat.uniforms.uRaster.value.set(
      reduced ? 1 : Math.max(0.004, width),
      reduced ? 1 : Math.max(0.002, height),
    )
    mat.uniforms.uBeam.value = reduced
      ? 0
      : Math.sin(Math.min(1, level / 0.6) * Math.PI) * 1.2
    if (this.switchMesh)
      this.switchMesh.position
        .copy(this.switchRestPosition)
        .addScaledVector(this.switchTravel, this.crt.powered ? 1 : 0)
    const b = this.crt.brightness || 0
    this.stage.screenLight.intensity =
      b * 0.045 * mat.uniforms.uPower.value * width * height
    this.stage.screenLight.color.setRGB(0.8 + b * 0.12, 0.95, 1)
    // the flash of a tube waking up decays on its own
    mat.uniforms.uFlash.value *= 0.88
  }

  setUniformTime(t) {
    if (this.crtMaterial) this.crtMaterial.uniforms.uTime.value = t
  }

  flash(v) {
    if (this.crtMaterial) this.crtMaterial.uniforms.uFlash.value = v
  }
}
