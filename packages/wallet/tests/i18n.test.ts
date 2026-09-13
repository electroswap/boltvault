/**
 * `t()` — the one string path every surface uses.
 *
 * The behaviour worth pinning is the quiet one: an untranslated id must render
 * its source copy WITHOUT going through Lingui's message compiler, because
 * with no compiler installed that logs "Uncompiled message detected!" for every
 * string on every render. The extension's console was nothing else.
 */
import { describe, expect, it, vi } from 'vitest'
import { setupI18n, t } from '../src/i18n'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import catalog from '../locales/en/messages.json'

describe('t()', () => {
  it('renders the source copy for an untranslated id, and says nothing about it', () => {
    setupI18n('en', {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(t({ id: 'home.receive', message: 'Receive' })).toBe('Receive')
      expect(t({ id: 'home.unpriced', message: '{n} without price', values: { n: 3 } })).toBe('3 without price')
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('fills every placeholder, including one used twice', () => {
    setupI18n('en', {})
    expect(t({ id: 'x', message: '{a} then {b} then {a}', values: { a: 'one', b: 'two' } })).toBe('one then two then one')
  })

  it('prefers a loaded catalog over the source copy', () => {
    setupI18n('fr', { 'home.receive': 'Recevoir' })
    expect(t({ id: 'home.receive', message: 'Receive' })).toBe('Recevoir')
    // Back to the source locale so the rest of the suite is unaffected.
    setupI18n('en', {})
  })

  it('falls back to the id when a descriptor carries no source copy', () => {
    setupI18n('en', {})
    expect(t({ id: 'only.an.id' })).toBe('only.an.id')
  })
})

/**
 * Every descriptor in the source reaches the catalogue.
 *
 * `tools/i18n-extract.mjs` reads messages with a regex, and a message it
 * cannot parse used to be skipped in silence — the string still rendered, in
 * English, in every locale, with nothing anywhere saying so. Two had been lost
 * that way (`trezor.body`, `moments.criterion.discharge`), both because an
 * apostrophe pushed the author to double quotes.
 *
 * The extractor now refuses to write a catalogue while any descriptor is
 * unreadable, but that only fires when someone runs it. This is the half that
 * runs in CI: it scans for ids alone — a far simpler pattern than the message
 * one, and so not the thing that can drift — and asks the catalogue for each.
 */
describe('the en catalogue', () => {
  const SRC = fileURLToPath(new URL('../src', import.meta.url))
  const ID = /t\(\s*\{\s*id:\s*'([^']+)'/g

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) yield* walk(p)
      else if (/\.(ts|tsx)$/.test(name)) yield p
    }
  }

  it('carries every id the source asks for', () => {
    const known = new Set(Object.keys(catalog as Record<string, string>))
    const missing: string[] = []
    for (const file of walk(SRC)) {
      for (const m of readFileSync(file, 'utf8').matchAll(ID)) {
        const id = m[1]
        if (id !== undefined && !known.has(id)) missing.push(`${id} (${file.slice(SRC.length + 1)})`)
      }
    }
    // Run `pnpm i18n:extract`; if it refuses, it will name the line to rewrite.
    expect(missing).toEqual([])
  })
})
