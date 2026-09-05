#!/usr/bin/env node
// Placeholder extension icons until the M1 mark lands: a bolt in `arc` on
// `void`, rasterised with a scanline fill and encoded as PNG with zlib only.
// Deterministic output, no image libraries, so the build never depends on a
// binary asset nobody can regenerate.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VOID = [0x06, 0x09, 0x13]
const ARC = [0x5f, 0xd8, 0xff]
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

function inside(x, y) {
  // even-odd point-in-polygon
  let hit = false
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i]
    const [xj, yj] = BOLT[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function png(size) {
  const ss = 4 // supersampling for soft edges
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      let cover = 0
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) if (inside((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)) cover++
      const a = cover / (ss * ss)
      // rounded-square background: corner radius 22%
      const r = size * 0.22
      const dx = Math.max(r - x - 0.5, x + 0.5 - (size - r), 0)
      const dy = Math.max(r - y - 0.5, y + 0.5 - (size - r), 0)
      const bg = dx * dx + dy * dy <= r * r ? 255 : 0
      for (let c = 0; c < 3; c++) row.push(Math.round(VOID[c] * (1 - a) + ARC[c] * a))
      row.push(bg)
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
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = join(process.cwd(), 'apps', 'extension', 'public', 'icon')
mkdirSync(out, { recursive: true })
for (const size of [16, 32, 48, 128]) writeFileSync(join(out, `${size}.png`), png(size))
console.log(`icons written to ${out}`)
