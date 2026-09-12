/**
 * make-sounds — the three samples the phone may play (master plan §7.8):
 * confirm (80 ms discharge), receive (a soft two-note chime), error (a low
 * buzz). Synthesised, tiny, deterministic; committed as 16-bit mono WAVs.
 *
 *   node tools/make-sounds.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 22050
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'mobile', 'assets', 'sounds')

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function tone(ms, f, opts = {}) {
  const n = Math.round((RATE * ms) / 1000)
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const env = Math.min(1, i / (RATE * 0.004)) * Math.exp(-t * (opts.decay ?? 12))
    const freq = f * (opts.slide ? 1 + opts.slide * t : 1)
    let s = Math.sin(2 * Math.PI * freq * t)
    if (opts.square) s = Math.sign(s) * 0.6 + s * 0.4
    out[i] = s * env * (opts.gain ?? 0.5)
  }
  return out
}

const confirm = tone(80, 1320, { decay: 28, slide: 2.5, gain: 0.45 })
const receive = [...tone(110, 880, { decay: 14, gain: 0.4 }), ...tone(160, 1174.7, { decay: 10, gain: 0.4 })]
const error = tone(140, 110, { decay: 16, square: true, gain: 0.35 })

await mkdir(out, { recursive: true })
await writeFile(join(out, 'confirm.wav'), wav(confirm))
await writeFile(join(out, 'receive.wav'), wav(receive))
await writeFile(join(out, 'error.wav'), wav(error))
console.log(`sounds → ${out}`)
