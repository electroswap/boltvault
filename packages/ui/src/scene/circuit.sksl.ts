/**
 * The Circuit — SkSL runtime shader (native, Skia). Mirrors circuit.glsl.ts
 * line for line where the languages allow; keep them in lock-step, exactly as
 * field.sksl.ts mirrors field.glsl.ts.
 *
 * Owner: "Changing the background to circuit or grid has no effect, it stays
 * grid no matter what." The setting was plumbed the whole way through — the
 * schema, Feel.tsx, useScene, TabShell — and then Field.native.tsx never read
 * the prop, because there was nothing to read it for: only the Grid had ever
 * been ported. This is the missing half.
 *
 * Differences forced by SkSL, all mechanical:
 *   - vecN -> floatN, and no `#version` / `precision` / `out` declarations
 *   - no preprocessor, so LAYERS is a const int
 *   - `half4 main(float2 fragCoord)` returns the colour instead of writing to
 *     an out variable
 *   - Skia's origin is top-left where GL's is bottom-left, so uv.y is flipped
 *     once at the top and everything below reads identically
 */
export const CIRCUIT_SKSL = `
uniform float2 u_res;
uniform float u_time;
uniform float4 u_seed;
uniform float u_pulse;
uniform float3 u_touch;
uniform float u_warmth;

const int LAYERS = 2;

const float3 C_VOID  = float3(0.027, 0.039, 0.122);
const float3 C_DEEP  = float3(0.043, 0.063, 0.188);
const float3 C_VOLT  = float3(0.000, 0.235, 1.000);
const float3 C_SPARK = float3(0.000, 1.000, 1.000);
const float3 C_CORE  = float3(0.918, 0.965, 1.000);
const float3 C_ARC   = float3(0.310, 0.765, 1.000);
const float3 C_FLARE = float3(1.000, 0.541, 0.357);

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

float vnoise(float2 p) {
  float2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + float2(1, 0)), f.x), mix(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), f.x), f.y);
}

float segDist(float2 p, float2 a, float2 b) {
  float2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float line(float d, float cw) {
  float core = exp(-d * d / (2.0 * cw * cw * 1.1));
  float halo = exp(-d * d / (2.0 * cw * cw * 45.0));
  return core + 0.12 * halo;
}

float edgeOn(float2 cell, float dir, float density, float seed) {
  float h = hash21(cell * 1.7 + float2(dir * 37.0 + seed * 91.0, seed * 13.0));
  return step(h, density);
}

float train(float x, float speed, float phase) {
  float t = fract(x - u_time * speed + phase);
  return exp(-t * 9.0) * step(0.0, t);
}

struct Board { float trace; float pad; float signal; };

Board board(float2 p, float cellSize, float seed, float parallax, float speedMul) {
  Board b;
  float2 q = (p + float2(0.0, parallax)) / cellSize;
  float2 cell = floor(q);
  float2 f = fract(q) - 0.5;
  float cw = (1.0 / u_res.y) / cellSize;

  float density = 0.21 + 0.30 * vnoise(cell * 0.21 + seed * 7.0);

  float e = edgeOn(cell, 0.0, density, seed);
  float n = edgeOn(cell, 1.0, density, seed);
  float w = edgeOn(cell - float2(1.0, 0.0), 0.0, density, seed);
  float s = edgeOn(cell - float2(0.0, 1.0), 1.0, density, seed);
  float count = e + n + w + s;

  float d = 10.0;
  float pad = 0.0;
  float2 E = float2(0.5, 0.0), N = float2(0.0, 0.5), W = float2(-0.5, 0.0), S = float2(0.0, -0.5), O = float2(0.0);

  if (count == 2.0) {
    if (e + w == 2.0) d = segDist(f, W, E);
    else if (n + s == 2.0) d = segDist(f, S, N);
    else if (e + n == 2.0) d = segDist(f, E, N);
    else if (n + w == 2.0) d = segDist(f, N, W);
    else if (w + s == 2.0) d = segDist(f, W, S);
    else d = segDist(f, S, E);
  } else if (count > 0.0) {
    if (e > 0.5) d = min(d, segDist(f, O, E));
    if (n > 0.5) d = min(d, segDist(f, O, N));
    if (w > 0.5) d = min(d, segDist(f, O, W));
    if (s > 0.5) d = min(d, segDist(f, O, S));
    float r = length(f);
    float ring = abs(r - 0.085);
    pad = exp(-ring * ring / (2.0 * cw * cw * 1.4)) + 0.5 * exp(-r * r / (2.0 * cw * cw * 1.2));
  } else {
    float via = step(0.72, hash21(cell * 3.1 + seed));
    float r = length(f);
    pad = via * 0.45 * exp(-r * r / (2.0 * cw * cw * 1.6));
  }

  float trace = d < 5.0 ? line(d, cw) : 0.0;

  float rowSeed = hash11(cell.y + seed * 100.0);
  float colSeed = hash11(cell.x + seed * 200.0);
  float rowOn = step(0.62, hash11(floor(u_time * 0.09 + rowSeed * 50.0) + cell.y * 0.37));
  float colOn = step(0.62, hash11(floor(u_time * 0.11 + colSeed * 50.0) + cell.x * 0.41));
  float horizontal = (e + w > 0.0) ? 1.0 : 0.0;
  float vertical = (n + s > 0.0) ? 1.0 : 0.0;
  float sigH = horizontal * rowOn * train(q.x * 0.17, 0.55 * speedMul * (0.7 + rowSeed), rowSeed);
  float sigV = vertical * colOn * train(q.y * 0.17, 0.45 * speedMul * (0.7 + colSeed), colSeed);
  float onLine = exp(-d * d / (2.0 * cw * cw * 2.4));
  b.signal = (sigH + sigV) * onLine;
  b.trace = trace;
  b.pad = pad;
  return b;
}

half4 main(float2 fragCoord) {
  float2 uv = fragCoord / u_res;
  uv.y = 1.0 - uv.y; // Skia's origin is top-left; GL's is bottom-left.
  float aspect = u_res.x / u_res.y;
  float2 p = float2(uv.x * aspect, uv.y);
  float t = u_time;
  float grain = (hash21(fragCoord + fract(t)) - 0.5) * 0.015;
  // board() is per-fragment, one cell — zooming out does not shade extra cells.
  float vig = smoothstep(1.5, 0.35, length(uv - float2(0.5, 0.45)) * 1.3);
  float calm = smoothstep(0.86, 0.30, uv.y);
  if (vig < 0.015) {
    return half4(half3(C_VOID + float3(grain)), 1.0);
  }

  float3 col = mix(C_VOID, C_DEEP, smoothstep(1.0, 0.0, uv.y) * 0.85);

  float bB = 0.9 + 0.1 * sin(t * 0.45 + u_seed.x * 6.283);
  float bC = 0.9 + 0.1 * sin(t * 0.39 + u_seed.y * 6.283 + 1.7);
  float2 cB = float2(0.90 * aspect, 0.12);
  float2 cC = float2(0.08 * aspect, 0.92);
  float aB = exp(-dot(p - cB, p - cB) * 2.4) * 0.30 * bB;
  float aC = exp(-dot(p - cC, p - cC) * 3.4) * 0.10 * bC;
  col += mix(C_VOLT, C_FLARE, u_warmth * 0.35) * aB + C_SPARK * aC;

  if (calm * vig > 0.02) {
    float2 ptr = float2(u_touch.x * aspect, u_touch.y);
    float hot = u_touch.z * exp(-dot(p - ptr, p - ptr) * 28.0);

    float front = 1.05 - (1.0 - u_pulse) * 1.15;
    float frontGlow = u_pulse > 0.003 ? exp(-abs(uv.y - front) * 14.0) * u_pulse : 0.0;
    float behind = u_pulse > 0.003 ? smoothstep(front - 0.02, front + 0.35, uv.y) * u_pulse : 0.0;
    float flash = u_pulse * u_pulse * 0.05;

    float3 lattice = float3(0.0);
    for (int i = 0; i < LAYERS; i++) {
      bool far = (LAYERS > 1) && (i == 0);
      // Smaller cells = camera further back: more traces, same ~1px hairlines.
      float cellSize = far ? 0.040 : 0.068;
      float depth = far ? 0.30 : 1.0;
      float parallax = far ? t * 0.006 : t * 0.011;
      float seed = far ? u_seed.z : u_seed.w;
      Board b = board(p, cellSize, seed, parallax, 1.0 + hot * 3.0 + behind * 1.5);
      float3 traceTint = mix(C_VOLT, C_ARC, far ? 0.25 : 0.55 + 0.45 * hot);
      float traceAmp = (far ? 0.18 : 0.30) * (1.0 + 1.6 * hot + 2.2 * frontGlow);
      lattice += traceTint * b.trace * traceAmp * depth;
      lattice += mix(C_ARC, C_SPARK, 0.5) * b.pad * (far ? 0.22 : 0.42) * (1.0 + 2.0 * frontGlow + hot) * depth;
      float sig = b.signal * (1.0 + 3.0 * behind + 1.5 * hot);
      lattice += mix(C_SPARK, C_CORE, clamp(sig * 0.9, 0.0, 1.0)) * sig * (far ? 0.55 : 1.0) * depth;
    }

    col += lattice * calm;
    col += (C_SPARK * 0.5 + C_CORE * 0.5) * flash * calm;
  }

  col = mix(C_VOID, col, vig);
  col += grain;

  return half4(half3(col), 1.0);
}
`
