import * as THREE from 'three'

/**
 * CRT screen material.
 *
 * The logical canvas is mapped onto the glass of the model, with barrel
 * curvature, scanlines, phosphor glow, film grain and the power-on flash.
 */
export function createCrtMaterial(texture, opts = {}) {
  const {
    previousTexture = texture,
    width = 512,
    height = 342,
    contentRect = [0.035, 0.06, 0.93, 0.88],
    uvBox = [0, 0, 1, 1],
    cornerRadius = 0.065,
    windowDirection = new THREE.Vector3(1, 0.56, 1.25).normalize(),
  } = opts

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uPreviousMap: { value: previousTexture },
      uTransition: { value: 1 },
      uContent: { value: 1 },
      uVideo: { value: 0 },
      uMotion: { value: 1 },
      uResolution: { value: new THREE.Vector2(width, height) },
      uRect: { value: new THREE.Vector4(...contentRect) },
      uBox: { value: new THREE.Vector4(...uvBox) },
      uTime: { value: 0 },
      uPower: { value: 0 },
      uRaster: { value: new THREE.Vector2(1, 1) },
      uBeam: { value: 0 },
      uFlash: { value: 0 },
      uScan: { value: 0.18 },
      uCurve: { value: 0.22 },
      uWindowDirection: { value: windowDirection.clone() },
      uReflection: { value: 0.055 },
      uRadius: { value: cornerRadius },
      uNoise: { value: 0.012 },
      uGlow: { value: 0.1 },
      uVig: { value: 0.13 },
      uBloomOnly: { value: 0 },
      uSceneDepth: { value: null },
      uBloomResolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalMatrix * normal;
        vViewPosition = -viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uMap;
      uniform sampler2D uPreviousMap;
      uniform float uTransition, uContent, uVideo, uMotion;
      uniform vec2 uResolution;
      uniform vec4 uRect;
      uniform vec4 uBox;
      uniform float uTime, uPower, uFlash, uScan, uCurve, uNoise, uGlow, uVig;
      uniform float uRadius;
      uniform vec2 uRaster;
      uniform float uBeam;
      uniform vec3 uWindowDirection;
      uniform float uReflection;
      uniform float uBloomOnly;
      uniform sampler2D uSceneDepth;
      uniform vec2 uBloomResolution;
      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;

      float hash(vec2 p) {
        p = fract(p * vec2(233.34, 851.73));
        p += dot(p, p + 23.45);
        return fract(p.x * p.y);
      }

      vec3 screenColor(vec2 uv) {
        vec3 color = vec3(0.0);
        if (uTransition >= 1.0) {
          color = texture2D(uMap, uv).rgb;
        } else {
          // A descending CRT sync band replaces the previous frame line by line.
          float row = 1.0 - uv.y;
          float sweep = mix(-0.12, 1.12, uTransition);
          float band = exp(-pow((row - sweep) / 0.045, 2.0));
          float jitter = sin(row * 310.0 + uTime * 37.0) * band * 0.009;
          vec2 sampleUv = clamp(uv + vec2(jitter, 0.0), 0.0, 1.0);
          vec3 previous = texture2D(uPreviousMap, sampleUv).rgb;
          vec3 current = texture2D(uMap, sampleUv).rgb;
          float reveal = 1.0 - smoothstep(sweep - 0.012, sweep + 0.012, row);
          color = mix(previous, current, reveal);
          float staticNoise = hash(vec2(floor(uv.x * uResolution.x), floor(row * uResolution.y)));
          color = color * (1.0 - band * 0.5) + staticNoise * band * 0.12;
        }
        return color;
      }

      void main() {
        // --- the raster area inside the glass -------------------------
        // the mesh may use a small sub-rect of an atlas, so normalise first
        vec2 c = ((vUv - uBox.xy) / uBox.zw - uRect.xy) / uRect.zw;

        // --- CRT barrel curvature ------------------------------------
        vec2 cc = c * 2.0 - 1.0;
        float r2 = dot(cc, cc);
        vec2 wc = c + cc * r2 * 0.055 * uCurve;
        vec2 rasterUv = (wc - 0.5) / max(uRaster, vec2(0.001)) + 0.5;
        vec2 rasterEdge = abs(wc - 0.5) - uRaster * 0.5;
        float rasterMask = 1.0 - smoothstep(-0.001, 0.003, max(rasterEdge.x, rasterEdge.y));
        rasterMask = mix(rasterMask, 1.0, smoothstep(0.99, 1.0, uRaster.y));

        float video = uVideo * smoothstep(0.0, 1.0, uTransition);
        float signalTime = uTime * uMotion;
        float field = floor(signalTime * 24.0);
        vec2 signalUv = rasterUv;
        float signalRow = floor(rasterUv.y * uResolution.y * 0.5);
        float rowNoise = hash(vec2(signalRow, field)) - 0.5;
        float tracking = 1.0 - smoothstep(
          0.0, 0.075, abs(fract(rasterUv.y + signalTime * 0.065) - 0.5)
        );

        // Small line-to-line sync errors give the picture an analog edge.
        // Only the video signal moves; the glass and interaction UVs stay fixed.
        signalUv.x += video * uMotion * (
          rowNoise * 0.65 + sin(rasterUv.y * 31.0 + signalTime * 1.7) * 0.18 +
          tracking * 0.35
        ) / uResolution.x;
        signalUv = clamp(signalUv, 0.0, 1.0);
        vec3 col = screenColor(signalUv);
        if (uVideo > 0.0) {
          // Reuse the beam-spread taps for slightly misregistered RGB guns.
          // The separation grows near the curved perimeter of the tube.
          vec2 beamStep = vec2((0.7 + r2 * 0.45) / uResolution.x, 0.0);
          vec3 left = screenColor(clamp(signalUv - beamStep, 0.0, 1.0));
          vec3 right = screenColor(clamp(signalUv + beamStep, 0.0, 1.0));
          vec3 spread = col * 0.72 + (left + right) * 0.14;
          vec3 analog = mix(spread, vec3(left.r, spread.g, right.b), 0.65);
          float luma = dot(analog, vec3(0.2126, 0.7152, 0.0722));
          analog = mix(vec3(luma), analog, 0.9);
          analog = analog * vec3(1.035, 1.0, 0.96) + vec3(0.002, 0.0025, 0.003);
          col = mix(col, analog, video);
        }

        // --- soft phosphor bloom -------------------------------------
        vec3 bloom = vec3(0.0);
        vec2 glowSpread = mix(vec2(1.0), vec2(1.4, 0.9), video);
        bloom += screenColor(signalUv + vec2( 0.004,  0.006) * glowSpread);
        bloom += screenColor(signalUv + vec2(-0.004, -0.006) * glowSpread);
        bloom += screenColor(signalUv + vec2( 0.006, -0.004) * glowSpread);
        bloom += screenColor(signalUv + vec2(-0.006,  0.004) * glowSpread);
        bloom *= 0.25;
        col += max(bloom - 0.35, 0.0) * uGlow * mix(2.0, 2.6, video);

        // --- scanlines (one dark line every two source rows) ---------
        float scanDetail = 1.0 - smoothstep(0.25, 0.8, fwidth(c.y) * uResolution.y);
        float scan = 0.5 + 0.5 * cos(c.y * uResolution.y * 3.1416) * scanDetail;
        float desktopScan = 1.0 - uScan * (1.0 - scan) * 0.5;
        // Attenuate the actual line frequency near the pixel sampling limit.
        float beamRow = rasterUv.y * uResolution.y * 0.5;
        float beamDetail = 1.0 - smoothstep(0.35, 0.65, fwidth(beamRow));
        float luminance = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        float beamContrast = mix(0.26, 0.14, luminance);
        float videoScan = 0.98 + cos(beamRow * 6.283185) * beamContrast * beamDetail;
        col *= mix(desktopScan, videoScan, video);

        // --- fine phosphor texture -----------------------------------
        float grille = 0.5 + 0.5 * cos(c.x * uResolution.x * 3.1416);
        float phosphorColumn = rasterUv.x * uResolution.x * 0.5;
        float phosphorDetail = 1.0 - smoothstep(0.35, 0.65, fwidth(phosphorColumn));
        float videoGrille = 0.5 + 0.5 * cos(phosphorColumn * 6.283185);
        col *= 1.0 - mix(0.035 * (1.0 - grille), 0.13 * (1.0 - videoGrille) * phosphorDetail, video);
        vec3 phosphorDots = 0.5 + 0.5 * cos(phosphorColumn * 6.283185 + vec3(0.0, 2.094395, 4.188790));
        col *= 1.0 - (1.0 - phosphorDots) * 0.065 * video * phosphorDetail;
        float phosphor = hash(floor(rasterUv * uResolution * 1.5)) - 0.5;
        col *= 1.0 + phosphor * 0.035 * video * phosphorDetail;

        // --- vignette inside the glass -------------------------------
        float vig = 1.0 - smoothstep(0.42, 1.35, length(cc));
        col *= mix(1.0, vig, uVig + video * 0.13);

        // --- flicker + grain -----------------------------------------
        float flick = 1.0 + sin(signalTime * 87.0) * 0.010 + sin(signalTime * 13.7) * 0.012;
        float videoFlicker = 1.0 + sin(signalTime * 2.2) * 0.003 + sin(signalTime * 17.0) * 0.002;
        col *= mix(flick, videoFlicker, video);
        col *= 1.0 - tracking * 0.025 * video * uMotion;
        float grain = hash(c * uResolution + field) - 0.5;
        float signalGrain = hash(floor(rasterUv * uResolution) + vec2(field, field * 0.73)) - 0.5;
        col += mix(grain * uNoise * 0.35, signalGrain * uNoise * (0.4 + sqrt(luminance)), video);
        col += vec3(rowNoise, -rowNoise * 0.3, rowNoise * 0.7) * 0.002 * video;
        col = max(col, vec3(0.0));
        col = mix(vec3(0.92), col, uContent);

        // Leave an unlit glass margin between the phosphor raster and the case.
        float aspect = uResolution.x / uResolution.y;
        vec2 halfSize = vec2(aspect, 1.0) * 0.5;
        vec2 q = abs((wc - 0.5) * vec2(aspect, 1.0)) - halfSize + uRadius;
        float edgeDistance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
        float feather = max(fwidth(edgeDistance) * 1.25, 0.0025);
        float mask = 1.0 - smoothstep(-feather, feather, edgeDistance);
        col *= 1.0 - 0.14 * smoothstep(-0.025, 0.0, edgeDistance);

        // --- power on / off ------------------------------------------
        col *= uPower * rasterMask;
        float beam = exp(-pow((c.y - 0.5) / 0.005, 2.0));
        beam *= 1.0 - smoothstep(uRaster.x * 0.45, uRaster.x * 0.5 + 0.004, abs(c.x - 0.5));
        col += vec3(beam * uBeam);
        col += vec3(uFlash * 0.9);
        if (uBloomOnly > 0.5) {
          // The existing depth prepass keeps the case and foreground opaque.
          float sceneDepth = texture2D(uSceneDepth, gl_FragCoord.xy / uBloomResolution).r;
          if (gl_FragCoord.z > sceneDepth + 0.000002) discard;
          // Only powered phosphor blooms; glass reflections stay in the base image.
          vec3 emission = max(col * mask - 0.06, 0.0);
          gl_FragColor = vec4(emission * vec3(0.94, 1.0, 1.025), mask * rasterMask);
          return;
        }
        col = vec3(0.0045, 0.005, 0.0048) + col * mask;

        // Reflections travel across the actual curved normals as the camera orbits.
        vec3 glassNormal = normalize(vViewNormal);
        vec3 viewDirection = normalize(vViewPosition);
        float facing = max(dot(glassNormal, viewDirection), 0.0);
        float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
        vec3 reflected = reflect(-viewDirection, glassNormal);
        vec3 windowRight = normalize(cross(vec3(0.0, 1.0, 0.0), uWindowDirection));
        vec3 windowUp = cross(uWindowDirection, windowRight);
        float windowFacing = dot(reflected, uWindowDirection);
        vec2 windowUv = vec2(dot(reflected, windowRight), dot(reflected, windowUp)) / max(windowFacing, 0.001);
        vec2 windowEdge = abs(windowUv) - vec2(0.19, 0.38);
        float windowReflection = (1.0 - smoothstep(-0.035, 0.085, max(windowEdge.x, windowEdge.y))) * step(0.0, windowFacing);
        float mullion = smoothstep(0.012, 0.028, abs(windowUv.x));
        windowReflection *= mix(0.28, 1.0, mullion);
        col *= (0.88 + facing * 0.05) * (1.0 - fresnel * 0.45);
        col += vec3(windowReflection * uReflection * (0.55 + fresnel * 3.0));
        col += vec3(pow(1.0 - facing, 2.0) * 0.018);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })

  return material
}
