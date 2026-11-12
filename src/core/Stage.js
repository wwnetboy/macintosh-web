import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { SideRays } from '../scene/SideRays.js'
import { ScreenGlow } from '../scene/ScreenGlow.js'

/**
 * Stage — renderer, scene, lights and atmosphere.
 * The 3D canvas is fixed behind the page; everything else floats above it.
 */
export class Stage {
  constructor(canvas, { reduceMotion = false } = {}) {
    this.canvas = canvas
    this.reduceMotion = reduceMotion
    this.mobile = window.matchMedia(
      '(max-width: 900px), (pointer: coarse)',
    ).matches

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x060608)
    // Fog hides the hard edge of the rug and pushes the room into darkness.
    this.scene.fog = new THREE.FogExp2(0x060608, 0.13)

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 80)
    this.camera.position.set(2.2, 1.1, 1.6)

    this._setupEnvironment()
    this._setupLights()
    this.sideRays = new SideRays(canvas, {
      rayColor1: '#FFC46B',
      rayColor2: '#96c8ff',
      origin: 'top-right',
      speed: 2.5,
      intensity: 2,
      spread: 2,
      density: 5,
      followMouse: true,
      edgeColorStrength: 0.12,
      reduceMotion,
    })
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    })
    this.depthTarget.texture.name = 'AtmosphereDepth'
    this.depthMaterial = new THREE.MeshDepthMaterial({ colorWrite: false })
    this.screenGlow = new ScreenGlow(this.depthTarget.depthTexture)
    this.sideRays.setSceneData(this.camera, this.keyLight, this.depthTarget.depthTexture, this.subjectCenter)
    this._setupDust()

    this.size = new THREE.Vector2(1, 1)
    this.resize()

    window.addEventListener('resize', () => this.resize(), { passive: true })
  }

  _setupEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      const room = new RoomEnvironment()
      const env = pmrem.fromScene(room, 0.025)
      this.scene.environment = env.texture
      this.scene.environmentIntensity = 0.24
      pmrem.dispose()
      room.dispose()
    } catch {
      /* environment is a nice-to-have, never fatal */
    }
  }

  _setupLights() {
    // soft skylight
    const hemi = new THREE.HemisphereLight(0xc8d3de, 0x30251b, 0.22)
    this.scene.add(hemi)

    // warm key light — the "window" in this room
    // Keep the window at a constant screen-right angle as the view orbits.
    // The world-space direction then changes relative to the model's normals.
    this.windowDirection = new THREE.Vector3(1, 0.56, 1.25).normalize()
    this.windowDistance = 6
    this.subjectCenter = new THREE.Vector3(0.1, 0.95, 0)
    const key = new THREE.DirectionalLight(0xffdfb1, 2.6)
    key.target.position.set(0.1, 0.95, 0)
    key.position
      .copy(key.target.position)
      .addScaledVector(this.windowDirection, this.windowDistance)
    key.castShadow = true
    key.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048)
    key.shadow.bias = -0.0002
    key.shadow.normalBias = 0.003
    const cam = key.shadow.camera
    cam.left = -2.2
    cam.right = 2.2
    cam.top = 2.2
    cam.bottom = -2.2
    cam.near = 0.1
    cam.far = 12
    this.scene.add(key, key.target)
    this.keyLight = key

    // cool rim from the left keeps the volume readable
    const rim = new THREE.DirectionalLight(0xa8bce2, 0.12)
    rim.position.set(-2.2, 1.4, -1.4)
    this.scene.add(rim)

    const fill = new THREE.DirectionalLight(0xc4d5da, 0.08)
    fill.position.set(2.0, 1.6, -2.0)
    this.scene.add(fill)

    // screen glow — its intensity follows the CRT brightness
    const glow = new THREE.PointLight(0x9ff0ea, 0, 0.9, 2)
    glow.position.set(0.42, 1.04, 0)
    this.scene.add(glow)
    this.screenLight = glow
  }

  _setupDust() {
    const count = this.mobile ? 140 : 420
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const rand = new Float32Array(count * 3)
    const point = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      point.set(
        -2 + Math.random() * 4,
        0.5 + Math.random() * 2.5,
        -2 + Math.random() * 4,
      )
      point.toArray(pos, i * 3)
      rand[i * 3] = Math.random() * Math.PI * 2
      rand[i * 3 + 1] = 0.15 + Math.random() * 0.35
      rand[i * 3 + 2] = Math.random()
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(rand, 3))

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.5 },
        uSize: { value: 0.01 },
        uSunPosition: { value: this.keyLight.position },
        uSunDirection: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uSize;
        uniform vec3 uSunPosition;
        uniform vec3 uSunDirection;
        varying float vFade;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * aSeed.y + aSeed.x) * 0.14;
          p.y += cos(uTime * aSeed.y * 0.8 + aSeed.x * 1.7) * 0.1 + sin(uTime * 0.12 + aSeed.z * 6.28) * 0.16;
          p.z += cos(uTime * aSeed.y * 0.6 + aSeed.x) * 0.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * (420.0 / -mv.z), 1.2, 3.5);
          vec3 sunPoint = p - uSunPosition;
          vec3 radial = (sunPoint - uSunDirection * dot(sunPoint, uSunDirection)) / 0.8;
          float lit = exp(-3.5 * dot(radial, radial));
          vec3 lightRight = normalize(cross(uSunDirection, vec3(0.0, 1.0, 0.0)));
          float windowX = dot(sunPoint, lightRight);
          float slits = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(windowX * 8.0 + 0.3 * sin(p.y * 2.0)), 3.0);
          lit *= slits;
          vFade = (0.35 + 0.65 * aSeed.z) * mix(0.08, 1.0, lit);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float a = smoothstep(0.5, 0.05, r);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.8), a * vFade * uOpacity);
        }
      `,
    })

    this.dust = new THREE.Points(geo, mat)
    this.dust.frustumCulled = false
    this.scene.add(this.dust)
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.mobile = window.matchMedia(
      '(max-width: 900px), (pointer: coarse)',
    ).matches
    this.scene.fog.density = this.mobile ? 0.035 : 0.075
    this.size.set(w, h)
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.mobile ? 1.25 : 1.75),
    )
    this.renderer.setSize(w, h, false)
    this.renderer.getDrawingBufferSize(this.size)
    this.sideRays.resize(w, h, this.size)
    this.depthTarget.setSize(this.sideRays.rayTarget.width, this.sideRays.rayTarget.height)
    this.screenGlow.resize(this.depthTarget.width, this.depthTarget.height)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  render(elapsed, dt, focused = false) {
    this.camera.updateMatrixWorld(true)
    const distance = this.camera.position.distanceTo(this.subjectCenter)
    const halfHeight =
      distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    this.keyLight.target.position
      .set(halfHeight * this.camera.aspect * 0.55, halfHeight * 0.05, -distance)
      .applyMatrix4(this.camera.matrixWorld)
    this.keyLight.position
      .copy(this.windowDirection)
      .applyQuaternion(this.camera.quaternion)
      .multiplyScalar(this.windowDistance)
      .add(this.keyLight.target.position)
    this.sideRays.update(dt, focused, this.reduceMotion)
    if (this.dust) {
      this.dust.visible = !this.reduceMotion
      this.dust.material.uniforms.uTime.value = elapsed
      this.dust.material.uniforms.uOpacity.value =
        0.8 * this.sideRays.visibility
      this.dust.material.uniforms.uSunDirection.value
        .subVectors(this.keyLight.target.position, this.keyLight.position)
        .normalize()
    }
    this.renderer.render(this.scene, this.camera)
    if (this.sideRays.mesh.visible || this.screenGlow.visible) this._renderAtmosphereDepth()
    this.sideRays.render(this.renderer)
    this.screenGlow.render(this.renderer, this.camera)
  }

  _renderAtmosphereDepth() {
    const override = this.scene.overrideMaterial
    const shadowEnabled = this.renderer.shadowMap.enabled
    const dustVisible = this.dust.visible
    const target = this.renderer.getRenderTarget()
    this.scene.overrideMaterial = this.depthMaterial
    this.renderer.shadowMap.enabled = false
    this.dust.visible = false
    try {
      this.renderer.setRenderTarget(this.depthTarget)
      this.renderer.render(this.scene, this.camera)
    } finally {
      this.renderer.setRenderTarget(target)
      this.scene.overrideMaterial = override
      this.renderer.shadowMap.enabled = shadowEnabled
      this.dust.visible = dustVisible
    }
  }

  disposeAtmosphere() {
    this.screenGlow.dispose()
    this.sideRays.dispose()
    this.depthTarget.dispose()
    this.depthMaterial.dispose()
  }
}
