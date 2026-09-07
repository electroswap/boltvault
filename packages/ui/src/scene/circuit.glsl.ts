/**
 * The Circuit — GLSL ES 3.0 fragment shader (web), the Home board.
 *
 * Owner: "I also really don't like the animated background. I want you to keep
 * it, and make it an option in the 'Appearance & feel' settings, but I want you
 * to come up with a different animation for the home page (maybe opportunity to
 * copy the circuit lattice from the ../docs project)."
 *
 * So this is the docs landing scene's circuit lattice, ported: a navy night lit
 * by two auroras and a printed-circuit board drawn on a hashed grid — every
 * grid edge is a trace or not (decided per edge, so neighbours agree), traces
 * meet at cell centres or cut the corner at 45 degrees, dangling ends get a
 * ring pad, vias dot the empty cells. Signals run the rows and columns; each
 * Electroneum block sends a front sweeping down the frame, lighting what it
 * crosses. Two layers parallax against each other.
 *
 * Adapted to the wallet rather than reinvented, so both stay recognisable as
 * one brand:
 *   - the landing page's scroll and pointer become the Field's `u_touch`, and
 *     the boards drift on time alone
 *   - the headline's calm rect becomes a fixed quiet band across the top, which
 *     is the style bible's "nothing above 40 % luminance under the readout"
 *   - `u_intensity` is gone and `u_warmth` arrives instead, so the holder tier
 *     leans the board warm exactly as it leans the Grid's aurora
 *
 * The uniform set is deliberately identical to field.glsl.ts, so Field.tsx
 * chooses a shader and changes nothing else.
 *
 * Generated from apps/docs/src/landing/scene/circuit.glsl.ts.
 */
export const CIRCUIT_FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_time;
uniform vec4 u_seed;
uniform float u_pulse;
uniform vec3 u_touch;
uniform float u_warmth;

#ifndef LAYERS
#define LAYERS 2
#endif

const vec3 C_VOID  = vec3(0.027, 0.039, 0.122);
const vec3 C_DEEP  = vec3(0.043, 0.063, 0.188);
const vec3 C_VOLT  = vec3(0.000, 0.235, 1.000);
const vec3 C_SPARK = vec3(0.000, 1.000, 1.000);
const vec3 C_CORE  = vec3(0.918, 0.965, 1.000);
const vec3 C_ARC   = vec3(0.310, 0.765, 1.000);
const vec3 C_FLARE = vec3(1.000, 0.541, 0.357);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

// Smooth value noise for the density field (dense and sparse regions of the board).
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

// Distance from p to segment ab.
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// A hairline with a wide soft halo, in cell units (cw = one px in cell units).
float line(float d, float cw) {
  float core = exp(-d * d / (2.0 * cw * cw * 1.1));
  float halo = exp(-d * d / (2.0 * cw * cw * 45.0));
  return core + 0.12 * halo;
}

// Edge decision: the edge between cell c and its east / north neighbour, seeded per edge, thresholded by the density field.
float edgeOn(vec2 cell, float dir, float density, float seed) {
  // dir 0 = east edge of cell, 1 = north edge of cell.
  float h = hash21(cell * 1.7 + vec2(dir * 37.0 + seed * 91.0, seed * 13.0));
  return step(h, density);
}

// A signal train along a coordinate: a white head and a cyan comet tail every 1/freq units.
float train(float x, float speed, float phase) {
  float t = fract(x - u_time * speed + phase);
  return exp(-t * 9.0) * step(0.0, t);
}

struct Board { float trace; float pad; float signal; };

Board board(vec2 p, float cellSize, float seed, float parallax, float speedMul) {
  Board b;
  vec2 q = (p + vec2(0.0, parallax)) / cellSize;
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  float cw = (1.0 / u_res.y) / cellSize;

  // Density field: clusters of traces with emptier lanes between them.
  float density = 0.21 + 0.30 * vnoise(cell * 0.21 + seed * 7.0);

  // The four edges of this cell, decided per edge.
  float e = edgeOn(cell, 0.0, density, seed);
  float n = edgeOn(cell, 1.0, density, seed);
  float w = edgeOn(cell - vec2(1.0, 0.0), 0.0, density, seed);
  float s = edgeOn(cell - vec2(0.0, 1.0), 1.0, density, seed);
  float count = e + n + w + s;

  float d = 10.0;
  float pad = 0.0;
  vec2 E = vec2(0.5, 0.0), N = vec2(0.0, 0.5), W = vec2(-0.5, 0.0), S = vec2(0.0, -0.5), O = vec2(0.0);

  if (count == 2.0) {
    // Straight runs and 45° corners.
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
    // A dangling end or a junction gets a ring pad at the centre.
    float r = length(f);
    float ring = abs(r - 0.085);
    pad = exp(-ring * ring / (2.0 * cw * cw * 1.4)) + 0.5 * exp(-r * r / (2.0 * cw * cw * 1.2));
  } else {
    // Empty cell: a via, sometimes.
    float via = step(0.72, hash21(cell * 3.1 + seed));
    float r = length(f);
    pad = via * 0.45 * exp(-r * r / (2.0 * cw * cw * 1.6));
  }

  float trace = d < 5.0 ? line(d, cw) : 0.0;

  // Signals ride rows (horizontal edges) and columns (vertical edges); each row/column has its own phase and duty.
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

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;

  // Ground: night, a little lighter toward the bottom.
  vec3 col = mix(C_VOID, C_DEEP, smoothstep(1.0, 0.0, uv.y) * 0.85);

  // Two auroras, breathing.
  float bB = 0.9 + 0.1 * sin(t * 0.45 + u_seed.x * 6.283);
  float bC = 0.9 + 0.1 * sin(t * 0.39 + u_seed.y * 6.283 + 1.7);
  vec2 cB = vec2(0.90 * aspect, 0.12);
  vec2 cC = vec2(0.08 * aspect, 0.92);
  float aB = exp(-dot(p - cB, p - cB) * 2.4) * 0.30 * bB;
  float aC = exp(-dot(p - cC, p - cC) * 3.4) * 0.10 * bC;
  col += mix(C_VOLT, C_FLARE, u_warmth * 0.35) * aB + C_SPARK * aC;

  // The calm rect under the headline, and the pointer charge.
  // The top of every screen carries the seat and the readout, so the board
  // is held down there; it comes up through the lower half.
  float calm = mix(0.22, 1.0, smoothstep(0.86, 0.30, uv.y));
  vec2 ptr = vec2(u_touch.x * aspect, u_touch.y);
  float hot = u_touch.z * exp(-dot(p - ptr, p - ptr) * 28.0);

  // The block burst: a front sweeping top to bottom as the pulse decays.
  float front = 1.05 - (1.0 - u_pulse) * 1.15;
  float frontGlow = u_pulse > 0.003 ? exp(-abs(uv.y - front) * 14.0) * u_pulse : 0.0;
  float behind = u_pulse > 0.003 ? smoothstep(front - 0.02, front + 0.35, uv.y) * u_pulse : 0.0;
  float flash = u_pulse * u_pulse * 0.05;

  vec3 lattice = vec3(0.0);
  for (int i = 0; i < LAYERS; i++) {
    float fi = float(i);
    bool far = (LAYERS > 1) && (i == 0);
    float cellSize = far ? 0.056 : 0.096;
    float depth = far ? 0.30 : 1.0;
    float parallax = far ? t * 0.006 : t * 0.011;
    float seed = far ? u_seed.z : u_seed.w;
    Board b = board(p, cellSize, seed, parallax, 1.0 + hot * 3.0 + behind * 1.5);
    vec3 traceTint = mix(C_VOLT, C_ARC, far ? 0.25 : 0.55 + 0.45 * hot);
    float traceAmp = (far ? 0.18 : 0.30) * (1.0 + 1.6 * hot + 2.2 * frontGlow);
    lattice += traceTint * b.trace * traceAmp * depth;
    lattice += mix(C_ARC, C_SPARK, 0.5) * b.pad * (far ? 0.22 : 0.42) * (1.0 + 2.0 * frontGlow + hot) * depth;
    float sig = b.signal * (1.0 + 3.0 * behind + 1.5 * hot);
    lattice += mix(C_SPARK, C_CORE, clamp(sig * 0.9, 0.0, 1.0)) * sig * (far ? 0.55 : 1.0) * depth;
  }

  col += lattice * calm;
  col += (C_SPARK * 0.5 + C_CORE * 0.5) * flash * calm;

  // Vignette + a little grain so the base is never flat.
  float vig = smoothstep(1.5, 0.35, length(uv - vec2(0.5, 0.45)) * 1.3);
  col = mix(C_VOID, col, vig);
  float grain = (hash21(gl_FragCoord.xy + fract(t)) - 0.5) * 0.015;
  col += grain;

  fragColor = vec4(col, 1.0);
}
`
