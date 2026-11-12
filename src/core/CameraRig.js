import * as THREE from 'three'
import { compactLayout } from './viewport.js'

const DEG = Math.PI / 180

/**
 * CameraRig — turns "azimuth / elevation / distance" presets into a camera,
 * and glides between them with frame-rate independent damping.
 *
 * The whole site is driven by this: every section declares a preset, scrolling
 * blends from one to the next.
 */
export class CameraRig {
  constructor(camera, presets, { reduceMotion = false } = {}) {
    this.camera = camera
    this.reduceMotion = reduceMotion
    this.mobilePresets = new Map()
    this.presets = new Map()
    for (const [name, p] of Object.entries(presets)) {
      this.presets.set(name, {
        target: new THREE.Vector3(...p.target),
        dist: p.dist,
        az: p.az * DEG,
        el: p.el * DEG,
        fov: p.fov ?? 38,
      })
      const mobile = { ...p, ...p.mobile }
      this.mobilePresets.set(name, {
        target: new THREE.Vector3(...mobile.target),
        dist: mobile.dist,
        az: mobile.az * DEG,
        el: mobile.el * DEG,
        fov: mobile.fov ?? 38,
      })
    }

    this.state = { target: new THREE.Vector3(), dist: 3, az: 0, el: 0, fov: 38 }
    this.desired = {
      target: new THREE.Vector3(),
      dist: 3,
      az: 0,
      el: 0,
      fov: 38,
    }
    this.pointer = { x: 0, y: 0 }
    this.pointerSmooth = { x: 0, y: 0 }
    this.orbit = { az: 0, el: 0 }
    this.dragging = false
    // horizontal framing shift (-1..1 of half the view width). Negative pushes
    // the machine to the right of the screen, leaving room for the text column.
    this.framingTarget = 0
    this.framingSmooth = 0
    this.overflow = 1
    this.lock = null
    this.locked = false

    this._tmp = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._aim = new THREE.Vector3()
  }

  /** point the rig at a preset instantly (used before the first frame) */
  snap(name) {
    const p = this.getPreset(name)
    if (!p) return
    Object.assign(this.state, { dist: p.dist, az: p.az, el: p.el, fov: p.fov })
    this.state.target.copy(p.target)
    this._apply(0)
  }

  /** blend between two presets (t in 0..1) */
  setBlend(nameA, nameB, t) {
    const a = this.getPreset(nameA)
    const b = this.getPreset(nameB) || a
    if (!a) return
    const k = t * t * (3 - 2 * t) // smoothstep so presets do not feel mechanical
    this.desired.target.lerpVectors(a.target, b.target, k)
    this.desired.dist = a.dist + (b.dist - a.dist) * k
    this.desired.az = a.az + (b.az - a.az) * k
    this.desired.el = a.el + (b.el - a.el) * k
    this.desired.fov = a.fov + (b.fov - a.fov) * k
  }

  /** lock the camera to a preset (focus mode) */
  focus(name, instant = false) {
    this.lockName = name
    this.lock = this.getPreset(name) || null
    this.resetOrbit(this.lock?.az)
    if (instant && this.lock) {
      Object.assign(this.state, {
        dist: this.lock.dist,
        az: this.lock.az,
        el: this.lock.el,
        fov: this.lock.fov,
      })
      this.state.target.copy(this.lock.target)
    }
  }

  unfocus() {
    this.lock = null
    this.lockName = null
    this.resetOrbit()
  }

  getPreset(name) {
    const preset = (compactLayout.matches ? this.mobilePresets : this.presets).get(
      name,
    )
    if (!preset || (name !== 'screen' && name !== 'computer')) return preset
    const minimumAspect = name === 'computer' ? 0.74 : 0.9
    // Fit the selected subject within a portrait viewport.
    return {
      ...preset,
      dist: preset.dist * Math.max(1, minimumAspect / this.camera.aspect),
    }
  }

  get focused() {
    return !!this.lock
  }

  get targetView() {
    return this.lockName ? this.getPreset(this.lockName) : this.desired
  }

  /** Viewport-normalized pointer position for the chapter's camera parallax. */
  setPointer(x, y) {
    this.pointer.x = THREE.MathUtils.clamp(x, -1, 1)
    this.pointer.y = THREE.MathUtils.clamp(y, -1, 1)
  }

  beginOrbit() {
    const target = this.targetView
    this.orbit.az = this.state.az - target.az
    this.orbit.el = this.state.el - target.el
    this.setPointer(0, 0)
    this.pointerSmooth.x = this.pointerSmooth.y = 0
    this.dragging = true
  }

  rotate(deltaX, deltaY) {
    const target = this.targetView
    this.orbit.az -= deltaX * Math.PI
    this.orbit.el =
      THREE.MathUtils.clamp(
        target.el + this.orbit.el + deltaY * Math.PI * 0.5,
        0,
        45 * DEG,
      ) - target.el
  }

  endOrbit() {
    this.dragging = false
  }

  resetOrbit(az = this.targetView.az) {
    if (!this.orbit.az && !this.orbit.el && !this.dragging) return
    this.orbit.az = this.orbit.el = 0
    this.dragging = false
    // Return by the shortest arc even after several full turns.
    this.state.az =
      az +
      THREE.MathUtils.euclideanModulo(
        this.state.az - az + Math.PI,
        Math.PI * 2,
      ) -
      Math.PI
  }

  update(dt, elapsed) {
    // Smooth pointer input separately from the authored scroll-camera path.
    const d = Math.min(dt, 0.1)
    const lerp = this.reduceMotion
      ? 1
      : 1 - Math.exp(-(this.dragging ? 14 : 5) * d)
    const pointerDamping = this.reduceMotion ? 1 : 1 - Math.exp(-8 * d)
    this.pointerSmooth.x +=
      (this.pointer.x - this.pointerSmooth.x) * pointerDamping
    this.pointerSmooth.y +=
      (this.pointer.y - this.pointerSmooth.y) * pointerDamping

    const desired = this.targetView

    let az = desired.az + this.orbit.az
    let el = desired.el + this.orbit.el
    if (!this.lock && !this.reduceMotion) {
      // Orbit the camera opposite to the pointer so the subject turns toward it.
      az -= this.pointerSmooth.x * 6 * DEG
      el += this.pointerSmooth.y * 3.5 * DEG
    }
    el = THREE.MathUtils.clamp(el, 0, 45 * DEG)

    this.state.target.lerp(desired.target, lerp)
    this.state.dist += (desired.dist - this.state.dist) * lerp
    this.state.az += (az - this.state.az) * lerp
    this.state.el += (el - this.state.el) * lerp
    this.state.fov += (desired.fov - this.state.fov) * lerp
    this.framingSmooth += (this.framingTarget - this.framingSmooth) * lerp

    this._apply(dt)
  }

  _apply() {
    const s = this.state
    const aspect = this.camera.aspect || 1
    const distance = s.dist
    const target = s.target
    const ce = Math.cos(s.el)
    this._tmp.set(
      target.x + distance * ce * Math.sin(s.az),
      target.y + distance * Math.sin(s.el),
      target.z + distance * ce * Math.cos(s.az),
    )
    // keep the camera above the rug
    this._tmp.y = Math.max(this._tmp.y, 0.045)
    this.camera.position.copy(this._tmp)
    this.camera.lookAt(target)

    if (Math.abs(this.framingSmooth) > 1e-4) {
      // rotate the camera a little without moving it, so the subject slides
      // sideways in frame (Apple-product-page style composition)
      this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
      const halfW = distance * Math.tan(s.fov * DEG * 0.5) * aspect
      this._aim
        .copy(target)
        .addScaledVector(this._right, this.framingSmooth * halfW)
      this.camera.lookAt(this._aim)
    }

    if (Math.abs(this.camera.fov - s.fov) > 0.02) {
      this.camera.fov = s.fov
      this.camera.updateProjectionMatrix()
    }
  }
}
