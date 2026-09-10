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
