/**
 * The Field — GLSL ES 3.0 fragment shader (web). Written by hand from the
 * spec in docs/design/references.md; `field.sksl.ts` is the same picture in
 * SkSL for Skia on native. Keep the two in lock-step; the golden test diffs
 * both renders of the same seed.
 *
 * Uniforms
 *   u_res    viewport size in px
 *   u_time   seconds
 *   u_seed   four floats in [0,1) from the account address
 *   u_pulse  0..1, decays over ~120 ms after each block
 *   u_touch  (x, y) in 0..1 and strength 0..1 (z)
 *   u_warmth 0..1, holder tier warmth (light-only `flare` toward higher tiers)
 */
export const FIELD_FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_time;
uniform vec4 u_seed;
uniform float u_pulse;
uniform vec3 u_touch;
uniform float u_warmth;

// Spectrum (light palette): core #EEF8FF, arc #5FD8FF, plasma #A78BFF, flare #FF8A5B.
const vec3 C_CORE = vec3(0.933, 0.973, 1.0);
const vec3 C_ARC = vec3(0.373, 0.847, 1.0);
const vec3 C_PLASMA = vec3(0.655, 0.545, 1.0);
const vec3 C_FLARE = vec3(1.0, 0.541, 0.357);
const vec3 C_VOID = vec3(0.024, 0.035, 0.075);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

// One filament: the zero set of a warped noise field, thin and bright.
// The core is a few px wide; a much fainter halo gives the glass its light.
float filament(vec2 uv, float phase, float freq, float t) {
  vec2 warp = vec2(fbm(uv * freq + phase + t * 0.05), fbm(uv * freq - phase - t * 0.04));
  float n = fbm(uv * (freq * 0.9) + warp * 0.8 + phase);
  float d = abs(n - 0.5);
  return exp(-d * d * 9000.0) + 0.18 * exp(-d * d * 700.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0);
  float t = u_time;

  // Touch bends the field toward the finger (arcs lean into the pull).
  vec2 tp = u_touch.xy * vec2(u_res.x / u_res.y, 1.0);
  vec2 toTouch = tp - p;
  float pull = u_touch.z * exp(-dot(toTouch, toTouch) * 6.0);
  p += toTouch * pull * 0.35;

  float s0 = u_seed.x * 10.0, s1 = u_seed.y * 10.0, s2 = u_seed.z * 10.0, s3 = u_seed.w * 10.0;
  float f1 = filament(p, s0, 1.6 + u_seed.y, t);
  float f2 = filament(p + vec2(0.3, 0.1), s1, 2.4 + u_seed.z, t * 0.8);
  float f3 = filament(p - vec2(0.2, 0.25), s2, 1.2 + u_seed.w * 0.6, t * 1.1);
  float f4 = filament(p * 1.3, s3, 3.1, t * 0.6) * 0.5;

  float glow = f1 * 0.9 + f2 * 0.7 + f3 * 0.8 + f4;
  glow *= 0.35 + 0.65 * fbm(p * 0.8 + t * 0.02 + s1); // breathing intensity along the arcs
  glow *= 0.55 * (1.0 + u_pulse * 0.6);               // quiet by default; a block brightens it

  // Spectrum: fringe plasma → arc → core, with flare warmth by tier.
  vec3 fringe = mix(C_PLASMA, C_FLARE, u_warmth * 0.6);
  vec3 col = mix(C_VOID, fringe, smoothstep(0.0, 0.3, glow) * 0.28);
  col = mix(col, C_ARC, smoothstep(0.2, 0.7, glow) * 0.55);
  col = mix(col, C_CORE, smoothstep(0.65, 1.1, glow) * 0.9);

  // Vignette + 2% grain so the base is never flat.
  float vig = smoothstep(1.35, 0.35, length(uv - 0.5) * 1.4);
  col = mix(C_VOID, col, vig);
  float grain = (hash(gl_FragCoord.xy + fract(t)) - 0.5) * 0.02;
  col += grain;

  fragColor = vec4(col, 1.0);
}
`

export const FIELD_VERTEX_GLSL = /* glsl */ `#version 300 es
const vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0); }
`
