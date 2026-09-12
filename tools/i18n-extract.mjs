#!/usr/bin/env node
// Extract `t({ id: '…', message: '…' })` descriptors from packages/wallet into
// the Lingui `en` source catalog (PO) and a compiled JSON catalog the app
// loads. Lingui's own extractor only sees its macros; this repo deliberately
// avoids the macro toolchain (plan §7.14) so the same source builds under
// Vite and Metro without extra Babel plugins.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'packages', 'wallet', 'src')
const OUT_DIR = join(ROOT, 'packages', 'wallet', 'locales', 'en')
const RE =
  /t\(\s*\{\s*id:\s*'([^']+)'\s*,\s*message:\s*(?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(name)) yield p
  }
}

const messages = new Map()
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(RE)) {
    const id = m[1]
    const message = (m[2] ?? m[3] ?? '').replace(/\\'/g, "'")
    const prev = messages.get(id)
    if (prev && prev.message !== message) {
      console.error(
        `i18n: id "${id}" has two different source messages (${prev.file} vs ${relative(ROOT, file)})`,
      )
      process.exit(1)
    }
    messages.set(id, { message, file: relative(ROOT, file) })
  }
}

mkdirSync(OUT_DIR, { recursive: true })
const po = [
  'msgid ""',
  'msgstr ""',
  '"Language: en\\n"',
  '"Content-Type: text/plain; charset=utf-8\\n"',
  '',
]
const compiled = {}
for (const [id, { message, file }] of [...messages.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  po.push(
    `#: ${file}`,
    `msgctxt "${id}"`,
    `msgid "${message.replace(/"/g, '\\"')}"`,
    `msgstr "${message.replace(/"/g, '\\"')}"`,
    '',
  )
  compiled[id] = message
}
writeFileSync(join(OUT_DIR, 'messages.po'), `${po.join('\n')}\n`)
writeFileSync(join(OUT_DIR, 'messages.json'), `${JSON.stringify(compiled, null, 2)}\n`)
console.log(`i18n: ${messages.size} messages → ${relative(ROOT, OUT_DIR)}`)
