/**
 * Preferences survive gaining a key.
 *
 * `readDoc` quarantines a document that does not parse and hands back the
 * defaults — so a REQUIRED new key silently resets everyone's home scope and
 * chart timeframe on upgrade, and nothing fails loudly enough to notice. The
 * intro flag is `z.boolean().default(false)` for exactly this reason, and this
 * test is what keeps the next key honest too.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '../src/namespaces/prefs'
import { PrefsSchema } from '../src/schema'
import { readDoc, writeDoc, type DocSpec } from '../src/storage'

const DOC: DocSpec<typeof DEFAULT_PREFS> = { key: 'ui.prefs', version: 1, schema: PrefsSchema, defaultValue: () => DEFAULT_PREFS }

describe('the preferences document', () => {
  it('reads a document written before `introSeen` existed, without quarantining it', async () => {
    const platform = createMemoryPlatform()
    // Exactly what a shipped install has on disk today.
    await platform.storage.local.set(DOC.key, JSON.stringify({ v: 1, data: { homeScope: 1, swapCoachDismissed: true, chartDuration: '1W' } }))

    const read = await readDoc(platform.storage.local, DOC)
    expect(read.quarantined).toBe(false)
    // The settings the user actually chose survive...
    expect(read.value.homeScope).toBe(1)
    expect(read.value.swapCoachDismissed).toBe(true)
    expect(read.value.chartDuration).toBe('1W')
    // ...and the new key arrives with its default rather than as undefined.
    expect(read.value.introSeen).toBe(false)
  })

  it('round-trips the flag once it has been set', async () => {
    const platform = createMemoryPlatform()
    await writeDoc(platform.storage.local, DOC, { ...DEFAULT_PREFS, introSeen: true })
    const read = await readDoc(platform.storage.local, DOC)
    expect(read.quarantined).toBe(false)
    expect(read.value.introSeen).toBe(true)
  })

  it('still quarantines a document that is genuinely wrong', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.local.set(DOC.key, JSON.stringify({ v: 1, data: { homeScope: 'nonsense', swapCoachDismissed: 'yes' } }))
    const read = await readDoc(platform.storage.local, DOC)
    expect(read.quarantined).toBe(true)
    expect(read.value).toEqual(DEFAULT_PREFS)
  })
})
