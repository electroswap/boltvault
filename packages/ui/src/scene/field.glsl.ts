/**
 * The Grid — GLSL ES 3.0 fragment shader (web). Written by hand from the
 * spec in docs/design/style-bible.md; `field.sksl.ts` is the same picture in
 * SkSL for Skia on native. Keep the two in lock-step.
 *
 * A deep navy night lit by two auroras, and a living mesh in the lower half:
 * four wave sheets of hairline light with a node every few percent of width,
 * a faint lattice of dots displaced by the same waves, and links between
 * neighbouring sheets. Violet where the mesh is far, cyan where it comes
 * near. Nothing above 40 % luminance under the readout.
 *
 * Uniforms
 *   u_res    viewport size in px
 *   u_time   seconds
 *   u_seed   four floats in [0,1) from the account address
 *   u_pulse  0..1, decays over ~120 ms after each block (nodes flare)
 *   u_touch  (x, y) in 0..1 and strength 0..1 (z)
 *   u_warmth 0..1, holder tier warmth (the blue aurora leans toward flare)
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

// Light palette: core #EAF6FF, arc #4FC3FF, plasma #8B5CF6, auroras #5B2BD9 / #1E4DFF, flare #FF8A5B; paint void #070A1F, deep #0B1030.
const vec3 C_CORE = vec3(0.918, 0.965, 1.0);
const vec3 C_ARC = vec3(0.310, 0.765, 1.0);
const vec3 C_PLASMA = vec3(0.545, 0.361, 0.965);
const vec3 C_AURORA_V = vec3(0.357, 0.169, 0.851);
const vec3 C_AURORA_B = vec3(0.118, 0.302, 1.0);
const vec3 C_FLARE = vec3(1.0, 0.541, 0.357);
const vec3 C_VOID = vec3(0.027, 0.039, 0.122);
const vec3 C_DEEP = vec3(0.043, 0.063, 0.188);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// One sheet's height at x: a slow long wave and a faster short one, seeded.
float sheetY(float x, float base, float amp, float phase, float t) {
  return base + amp * sin(x * 2.6 + phase + t * 0.32) + amp * 0.45 * sin(x * 7.1 - t * 0.21 + phase * 1.7);
}

// Hairline core plus a wide halo, in px-independent units (uv space).
float line(float d, float px) {
  float core = exp(-d * d / (2.0 * px * px * 1.6));
  float halo = exp(-d * d / (2.0 * px * px * 90.0));
  return core + 0.22 * halo;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;
  float px = 1.0 / u_res.y; // one CSS px in uv units (the canvas is already DPR-scaled)

  // Ground: night, slightly lighter toward the bottom.
  vec3 col = mix(C_VOID, C_DEEP, smoothstep(1.0, 0.0, uv.y) * 0.8);

  // Two auroras, breathing over ~14 s with seeded phases; warmth pulls the blue one toward flare.
  float bV = 0.9 + 0.1 * sin(t * 0.45 + u_seed.x * 6.283);
  float bB = 0.9 + 0.1 * sin(t * 0.41 + u_seed.y * 6.283 + 1.3);
  vec2 cV = vec2(0.12 * aspect, 0.86);
  vec2 cB = vec2(0.92 * aspect, 0.18);
  float aV = exp(-dot(p - cV, p - cV) * 3.2) * 0.30 * bV;
  float aB = exp(-dot(p - cB, p - cB) * 2.6) * 0.24 * bB;
  vec3 blue = mix(C_AURORA_B, C_FLARE, u_warmth * 0.35);
  col += C_AURORA_V * aV + blue * aB;

  // Touch: the sheets lift a little toward the pointer; nothing chases the finger.
  vec2 tp = vec2(u_touch.x * aspect, u_touch.y);
  float lift = u_touch.z * exp(-dot(p - tp, p - tp) * 9.0) * 0.03;

  // Four sheets in the lower 55 %. Colour runs plasma (left) to arc (right), brighter toward the front.
  float s0 = u_seed.x, s1 = u_seed.y, s2 = u_seed.z, s3 = u_seed.w;
  vec3 mesh = vec3(0.0);
  float lattice = 0.0;
  float prevY = -1.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float base = 0.06 + fi * (0.085 + s2 * 0.02);
    float amp = 0.028 + fi * 0.009 + s1 * 0.015;
    float phase = s0 * 6.283 + fi * (1.9 + s3 * 0.8);
    float y = sheetY(p.x, base, amp, phase, t) + lift;
    float d = abs(p.y - y);
    float depth = 0.35 + 0.65 * (fi / 3.0);
    vec3 tint = mix(C_PLASMA, C_ARC, smoothstep(0.0, aspect, p.x) * 0.85 + fi * 0.05);
    // The hairline.
    mesh += tint * line(d, px) * 0.34 * depth;
    // Nodes: a dot every ~0.06 of width along the sheet, flaring on a block.
    float spacing = 0.055 + s3 * 0.01;
    float along = p.x / spacing + fi * 0.37 + s0;
    float nx = abs(fract(along) - 0.5) * spacing;
    float node = exp(-(nx * nx + d * d) / (2.0 * px * px * 2.2)) * (1.0 + u_pulse * 0.6);
    float nodeHalo = exp(-(nx * nx + d * d) / (2.0 * px * px * 40.0)) * 0.18;
    mesh += mix(tint, C_CORE, 0.5) * (node * 0.55 + nodeHalo) * depth;
    // Links to the previous sheet at node positions: the mesh's volume.
    if (prevY > 0.0) {
      float lo = min(prevY, y), hi = max(prevY, y);
      float inside = step(lo, p.y) * step(p.y, hi);
      float lnk = exp(-nx * nx / (2.0 * px * px * 1.4)) * inside;
      mesh += tint * lnk * 0.07 * depth;
    }
    prevY = y;
    // A faint dot grid displaced by this sheet, fading with distance from it.
    vec2 g = vec2(p.x, p.y - (y - base)) / 0.045;
    vec2 gf = abs(fract(g) - 0.5);
    float dot2 = exp(-dot(gf, gf) * 60.0);
    lattice += dot2 * exp(-d * 18.0) * 0.045 * depth;
  }
  col += mesh + mix(C_PLASMA, C_ARC, uv.x) * lattice;

  // Keep the top calm for type: fade the mesh out above the sheets (it is already below 0.55).
  col = mix(col, mix(C_VOID, C_DEEP, 0.3) + C_AURORA_V * aV + blue * aB, smoothstep(0.42, 0.62, uv.y) * 0.9);

  // Vignette + 1.5 % grain so the base is never flat.
  float vig = smoothstep(1.45, 0.4, length(uv - vec2(0.5, 0.45)) * 1.35);
  col = mix(C_VOID, col, vig);
  float grain = (hash(gl_FragCoord.xy + fract(t)) - 0.5) * 0.015;
  col += grain;

  fragColor = vec4(col, 1.0);
}
`

export const FIELD_VERTEX_GLSL = /* glsl */ `#version 300 es
const vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0); }
`
