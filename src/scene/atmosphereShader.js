/**
 * Angular noise adapted from David Haz's locally copied React Bits SideRays.
 * MIT + Commons Clause; see public/react-bits-siderays-notice.txt.
 * Depth integration, shadow sampling and foreground protection are local changes.
 */
export const atmosphereFragment = /* glsl */ `precision highp float;
uniform vec2 uResolution;
uniform vec2 uRayResolution;
uniform sampler2D uSceneDepth;
uniform sampler2D uShadowMap;
uniform mat4 uProjectionInverse;
uniform mat4 uViewToWorld;
uniform mat4 uShadowMatrix;
uniform vec3 uCameraPosition;
uniform vec3 uVolumeCenter;
uniform vec3 uLightTarget;
uniform vec3 uLightDirection;
uniform vec3 uLightRight;
uniform float uUseShadow;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uBlend;
uniform float uIntensity;
uniform float uSpread;
uniform float uDensity;
uniform float uSharpness;
uniform float uFalloff;
uniform float uGlow;
uniform float uSaturation;
uniform float uEdgeColorStrength;
uniform float uOpacity;
uniform float uReveal;
uniform vec3 uFrame;
uniform float uAim;
uniform vec3 uFocus;
uniform float uSway;
out vec4 fragColor;
#include <packing>

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float shafts(float u, float t, float seed, float aa) {
  float sway = (0.4 * sin(t * 0.31 + seed) + 0.24 * sin(t * 0.17 + seed * 2.3)) * uSway;
  float n = 0.7 * noise(vec2(u + sway + seed, t * 0.3)) + 0.3 * noise(vec2(u * 2.4 + sway * 1.5 + seed * 1.7, t * 0.45 + 3.0));
  float width = mix(0.5, 0.1, uSharpness);
  return mix(0.05, 1.0, mix(smoothstep(0.5 - width, 0.5 + width, n), 0.5, aa));
}

// A very small prism fringe, used only at the outer boundary of the light fan.
vec3 spectrumColor(float position) {
  float band = clamp(position, 0.0, 1.0) * 6.0;
  float blend = smoothstep(0.0, 1.0, fract(band));
  if (band < 1.0) return mix(vec3(1.0, 0.12, 0.10), vec3(1.0, 0.42, 0.08), blend);
  if (band < 2.0) return mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.88, 0.12), blend);
  if (band < 3.0) return mix(vec3(1.0, 0.88, 0.12), vec3(0.16, 1.0, 0.34), blend);
  if (band < 4.0) return mix(vec3(0.16, 1.0, 0.34), vec3(0.08, 0.92, 1.0), blend);
  if (band < 5.0) return mix(vec3(0.08, 0.92, 1.0), vec3(0.16, 0.30, 1.0), blend);
  return mix(vec3(0.16, 0.30, 1.0), vec3(0.76, 0.15, 1.0), smoothstep(5.0, 6.0, band));
}

float illuminated(vec3 position) {
  if (uUseShadow < 0.5) return 1.0;
  vec4 shadow = uShadowMatrix * vec4(position, 1.0);
  vec3 coord = shadow.xyz / shadow.w;
  if (any(lessThan(coord, vec3(0.0))) || any(greaterThan(coord, vec3(1.0)))) return 1.0;
  float blocker = unpackRGBAToDepth(textureLod(uShadowMap, coord.xy, 0.0));
  return smoothstep(coord.z - 0.0012, coord.z + 0.0004, blocker);
}

float scattering(vec2 uv, float depth) {
  vec4 view = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 surface = view.xyz / view.w;
  vec3 ray = mat3(uViewToWorld) * normalize(surface);
  // A bounded volume above the desk avoids a uniform fog layer at the camera.
  vec3 offset = uCameraPosition - uVolumeCenter;
  float along = dot(offset, ray);
  float discriminant = along * along - dot(offset, offset) + 3.2 * 3.2;
  if (discriminant <= 0.0) return 0.0;
  float root = sqrt(discriminant);
  float start = max(0.18, -along - root);
  // Stop integration BEFORE the first visible surface, including the CRT.
  float end = min(length(surface) - 0.02, -along + root);
  if (end <= start) return 0.0;
  float stride = (end - start) / float(STEPS);
  float jitter = hash(gl_FragCoord.xy + 0.37);
  float sum = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float distance = start + (float(i) + jitter) * stride;
    vec3 p = uCameraPosition + ray * distance;
    vec3 relative = p - uLightTarget;
    vec3 radial = relative - uLightDirection * dot(relative, uLightDirection);
    float windowX = dot(relative, uLightRight);
    // Soft gaps in a virtual window, fixed in light space, shape the air shafts.
    float slits = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(windowX * 8.0 + 0.3 * sin(p.y * 2.0)), 3.0);
    float height = smoothstep(0.55, 0.95, p.y) * (1.0 - smoothstep(3.2, 4.2, p.y));
    float wisps = 0.85 + 0.15 * noise(p.xz * 1.7 + p.y * 0.3 + uTime * 0.06);
    float density = exp(-dot(radial, radial) * 0.45) * height * slits * wisps;
    density *= smoothstep(0.18, 0.65, distance);
    sum += density * illuminated(p) * stride;
  }
  float cosine = dot(-ray, uLightDirection);
  float phase = 0.8 * (1.0 - 0.22 * 0.22) / pow(1.0 + 0.22 * 0.22 - 0.44 * cosine, 1.5);
  // An artistic foreground limit preserves the model's surface contrast.
  float airOnly = step(0.99999, depth);
  return sum * phase * mix(0.08, 1.0, airOnly);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRayResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  if (uFrame.x > 0.5) q.x = -q.x;
  if (uFrame.y > 0.5) q.y = -q.y;
  vec2 source = uFrame.z > 0.5 ? vec2(aspect * 0.5 + 0.42, 0.3) : vec2(aspect * 0.5 + 0.1, 0.62);
  float heading = (uFrame.z > 0.5 ? 3.42 : -2.48) + uAim + 0.01 * sin(uTime * 0.21) * uSway;
  vec2 v = q - source;
  float r = length(v);
  float angle = mod(atan(v.y, v.x) - heading + 3.14159265, 6.28318531) - 3.14159265;
  float u = angle * uDensity;
  float aa = smoothstep(0.12, 0.45, fwidth(u));
  float offset = uSpread * 0.22;
  float fanA = exp(-pow((angle + offset) / uSpread, 2.0) * 1.4);
  float fanB = exp(-pow((angle - offset) / (uSpread * 1.15), 2.0) * 1.4);
  float focus = 1.0 + uFocus.z * exp(-pow((angle - uFocus.x) / uFocus.y, 2.0));
  // Restore the copied SideRays shaft profile, keeping the main light near white.
  float lightA = fanA * shafts(u, uTime, 0.0, aa) * focus;
  float lightB = fanB * shafts(u * 0.83, uTime * 0.6, 17.0, aa) * focus;
  float reach = 1.0 / (1.0 + pow(r / 0.4, uFalloff));
  vec3 warm = mix(vec3(1.0), uColorA, uSaturation);
  vec3 cool = mix(vec3(1.0), uColorB, uSaturation);
  vec3 sunlight = (warm * lightA * (1.0 - uBlend) + cool * lightB * uBlend) * 2.0 * reach;
  sunlight += mix(warm, cool, uBlend) * uGlow * exp(-pow(r / 0.4, 2.0));
  float depth = texture(uSceneDepth, uv).r;
  float air = scattering(uv, depth);
  // Keep the original SideRays fan readable; shadowed air gently modulates it.
  // Foreground still uses the integrated depth limit and the final spill cap.
  float airGain = depth >= 0.99999 ? mix(0.72, 1.0, clamp(air * 0.6, 0.0, 1.0)) : air;
  vec3 energy = sunlight * airGain * uIntensity;
  float edgeWidth = max(0.012, fwidth(angle) * 2.0);
  float edgeDistance = abs(angle) - uSpread * 1.08;
  float fringe = exp(-pow(edgeDistance / edgeWidth, 2.0) * 2.0);
  fringe *= smoothstep(0.15, 0.3, r) * (1.0 - smoothstep(0.65, 1.2, r));
  float edgeSpectrum = clamp(0.5 + edgeDistance / (edgeWidth * 2.0), 0.0, 1.0);
  energy += spectrumColor(edgeSpectrum) * fringe * air * reach * uIntensity * uEdgeColorStrength * 0.18;
  energy *= uOpacity * (1.0 - smoothstep(uReveal * 2.6 - 0.45, uReveal * 2.6, r)) * smoothstep(0.0, 0.35, uReveal);
  // Use the copied SideRays highlight response, rather than a flat fog shoulder.
  float peak = max(energy.r, max(energy.g, energy.b));
  float mapped = 1.0 - exp(-peak);
  vec3 tone = energy * (mapped / max(peak, 1e-4));
  tone = mix(tone, vec3(mapped), smoothstep(0.7, 1.0, mapped) * 0.55);
  vec3 light = tone * max(tone.r, max(tone.g, tone.b));
  // Stable dithering keeps a small ray buffer smooth without animated shimmer.
  float grain = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(max(vec3(0.0), light + grain * smoothstep(vec3(0.0), vec3(0.01), energy)), 1.0);
}`

export const atmosphereComposite = /* glsl */ `precision highp float;
uniform sampler2D uRays;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform vec2 uRayResolution;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float centerDepth = texture(uSceneDepth, uv).r;
  vec3 light = vec3(0.0);
  float weightSum = 0.0;
  // A small depth-aware tent filter removes sparse-march grain without smearing
  // light across the computer silhouette. It also avoids a second blur target.
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 sampleUv = uv + vec2(float(x), float(y)) * 1.5 / uRayResolution;
      float sampleDepth = texture(uSceneDepth, sampleUv).r;
      float weight = float((2 - abs(x)) * (2 - abs(y)));
      weight *= 1.0 - step(0.0008, abs(sampleDepth - centerDepth));
      light += texture(uRays, sampleUv).rgb * weight;
      weightSum += weight;
    }
  }
  light /= max(1.0, weightSum);
  if (centerDepth < 0.99999) light = min(light, vec3(0.008));
  fragColor = vec4(light, 0.0);
}`
