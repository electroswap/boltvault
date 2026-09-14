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
/*
  A descriptor, in any of the three quote styles JavaScript offers.

  Double quotes used to be missing from this list, and the consequence was
  silent: `trezor.body` and `moments.criterion.discharge` both carry an
  apostrophe, so their authors reached for `"…"`, and both strings were skipped
  without a word and shipped as English in every locale. The `skipped` guard below
  is what makes the next one loud instead.
*/
const RE = /t\(\s*\{\s*id:\s*'([^']+)'\s*,\s*message:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g
/** Every descriptor, however its message is written — what RE is measured against. */
const ANY = /t\(\s*\{\s*id:\s*'([^']+)'/g

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(name)) yield p
  }
}

const messages = new Map()
const skipped = []
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8')
  const read = new Set()
  for (const m of src.matchAll(RE)) {
    const id = m[1]
    read.add(id)
    // Unescape whichever quote the author used, and escaped backslashes.
    const message = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\\(['"`\\])/g, '$1')
    const prev = messages.get(id)
    if (prev && prev.message !== message) {
      console.error(`i18n: id "${id}" has two different source messages (${prev.file} vs ${relative(ROOT, file)})`)
      process.exit(1)
    }
    messages.set(id, { message, file: relative(ROOT, file) })
  }
  for (const m of src.matchAll(ANY)) if (!read.has(m[1])) skipped.push(`${m[1]} (${relative(ROOT, file)})`)
}

/*
  A descriptor that is present but unreadable is worse than one that is absent:
  the string still renders, in English, in every locale, and nothing anywhere
  says so. Fail instead.
*/
if (skipped.length) {
  console.error('i18n: these descriptors could not be read, so they would ship untranslated:')
  for (const s of skipped) console.error(`  ${s}`)
  console.error('Write the message as a single-quoted, double-quoted or template string that this extractor can parse.')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
const po = ['msgid ""', 'msgstr ""', '"Language: en\\n"', '"Content-Type: text/plain; charset=utf-8\\n"', '']
const compiled = {}
for (const [id, { message, file }] of [...messages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  po.push(`#: ${file}`, `msgctxt "${id}"`, `msgid "${message.replace(/"/g, '\\"')}"`, `msgstr "${message.replace(/"/g, '\\"')}"`, '')
  compiled[id] = message
}
writeFileSync(join(OUT_DIR, 'messages.po'), `${po.join('\n')}\n`)
writeFileSync(join(OUT_DIR, 'messages.json'), `${JSON.stringify(compiled, null, 2)}\n`)
console.log(`i18n: ${messages.size} messages → ${relative(ROOT, OUT_DIR)}`)
