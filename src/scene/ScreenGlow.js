import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** Optical bloom from the visible phosphor only, leaving the scene image sharp. */
export class ScreenGlow {
  constructor(depthTexture) {
    this.enabled = true
    this.strength = 0.42
    this.resolution = new THREE.Vector2(1, 1)
    this.projectedCenter = new THREE.Vector3()
    this.projectedTop = new THREE.Vector3()
    this.clearColor = new THREE.Color()
    this.scene = new THREE.Scene()
    this.targets = Array.from({ length: 4 }, (_, index) => {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        depthBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      })
      target.texture.name = `ScreenGlow-${index}`
      return target
    })
    this.depthTexture = depthTexture
    this.blurMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uMap: { value: null },
        uStep: { value: new THREE.Vector2() },
      },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec2 uStep;
        varying vec2 vUv;
        void main() {
          vec3 color = texture2D(uMap, vUv).rgb * 0.227027;
          color += texture2D(uMap, vUv + uStep * 1.384615).rgb * 0.316216;
          color += texture2D(uMap, vUv - uStep * 1.384615).rgb * 0.316216;
          color += texture2D(uMap, vUv + uStep * 3.230769).rgb * 0.070270;
          color += texture2D(uMap, vUv - uStep * 3.230769).rgb * 0.070270;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    })
    this.compositeMaterial = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uTight: { value: this.targets[2].texture },
        uHalo: { value: this.targets[3].texture },
        uSource: { value: this.targets[0].texture },
        uStrength: { value: this.strength },
      },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTight, uHalo, uSource;
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          vec3 glow = texture2D(uTight, vUv).rgb * 0.65;
          glow += texture2D(uHalo, vUv).rgb * 0.35;
          gl_FragColor = vec4(glow, 1.0);
          #include <colorspace_fragment>
          // Keep the inner picture crisp while allowing the halo over the bezel.
          float picture = texture2D(uSource, vUv).a;
          gl_FragColor.rgb *= uStrength * mix(1.0, 0.23, picture);
        }
      `,
    })
    this.quad = new FullScreenQuad(this.blurMaterial)
  }

  setScreen(screen) {
    this.emissionMesh?.removeFromParent()
    this.emissionMaterial?.dispose()
    this.screen = screen
    const material = screen.mesh.material
    this.emissionMaterial = material.clone()
    // Share the live video, page transition and power uniforms with the CRT.
    this.emissionMaterial.uniforms = {
      ...material.uniforms,
      uBloomOnly: { value: 1 },
      uSceneDepth: { value: this.depthTexture },
      uBloomResolution: { value: this.resolution },
    }
    this.emissionMaterial.toneMapped = false
    this.emissionMesh = new THREE.Mesh(screen.mesh.geometry, this.emissionMaterial)
    this.emissionMesh.matrixAutoUpdate = false
    this.scene.add(this.emissionMesh)
  }

  resize(width, height) {
    // Match the existing scene-depth pixels exactly to preserve occlusion.
    this.resolution.set(width, height)
    for (const target of this.targets) target.setSize(width, height)
  }

  get visible() {
    return this.enabled && this.screen?.mesh.visible && (
      this.emissionMaterial.uniforms.uPower.value > 0.001 ||
      this.emissionMaterial.uniforms.uFlash.value > 0.001
    )
  }

  render(renderer, camera) {
    if (!this.visible) return
    const target = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    const shadowEnabled = renderer.shadowMap.enabled
    renderer.getClearColor(this.clearColor)
    const clearAlpha = renderer.getClearAlpha()
    this.emissionMesh.matrix.copy(this.screen.mesh.matrixWorld)
    this.projectedCenter.copy(this.screen.center).project(camera)
    this.projectedTop.copy(this.screen.center)
      .addScaledVector(THREE.Object3D.DEFAULT_UP, this.screen.height / 2)
      .project(camera)
    const height = this.projectedTop.distanceTo(this.projectedCenter) * this.resolution.y
    // Scale softness with the projected tube, including portrait focus views.
    const tight = THREE.MathUtils.clamp(height * 0.009, 0.7, 7)
    const wide = THREE.MathUtils.clamp(height * 0.038, 1.5, 24)
    const [source, temporary, phosphor, halo] = this.targets
    try {
      renderer.shadowMap.enabled = false
      renderer.autoClear = true
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(source)
      renderer.render(this.scene, camera)
      this.quad.material = this.blurMaterial
      this._blur(renderer, source, temporary, tight, 0)
      this._blur(renderer, temporary, phosphor, 0, tight)
      this._blur(renderer, phosphor, temporary, wide, 0)
      this._blur(renderer, temporary, halo, 0, wide)
      renderer.setRenderTarget(target)
      renderer.autoClear = false
      this.compositeMaterial.uniforms.uStrength.value = this.strength
      this.quad.material = this.compositeMaterial
      this.quad.render(renderer)
    } finally {
      renderer.setRenderTarget(target)
      renderer.setClearColor(this.clearColor, clearAlpha)
      renderer.autoClear = autoClear
      renderer.shadowMap.enabled = shadowEnabled
    }
  }

  _blur(renderer, source, target, x, y) {
    this.blurMaterial.uniforms.uMap.value = source.texture
    this.blurMaterial.uniforms.uStep.value.set(x / this.resolution.x, y / this.resolution.y)
    renderer.setRenderTarget(target)
    this.quad.render(renderer)
  }

  dispose() {
    // The screen owns the proxy's shared geometry and signal textures.
    this.emissionMaterial?.dispose()
    this.blurMaterial.dispose()
    this.compositeMaterial.dispose()
    for (const target of this.targets) target.dispose()
    this.quad.dispose()
    this.scene.clear()
  }
}
