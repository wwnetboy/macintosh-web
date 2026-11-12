import * as THREE from 'three'
import { buildJewelCase, createCaseMaterials, CASE_BASE_THICKNESS, DISC_REST_Y } from './JewelCase.js'

const R = 0.057
const STACK_STEP = 0.017
const BASE_THICKNESS = CASE_BASE_THICKNESS
const ease = (t) => {
  const k = THREE.MathUtils.clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}

class Disk {
  constructor(data, index, { home, slot, staging, radius, groundY, materials }) {
    this.data = data
    this.index = index
    this.home = home
    this.slot = slot
    this.staging = staging
    this.radius = radius
    this.materials = materials
    this.group = new THREE.Group()
    this.group.userData.disk = this
    this.state = 'idle'
    this.phase = 'closed'
    this.t = 0
    this.case = new THREE.Group()
    this.case.position.copy(home.position)
    this.case.quaternion.copy(home.quaternion)
    this.group.add(this.case)
    this._build()
    this.discHome = new THREE.Vector3(0, DISC_REST_Y, 0)
      .applyQuaternion(home.quaternion)
      .add(home.position)
    const extraction = new THREE.Vector3(0.18, 0, -0.075)
    this.extractedPosition = home.position.clone().add(extraction)
    this.openPosition = this.extractedPosition.clone().setY(groundY)
    this.openDiscHome = this.openPosition.clone().add(new THREE.Vector3(0, DISC_REST_Y, 0))
    this.lift = this.openDiscHome.clone().add(new THREE.Vector3(0, 0.16, 0))
    this.approach = staging.clone().add(new THREE.Vector3(0.025, 0.09, 0))
    this.disc.position.copy(this.discHome)
    this.disc.quaternion.copy(home.quaternion)
    this.slotQuaternion = new THREE.Quaternion()
  }

  _build() {
    buildJewelCase(this, this.materials)
  }

  setHover(on) {
    this.hovered = on
    this.bodyMat.emissiveIntensity = on ? 0.18 : 0
  }

  insert(onDone) {
    if (this.state !== 'idle') return
    this.setHover(false)
    this.state = 'insert'
    this.t = 0
    this._done = onDone
  }

  eject(onDone) {
    if (this.state !== 'inside') return
    this.state = 'eject'
    this.t = 0
    this.disc.visible = true
    this._done = onDone
  }

  _pose(progress) {
    const p = THREE.MathUtils.clamp(progress, 0, 1)
    // Slide out, lower onto the tabletop, then open. Ejection reverses the path.
    this.case.position.lerpVectors(this.home.position, this.extractedPosition, ease(p / 0.1))
    this.case.position.y = THREE.MathUtils.lerp(
      this.home.position.y,
      this.openPosition.y,
      ease((p - 0.1) / 0.08),
    )
    this.lid.rotation.z = ease((p - 0.18) / 0.12) * 2.1
    if (p < 0.3) {
      this.phase = p < 0.18 ? 'extracting' : 'opening'
      this.disc.position.copy(this.discHome).add(this.case.position).sub(this.home.position)
      this.disc.quaternion.copy(this.home.quaternion)
    } else if (p < 0.48) {
      this.phase = 'lifting'
      const k = ease((p - 0.3) / 0.18)
      this.disc.position.lerpVectors(this.openDiscHome, this.lift, k)
      this.disc.quaternion.copy(this.home.quaternion)
    } else if (p < 0.73) {
      this.phase = 'aligning'
      const k = ease((p - 0.48) / 0.25)
      this.disc.position.lerpVectors(this.lift, this.approach, k)
      this.disc.quaternion
        .copy(this.home.quaternion)
        .slerp(this.slotQuaternion, k)
    } else if (p < 0.84) {
      this.phase = 'aligning'
      this.disc.position.lerpVectors(
        this.approach,
        this.staging,
        ease((p - 0.73) / 0.11),
      )
      this.disc.quaternion.copy(this.slotQuaternion)
    } else {
      this.phase = 'sliding'
      this.disc.position.lerpVectors(
        this.staging,
        this.slot,
        ease((p - 0.84) / 0.16),
      )
      this.disc.quaternion.copy(this.slotQuaternion)
    }
  }

  update(dt) {
    if (this.state === 'idle' || this.state === 'inside') return
    this.t = Math.min(1, this.t + dt / 3.6)
    const inserting = this.state === 'insert'
    this._pose(inserting ? this.t : 1 - this.t)
    if (this.t < 1) return
    this.state = inserting ? 'inside' : 'idle'
    this.phase = inserting ? 'inside' : 'closed'
    this.disc.visible = !inserting
    const complete = this._done
    this._done = null
    complete?.()
  }
}

export class Disks {
  constructor(site, mac, { reduceMotion = false } = {}) {
    this.site = site
    this.mac = mac
    this.group = new THREE.Group()
    this.list = []
    this.current = null
    this.onPlay = null
    this.onSound = null
    this.onChange = null
    this.requested = null
    this.busy = false
    this.reduceMotion = reduceMotion

    const slot = mac.drive.center.clone()
    const normal = new THREE.Vector3(1, 0, 0)
    // Leave clearance at both slot edges and align the whole disc outside the
    // housing before sliding in. The endpoint places its trailing edge inside.
    const radius = Math.min(R, mac.drive.size.z / 2 - 0.003)
    const staging = slot.clone().addScaledVector(normal, radius + 0.045)
    const inserted = slot.clone().addScaledVector(normal, -radius - 0.012)
    const tabletop = mac.root.getObjectByName(site.parts.tabletopMesh)
    const tabletopY = tabletop
      ? new THREE.Box3().setFromObject(tabletop).max.y
      : mac.anchors.desk.y
    const groundY = tabletopY + BASE_THICKNESS / 2

    const materials = createCaseMaterials(Math.min(8, mac.stage.renderer.capabilities.getMaxAnisotropy()))
    site.disks.forEach((data, i) => {
      // Stack on the clear tabletop to the right of the pencil cup.
      const level = site.disks.length - 1 - i
      const home = {
        position: new THREE.Vector3(
          -0.06 + (i % 2) * 0.003,
          groundY + level * STACK_STEP,
          -0.55 + (i % 2) * 0.003,
        ),
        quaternion: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, (i % 2 ? -1 : 1) * 0.035, 0),
        ),
      }
      const disk = new Disk(data, i, {
        home,
        slot: inserted.clone(),
        staging: staging.clone(),
        radius,
        groundY,
        materials,
      })
      this.group.add(disk.group)
      this.list.push(disk)
    })

    this.ready = Promise.all(this.list.map(disk => disk.coverReady))
    mac.stage.scene.add(this.group)
  }

  dispose() {
    const geometries = new Set()
    const materials = new Set()
    const textures = new Set()
    this.group.traverse(object => {
      if (object.isInstancedMesh) object.dispose()
      if (object.geometry) geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue
        materials.add(material)
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
      }
    })
    textures.forEach(texture => texture.dispose())
    materials.forEach(material => material.dispose())
    geometries.forEach(geometry => geometry.dispose())
    this.group.removeFromParent()
  }

  get pickables() {
    return this.list.map((disk) => disk.group)
  }

  diskOf(object) {
    let o = object
    while (o) {
      if (o.userData && o.userData.disk) return o.userData.disk
      o = o.parent
    }
    return null
  }

  pick(disk) {
    if (!this.list.includes(disk)) return
    this.requested = disk
    this._advance()
  }

  eject() {
    this.requested = null
    this._advance()
  }

  // One drive owns one operation. A quick sequence of clicks keeps the latest
  // requested disk and finishes the current physical movement before swapping.
  _advance() {
    this.onChange?.(this.requested, this.busy)
    if (this.busy || this.current === this.requested) return
    this.busy = true
    this.onChange?.(this.requested, true)
    if (this.current) {
      this.onSound?.('eject')
      this.current.eject(() => {
        this.current = null
        this.busy = false
        this._advance()
      })
      return
    }
    const disk = this.requested
    this.current = disk
    this.onSound?.('insert')
    disk.insert(() => {
      this.busy = false
      if (this.requested === disk) this.onPlay?.(disk.data)
      this._advance()
    })
  }

  setHover(disk) {
    for (const d of this.list) d.setHover(d === disk)
  }

  update(dt) {
    for (const d of this.list) {
      if (this.reduceMotion && d.state === 'idle') continue
      d.update(this.reduceMotion ? 4 : dt)
    }
    const active = this.current
    const progress = active ? (active.state === 'eject' ? 1 - active.t : active.t) : 0
    const drop = STACK_STEP * ease((progress - 0.1) / 0.08)
    for (const disk of this.list) {
      if (disk.state !== 'idle') continue
      // Close the gap after extraction and restore it before the case returns.
      const offset = active && disk.index < active.index ? drop : 0
      disk.case.position.y = disk.home.position.y - offset
      disk.disc.position.y = disk.discHome.y - offset
    }
  }
}
