import * as THREE from 'three'
import { atmosphereFragment, atmosphereComposite } from './atmosphereShader.js'

/**
 * SideRays shader and pointer spring adapted from David Haz's React Bits.
 * https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/SideRays
 * MIT + Commons Clause; see public/react-bits-siderays-notice.txt.
 * Angular noise and pointer tracking now drive depth/shadow-aware air scattering.
 */
const TAU = Math.PI * 2;

const ORIGINS = {
  'top-right': { flipX: 0, flipY: 0, side: 0 },
  'top-left': { flipX: 1, flipY: 0, side: 0 },
  'bottom-right': { flipX: 0, flipY: 1, side: 0 },
  'bottom-left': { flipX: 1, flipY: 1, side: 0 },
  right: { flipX: 0, flipY: 0, side: 1 },
  left: { flipX: 1, flipY: 0, side: 1 }
};

const VERTEX = `const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const wrapAngle = angle => ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

const parseColor = value => {
  const text = String(value || '').trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].replace(/./g, digit => digit + digit) : hex[1];
    return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16) / 255);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map(channel => clamp(parseFloat(channel) / 255, 0, 1));
  return [1, 1, 1];
};

const geometryFor = (frame, aspect) => ({
  source: frame.side ? [aspect * 0.5 + 0.42, 0.3] : [aspect * 0.5 + 0.1, 0.62],
  heading: frame.side ? 3.42 : -2.48
});



export class SideRays {
  constructor(canvas, {
    rayColor1 = '#FFC46B',
    rayColor2 = '#96c8ff',
    origin = 'top-right',
    speed = 2.5,
    intensity = 2,
    spread = 2,
    density = 5,
    followMouse = true,
    edgeColorStrength = 0.12,
    reduceMotion = false,
  } = {}) {
    this.canvas = canvas
    // Retain the copied parameter scaling; atmospheric movement is restrained.
    this.settings = {
      frame: ORIGINS[origin] ?? ORIGINS['top-right'],
      speed: Math.max(0, speed) * 0.4,
      spread: clamp(spread, 0.1, 8) * 0.225,
      followMouse,
      mouseInfluence: 0.14,
      motionScale: 0.6,
    }
    this.pointer = { x: 0, y: 0, inside: false }
    this.aim = { value: 0, velocity: 0 }
    this.focus = { angle: 0, strength: 0 }
    this.time = 0
    this.reveal = reduceMotion ? 1 : 0
    this.visibility = 1
    this.size = new THREE.Vector2(1, 1)
    this.rayTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    })
    this.rayTarget.texture.name = 'AtmosphereScattering'
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: { STEPS: matchMedia('(max-width: 900px), (pointer: coarse)').matches ? 10 : 18 },
      vertexShader: VERTEX,
      fragmentShader: atmosphereFragment,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uRayResolution: { value: new THREE.Vector2(1, 1) },
        uSceneDepth: { value: null },
        uShadowMap: { value: null },
        uProjectionInverse: { value: new THREE.Matrix4() },
        uViewToWorld: { value: new THREE.Matrix4() },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uCameraPosition: { value: new THREE.Vector3() },
        uVolumeCenter: { value: new THREE.Vector3() },
        uLightTarget: { value: new THREE.Vector3() },
        uLightDirection: { value: new THREE.Vector3() },
        uLightRight: { value: new THREE.Vector3() },
        uUseShadow: { value: 0 },
        uTime: { value: 0 },
        uColorA: { value: new THREE.Vector3(...parseColor(rayColor1)) },
        uColorB: { value: new THREE.Vector3(...parseColor(rayColor2)) },
        uBlend: { value: 0.6 },
        uIntensity: { value: Math.max(0, intensity) * 0.75 },
        uSpread: { value: this.settings.spread },
        uDensity: { value: clamp(density, 1, 40) },
        uSharpness: { value: 0.5 },
        uFalloff: { value: 1.6 },
        uGlow: { value: 1.2 },
        uSaturation: { value: 0.18 },
        uEdgeColorStrength: { value: clamp(edgeColorStrength, 0, 1) },
        uOpacity: { value: 1 },
        uReveal: { value: this.reveal },
        uFrame: { value: new THREE.Vector3(
          this.settings.frame.flipX,
          this.settings.frame.flipY,
          this.settings.frame.side,
        ) },
        uAim: { value: 0 },
        uFocus: { value: new THREE.Vector3(0, Math.max(0.06, this.settings.spread * 0.25), 0) },
        uSway: { value: reduceMotion ? 0 : 1 },
      },
    })
    // Three.js needs a vertex count; the upstream vertex shader uses gl_VertexID.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ], 3))
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'SideRays'
    this.mesh.frustumCulled = false
    this.scene = new THREE.Scene()
    this.scene.add(this.mesh)
    this.camera = new THREE.Camera()
    this.compositeMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: atmosphereComposite,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uRays: { value: this.rayTarget.texture },
        uResolution: this.material.uniforms.uResolution,
        uRayResolution: this.material.uniforms.uRayResolution,
        uSceneDepth: this.material.uniforms.uSceneDepth,
      },
    })
    this.compositeScene = new THREE.Scene()
    const compositeMesh = new THREE.Mesh(geometry, this.compositeMaterial)
    compositeMesh.frustumCulled = false
    this.compositeScene.add(compositeMesh)

    this.events = new AbortController()
    const options = { passive: true, signal: this.events.signal }
    const leave = () => { this.pointer.inside = false }
    window.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return
      const rect = canvas.getBoundingClientRect()
      this.pointer.x = event.clientX - rect.left
      this.pointer.y = event.clientY - rect.top
      this.pointer.inside =
        this.pointer.x >= 0 && this.pointer.x <= rect.width &&
        this.pointer.y >= 0 && this.pointer.y <= rect.height
    }, options)
    window.addEventListener('blur', leave, options)
    window.addEventListener('pointercancel', leave, options)
    document.documentElement.addEventListener('pointerleave', leave, options)
  }

  resize(width, height, drawingBufferSize) {
    this.size.set(width, height)
    this.material.uniforms.uResolution.value.copy(drawingBufferSize)
    // The soft air field needs fewer pixels than the model; cap it on large screens.
    const ratio = Math.min(0.5, Math.sqrt(650000 / (drawingBufferSize.x * drawingBufferSize.y)))
    const rayWidth = Math.max(1, Math.round(drawingBufferSize.x * ratio))
    const rayHeight = Math.max(1, Math.round(drawingBufferSize.y * ratio))
    this.rayTarget.setSize(rayWidth, rayHeight)
    this.material.uniforms.uRayResolution.value.set(rayWidth, rayHeight)
    const steps = matchMedia('(max-width: 900px), (pointer: coarse)').matches ? 10 : 18
    if (this.material.defines.STEPS !== steps) {
      this.material.defines.STEPS = steps
      this.material.needsUpdate = true
    }
  }

  setSceneData(camera, light, depthTexture, center) {
    this.light = light
    const uniforms = this.material.uniforms
    uniforms.uSceneDepth.value = depthTexture
    uniforms.uProjectionInverse.value = camera.projectionMatrixInverse
    uniforms.uViewToWorld.value = camera.matrixWorld
    uniforms.uCameraPosition.value = camera.position
    uniforms.uVolumeCenter.value = center
    uniforms.uLightTarget.value = light.target.position
    uniforms.uShadowMatrix.value = light.shadow.matrix
  }

  update(dt, focused, reduceMotion) {
    dt = clamp(dt, 0, 0.05)
    const s = this.settings
    const uniforms = this.material.uniforms
    if (!reduceMotion) this.time += dt * s.speed * s.motionScale
    this.reveal = reduceMotion ? 1 : Math.min(1, this.reveal + dt / 1.6)

    const tracking = s.followMouse && this.pointer.inside && !reduceMotion && !focused
    let pointed = 0
    if (tracking) {
      let x = (this.pointer.x - this.size.x / 2) / this.size.y
      let y = (this.size.y / 2 - this.pointer.y) / this.size.y
      if (s.frame.flipX) x = -x
      if (s.frame.flipY) y = -y
      const { source, heading } = geometryFor(s.frame, this.size.x / this.size.y)
      pointed = wrapAngle(Math.atan2(y - source[1], x - source[0]) - heading)
    }
    const target = tracking ? clamp(pointed, -s.spread, s.spread) * s.mouseInfluence : 0
    const focusTarget = tracking ? s.mouseInfluence : 0
    const ease = 1 - Math.exp(-dt * 6)
    if (tracking) {
      this.focus.angle += (clamp(pointed - this.aim.value, -s.spread * 1.5, s.spread * 1.5) - this.focus.angle) * ease
    }
    this.focus.strength += (focusTarget - this.focus.strength) * ease
    const stiffness = 18
    const damping = 2 * Math.sqrt(stiffness)
    this.aim.velocity += ((target - this.aim.value) * stiffness - this.aim.velocity * damping) * dt
    this.aim.value += this.aim.velocity * dt
    if (reduceMotion) {
      this.aim.value = this.aim.velocity = 0
      this.focus.strength = 0
    }

    const fade = reduceMotion ? 1 : 1 - Math.exp(-5 * dt)
    this.visibility += ((focused ? 0 : 1) - this.visibility) * fade
    this.mesh.visible = this.visibility > 0.001 && uniforms.uIntensity.value > 0
    uniforms.uTime.value = this.time
    uniforms.uOpacity.value = this.visibility
    uniforms.uReveal.value = 1 - Math.pow(1 - this.reveal, 3)
    uniforms.uAim.value = this.aim.value
    uniforms.uFocus.value.set(this.focus.angle, Math.max(0.06, s.spread * 0.25), this.focus.strength * 0.4)
    uniforms.uSway.value = reduceMotion ? 0 : 1
  }

  render(renderer) {
    if (!this.mesh.visible) return
    const autoClear = renderer.autoClear
    const target = renderer.getRenderTarget()
    const uniforms = this.material.uniforms
    uniforms.uShadowMap.value = this.light.shadow.map?.texture ?? null
    uniforms.uUseShadow.value = this.light.shadow.map ? 1 : 0
    uniforms.uLightDirection.value.subVectors(this.light.position, this.light.target.position).normalize()
    uniforms.uLightRight.value.set(0, 1, 0).cross(uniforms.uLightDirection.value).normalize()
    renderer.autoClear = false
    try {
      renderer.setRenderTarget(this.rayTarget)
      renderer.render(this.scene, this.camera)
      renderer.setRenderTarget(target)
      renderer.render(this.compositeScene, this.camera)
    } finally {
      renderer.setRenderTarget(target)
      renderer.autoClear = autoClear
    }
  }

  dispose() {
    this.events.abort()
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.compositeMaterial.dispose()
    this.rayTarget.dispose()
    this.scene.clear()
    this.compositeScene.clear()
  }
}
