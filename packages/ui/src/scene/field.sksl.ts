/**
 * The Field — SkSL runtime shader (native, Skia). Mirrors field.glsl.ts
 * line for line where the languages allow; keep them in lock-step.
 */
export const FIELD_SKSL = `
uniform float2 u_res;
uniform float u_time;
uniform float4 u_seed;
uniform float u_pulse;
uniform float3 u_touch;
uniform float u_warmth;

const half3 C_CORE = half3(0.933, 0.973, 1.0);
const half3 C_ARC = half3(0.373, 0.847, 1.0);
const half3 C_PLASMA = half3(0.655, 0.545, 1.0);
const half3 C_FLARE = half3(1.0, 0.541, 0.357);
const half3 C_VOID = half3(0.024, 0.035, 0.075);

float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + float2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float filament(float2 uv, float phase, float freq, float t) {
  float2 warp = float2(fbm(uv * freq + phase + t * 0.05), fbm(uv * freq - phase - t * 0.04));
  float n = fbm(uv * (freq * 0.9) + warp * 0.8 + phase);
  float d = abs(n - 0.5);
  return exp(-d * d * 9000.0) + 0.18 * exp(-d * d * 700.0);
}

half4 main(float2 fragCoord) {
  float2 uv = fragCoord / u_res;
  uv.y = 1.0 - uv.y; // Skia's origin is top-left; GL's is bottom-left.
  float2 p = uv * float2(u_res.x / u_res.y, 1.0);
  float t = u_time;

  float2 tp = u_touch.xy * float2(u_res.x / u_res.y, 1.0);
  float2 toTouch = tp - p;
  float pull = u_touch.z * exp(-dot(toTouch, toTouch) * 6.0);
  p += toTouch * pull * 0.35;

  float s0 = u_seed.x * 10.0; float s1 = u_seed.y * 10.0; float s2 = u_seed.z * 10.0; float s3 = u_seed.w * 10.0;
  float f1 = filament(p, s0, 1.6 + u_seed.y, t);
  float f2 = filament(p + float2(0.3, 0.1), s1, 2.4 + u_seed.z, t * 0.8);
  float f3 = filament(p - float2(0.2, 0.25), s2, 1.2 + u_seed.w * 0.6, t * 1.1);
  float f4 = filament(p * 1.3, s3, 3.1, t * 0.6) * 0.5;

  float glow = f1 * 0.9 + f2 * 0.7 + f3 * 0.8 + f4;
  glow *= 0.35 + 0.65 * fbm(p * 0.8 + t * 0.02 + s1);
  glow *= 0.55 * (1.0 + u_pulse * 0.6);

  half3 fringe = mix(C_PLASMA, C_FLARE, half(u_warmth * 0.6));
  half3 col = mix(C_VOID, fringe, half(smoothstep(0.0, 0.3, glow) * 0.28));
  col = mix(col, C_ARC, half(smoothstep(0.2, 0.7, glow) * 0.55));
  col = mix(col, C_CORE, half(smoothstep(0.65, 1.1, glow) * 0.9));

  float vig = smoothstep(1.35, 0.35, length(uv - 0.5) * 1.4);
  col = mix(C_VOID, col, half(vig));
  float grain = (hash(fragCoord + fract(t)) - 0.5) * 0.02;
  col += half3(grain);

  return half4(col, 1.0);
}
`
