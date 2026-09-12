#!/usr/bin/env node
// The app marks, rasterised from geometry rather than shipped as binaries:
// a bolt in the current (cyan into violet) over the void, with a soft bloom
// behind it. Deterministic, no image libraries, so the build never depends on
// an asset nobody can regenerate.
//
// It used to write only the extension's four sizes, in the OLD palette
// (#060913 / #5FD8FF), and the phone shipped Expo's template icon — a pale blue
// "A" with the construction guides still on it. Owner: "the mobile app needs to
// have the app icon set."
//
// Every output below is derived from the same polygon and the same tokens, so
// the two bodies cannot drift apart.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// packages/ui/src/tokens.ts — the current palette, not the superseded one.
const VOID = [0x07, 0x0a, 0x1f]
const DEEP = [0x0b, 0x10, 0x30]
const ARC = [0x4f, 0xc3, 0xff]
const PLASMA = [0x8b, 0x5c, 0xf6]
const CORE = [0xea, 0xf6, 0xff]

// Bolt polygon in a 0..1 unit square (clockwise).
const BOLT = [
  [0.58, 0.06],
  [0.24, 0.56],
  [0.47, 0.56],
  [0.4, 0.94],
  [0.76, 0.42],
  [0.53, 0.42],
]
/*
  The current runs across the BOLT, not across the frame.

  It used to be `mix(ARC, PLASMA, (nx + ny) / 2)` over the whole image, and the
  bolt occupies the middle band of that — so every pixel of it landed near the
  midpoint and the mark came out a single flat periwinkle. Mapped to the
  polygon's own box it spends the whole ramp on the thing you can see: cyan at
  the strike, violet at the tail.
*/
const BOLT_BOX = { x0: 0.24, x1: 0.76, y0: 0.06, y1: 0.94 }
// The bible's signature pair (`current` in packages/ui/src/tokens.ts).
const CURRENT_FROM = [0x37, 0xa6, 0xff]
const CURRENT_TO = [0x8a, 0x4d, 0xff]

function crc32(buf) {
  let c
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = -1
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

/**
 * Distance from a point to the bolt's outline, in unit-square units.
 *
 * The glow follows the shape. A radial disc behind the mark — which is what
 * this drew before — puts most of its light where the mark is not, so it reads
 * as a purple haze with a bolt sitting in it. Light that hugs the silhouette
 * reads as the object being lit, which is the whole of the brand's argument
 * about depth: "depth comes from layered light, never from grey shadow".
 */
function edgeDistance(x, y, scale) {
  const u = (x - 0.5) / scale + 0.5
  const v = (y - 0.5) / scale + 0.5
  let best = Infinity
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i]
    const [xj, yj] = BOLT[j]
    const dx = xj - xi
    const dy = yj - yi
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((u - xi) * dx + (v - yi) * dy) / len2))
    const px = xi + t * dx - u
    const py = yi + t * dy - v
    const d = Math.hypot(px, py)
    if (d < best) best = d
  }
  return best * scale
}

/** The bolt, scaled about the centre so it can sit inside an adaptive icon's safe zone. */
function inside(x, y, scale) {
  const u = (x - 0.5) / scale + 0.5
  const v = (y - 0.5) / scale + 0.5
  let hit = false
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i]
    const [xj, yj] = BOLT[j]
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t)

/**
 * The bloom behind the mark, as `BoltMark` draws it: a radial fall from a
 * white-hot core through the arc to the plasma, over nothing. `BoltMark`'s
 * viewBox is -0.4 -0.4 1.8 1.8 with the bloom at r=0.9, so across a square
 * image the bloom radius is exactly half the frame — which is what `d` below
 * is normalised against, so the raster and the vector are the same light.
 */
/**
 * The glow at a given distance from the outline: three falls stacked, the way
 * a neon tube lights the air around it — a white-hot skin, a cyan halo, and a
 * wide violet aura. `BoltMark` draws the same thing as stacked strokes, which
 * is the vector spelling of exactly this.
 */
function glowAt(d) {
  // The same four falls `BoltMark` spells as blurred copies of the path, so
  // the still Android paints and the mark React paints are one drawing.
  const skin = Math.exp(-d / 0.02) * 0.62
  const halo = Math.exp(-d / 0.05) * 0.72 + Math.exp(-d / 0.095) * 0.38
  const aura = Math.exp(-d / 0.19) * 0.34
  const alpha = Math.min(1, skin + halo + aura)
  if (alpha <= 0.001) return { colour: PLASMA, alpha: 0 }
  // The colour is whichever fall dominates here: core, then arc, then plasma.
  const colour = mix(mix(PLASMA, ARC, Math.min(1, halo / Math.max(0.0001, halo + aura))), CORE, Math.min(1, skin / Math.max(0.0001, skin + halo + aura)))
  return { colour, alpha }
}

/**
 * @param size   pixels square
 * @param shape  'rounded' (extension, iOS) | 'square' (opaque, iOS store) | 'none' (adaptive foreground, splash)
 * @param fill   'current' (cyan → violet) | 'white' (Android monochrome)
 * @param scale  bolt size relative to the frame
 * @param ground draw the void + bloom behind the bolt
 * @param bloom  the bloom alone, over transparency — for the native splash,
 *               which composites over the window's own colour
 */
function png(size, { shape = 'rounded', fill = 'current', scale = 1, ground = true, bloom = false } = {}) {
  const ss = 4 // supersampling for soft edges
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      let cover = 0
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) if (inside((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, scale)) cover++
      const a = cover / (ss * ss)
      const nx = (x + 0.5) / size
      const ny = (y + 0.5) / size

      // The mark: the current, corner to corner of the bolt itself.
      const bx = (nx - 0.5) / scale + 0.5
      const by = (ny - 0.5) / scale + 0.5
      const tGrad = Math.min(1, Math.max(0, ((bx - BOLT_BOX.x0) / (BOLT_BOX.x1 - BOLT_BOX.x0) + (by - BOLT_BOX.y0) / (BOLT_BOX.y1 - BOLT_BOX.y0)) / 2))
      // A lit lip along the near edge, the way every raised surface carries one.
      const inner = 0
      const markColour = fill === 'white' ? CORE : mix(mix(CURRENT_FROM, CURRENT_TO, tGrad), CORE, inner)

      let px
      if (ground) {
        // Ground: void falling to deep, lit by the mark's own glow so the bolt
        // reads as a lamp in the dark rather than a sticker on a gradient.
        const base = mix(VOID, DEEP, ny)
        const g = glowAt(edgeDistance(nx, ny, scale))
        px = mix(mix(base, g.colour, g.alpha * 0.85), markColour, a)
      } else {
        px = markColour
      }

      let alpha
      if (shape === 'rounded') {
        const r = size * 0.22
        const dx = Math.max(r - x - 0.5, x + 0.5 - (size - r), 0)
        const dy = Math.max(r - y - 0.5, y + 0.5 - (size - r), 0)
        alpha = dx * dx + dy * dy <= r * r ? 255 : 0
      } else if (shape === 'square') {
        alpha = 255
      } else if (bloom) {
        // The mark over its own light, and nothing else: the native splash
        // draws this on the window colour, so the ground must not be baked in.
        const b = glowAt(edgeDistance(nx, ny, scale))
        /*
          Fade the aura to nothing before the frame ends.

          The tail of the widest fall is still about 2% plasma at the edge of
          the image, and 2% of #8B5CF6 over #070A1F is visible — the phone
          showed the splash mark as a faint lighter *square* on the window
          colour. Anything drawn over a ground it does not own has to reach
          zero inside its own box.
        */
        const edge = Math.max(Math.abs(nx - 0.5), Math.abs(ny - 0.5)) / 0.5
        const vignette = Math.min(1, Math.max(0, (0.94 - edge) / 0.24))
        const av = Math.min(1, a + b.alpha * vignette * (1 - a))
        px = av > 0 ? mix(b.colour, markColour, a / av) : markColour
        alpha = Math.round(255 * av)
      } else {
        // Foreground-only: the mark and its bloom, nothing behind it.
        alpha = Math.round(255 * (ground ? Math.min(1, a + 0) : a))
      }

      for (const c of px) row.push(Math.round(c))
      row.push(alpha)
    }
    rows.push(Buffer.from(row))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const root = process.cwd()

// The extension: four sizes, rounded, on the ground.
const ext = join(root, 'apps', 'extension', 'public', 'icon')
mkdirSync(ext, { recursive: true })
for (const size of [16, 32, 48, 128]) writeFileSync(join(ext, `${size}.png`), png(size))

// The phone.
const mob = join(root, 'apps', 'mobile', 'assets')
mkdirSync(mob, { recursive: true })
// iOS refuses an icon with alpha, so this one is opaque and full-bleed; the OS
// applies its own mask.
writeFileSync(join(mob, 'icon.png'), png(1024, { shape: 'square' }))
writeFileSync(join(mob, 'favicon.png'), png(48))
// Android adaptive: the foreground is cropped hard (the safe zone is the middle
// two-thirds), so the mark sits at half scale with nothing behind it.
writeFileSync(join(mob, 'android-icon-foreground.png'), png(432, { shape: 'none', ground: false, scale: 0.5 }))
writeFileSync(join(mob, 'android-icon-background.png'), png(432, { shape: 'square', scale: 0.0001 }))
writeFileSync(join(mob, 'android-icon-monochrome.png'), png(432, { shape: 'none', ground: false, fill: 'white', scale: 0.5 }))
// The native splash mark: the bolt alone, so it sits on the splash colour.
writeFileSync(join(mob, 'splash-icon.png'), png(512, { shape: 'none', ground: false, scale: 0.68 }))
/*
  The native splash's mark — the one Android paints from the moment the icon is
  tapped until React has a frame to give it, which on a release build is over
  two seconds. It is the same drawing as `BoltMark`, at the same proportion
  (the bolt is 1/1.8 of the frame, because that is BoltMark's viewBox), so when
  the JS splash finally mounts the mark does not move: it comes alive.

  `plugins/withNativeSplash.js` copies this into the Android project.
*/
writeFileSync(join(mob, 'splash-mark.png'), png(1024, { shape: 'none', ground: false, bloom: true, scale: 1 / 1.8 }))

console.log(`icons written to ${ext} and ${mob}`)
