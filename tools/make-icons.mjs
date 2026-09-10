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
 * @param size   pixels square
 * @param shape  'rounded' (extension, iOS) | 'square' (opaque, iOS store) | 'none' (adaptive foreground, splash)
 * @param fill   'current' (cyan → violet) | 'white' (Android monochrome)
 * @param scale  bolt size relative to the frame
 * @param ground draw the void + bloom behind the bolt
 */
function png(size, { shape = 'rounded', fill = 'current', scale = 1, ground = true } = {}) {
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

      // The mark: the current, corner to corner, exactly as the bible defines it.
      const markColour = fill === 'white' ? CORE : mix(ARC, PLASMA, Math.min(1, Math.max(0, (nx + ny) / 2)))

      let px
      if (ground) {
        // Ground: void falling to deep, with a bloom under the mark so the
        // bolt reads as lit rather than pasted on.
        const base = mix(VOID, DEEP, ny)
        const d = Math.hypot(nx - 0.5, ny - 0.46)
        const bloom = Math.max(0, 1 - d / 0.62) ** 2 * 0.5
        px = mix(mix(base, ARC, bloom * 0.35), markColour, a)
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

console.log(`icons written to ${ext} and ${mob}`)
