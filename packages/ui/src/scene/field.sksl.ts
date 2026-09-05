/**
 * The Grid — SkSL runtime shader (native, Skia). Mirrors field.glsl.ts line
 * for line where the languages allow; keep them in lock-step.
 */
export const FIELD_SKSL = `
uniform float2 u_res;
uniform float u_time;
uniform float4 u_seed;
uniform float u_pulse;
uniform float3 u_touch;
uniform float u_warmth;

const half3 C_CORE = half3(0.918, 0.965, 1.0);
const half3 C_ARC = half3(0.310, 0.765, 1.0);
const half3 C_PLASMA = half3(0.545, 0.361, 0.965);
const half3 C_AURORA_V = half3(0.357, 0.169, 0.851);
const half3 C_AURORA_B = half3(0.118, 0.302, 1.0);
const half3 C_FLARE = half3(1.0, 0.541, 0.357);
const half3 C_VOID = half3(0.027, 0.039, 0.122);
const half3 C_DEEP = half3(0.043, 0.063, 0.188);

float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float sheetY(float x, float base, float amp, float phase, float t) {
  return base + amp * sin(x * 2.6 + phase + t * 0.32) + amp * 0.45 * sin(x * 7.1 - t * 0.21 + phase * 1.7);
}

float line(float d, float px) {
  float core = exp(-d * d / (2.0 * px * px * 1.6));
  float halo = exp(-d * d / (2.0 * px * px * 90.0));
  return core + 0.22 * halo;
}

half4 main(float2 fragCoord) {
  float2 uv = fragCoord / u_res;
  uv.y = 1.0 - uv.y; // Skia's origin is top-left; GL's is bottom-left.
  float aspect = u_res.x / u_res.y;
  float2 p = float2(uv.x * aspect, uv.y);
  float t = u_time;
  float px = 1.0 / u_res.y;

  half3 col = mix(C_VOID, C_DEEP, half(smoothstep(1.0, 0.0, uv.y) * 0.8));

  float bV = 0.9 + 0.1 * sin(t * 0.45 + u_seed.x * 6.283);
  float bB = 0.9 + 0.1 * sin(t * 0.41 + u_seed.y * 6.283 + 1.3);
  float2 cV = float2(0.12 * aspect, 0.86);
  float2 cB = float2(0.92 * aspect, 0.18);
  float aV = exp(-dot(p - cV, p - cV) * 3.2) * 0.30 * bV;
  float aB = exp(-dot(p - cB, p - cB) * 2.6) * 0.24 * bB;
  half3 blue = mix(C_AURORA_B, C_FLARE, half(u_warmth * 0.35));
  col += C_AURORA_V * half(aV) + blue * half(aB);

  float2 tp = float2(u_touch.x * aspect, u_touch.y);
  float lift = u_touch.z * exp(-dot(p - tp, p - tp) * 9.0) * 0.03;

  float s0 = u_seed.x; float s1 = u_seed.y; float s2 = u_seed.z; float s3 = u_seed.w;
  half3 mesh = half3(0.0);
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
    half3 tint = mix(C_PLASMA, C_ARC, half(smoothstep(0.0, aspect, p.x) * 0.85 + fi * 0.05));
    mesh += tint * half(line(d, px) * 0.34 * depth);
    float spacing = 0.055 + s3 * 0.01;
    float along = p.x / spacing + fi * 0.37 + s0;
    float nx = abs(fract(along) - 0.5) * spacing;
    float node = exp(-(nx * nx + d * d) / (2.0 * px * px * 2.2)) * (1.0 + u_pulse * 0.6);
    float nodeHalo = exp(-(nx * nx + d * d) / (2.0 * px * px * 40.0)) * 0.18;
    mesh += mix(tint, C_CORE, half(0.5)) * half((node * 0.55 + nodeHalo) * depth);
    if (prevY > 0.0) {
      float lo = min(prevY, y); float hi = max(prevY, y);
      float inside = step(lo, p.y) * step(p.y, hi);
      float lnk = exp(-nx * nx / (2.0 * px * px * 1.4)) * inside;
      mesh += tint * half(lnk * 0.07 * depth);
    }
    prevY = y;
    float2 g = float2(p.x, p.y - (y - base)) / 0.045;
    float2 gf = abs(fract(g) - 0.5);
    float dot2 = exp(-dot(gf, gf) * 60.0);
    lattice += dot2 * exp(-d * 18.0) * 0.045 * depth;
  }
  col += mesh + mix(C_PLASMA, C_ARC, half(uv.x)) * half(lattice);

  col = mix(col, mix(C_VOID, C_DEEP, half(0.3)) + C_AURORA_V * half(aV) + blue * half(aB), half(smoothstep(0.42, 0.62, uv.y) * 0.9));

  float vig = smoothstep(1.45, 0.4, length(uv - float2(0.5, 0.45)) * 1.35);
  col = mix(C_VOID, col, half(vig));
  float grain = (hash(fragCoord + fract(t)) - 0.5) * 0.015;
  col += half3(grain);

  return half4(col, 1.0);
}
`
