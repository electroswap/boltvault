/**
 * Settings document — validated defaults, persisted in platform local storage,
 * change events on the bus. `normalizeSettings` (kept from the prototype) does
 * the field-by-field defaulting and enum clamping.
 */
import { LEGACY_AUTO_LOCK, normalizeSettings } from '@boltvault/settings'
import type { Platform } from '@boltvault/platform'
import type { EventBus } from './host'
import { SettingsSchema, type Settings } from './schema'
import { readDoc, writeDoc, type DocSpec } from './storage'

/** The v1 default network set; a user still on it moves to the v2 default, a custom set is kept. */
const V1_DEFAULT_CHAINS = [1, 56, 8453, 42161, 10, 137, 43114]
const sameSet = (a: readonly unknown[], b: readonly number[]): boolean => a.length === b.length && b.every((x) => a.includes(x))

const SETTINGS_DOC: DocSpec<Settings> = {
  key: 'settings',
  version: 2,
  schema: SettingsSchema,
  defaultValue: () => normalizeSettings(null),
  migrate: (data, from) => {
    if (from !== 1 || typeof data !== 'object' || data === null) return data
    const d: Record<string, unknown> = { ...(data as Record<string, unknown>) }
    // v1 timers were absolute, not idle: every v1 choice was shorter than the user meant. One notch up.
    const v1 = d['autoLock']
    d['autoLock'] = typeof v1 === 'string' ? (LEGACY_AUTO_LOCK[v1] ?? ({ '5min': '15min', never: 'never' } as Record<string, string>)[v1] ?? '15min') : '15min'
    if (Array.isArray(d['enabledChains']) && sameSet(d['enabledChains'], V1_DEFAULT_CHAINS)) d['enabledChains'] = [1, 56, 8453]
    // v1 never let the user set reducedMotion (it was re-derived on every write): start v2 from off; the UI also honours the system preference.
    d['reducedMotion'] = false
    return d
  },
}

export class SettingsStore {
  private cached: Settings | null = null

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly os: { reducedMotion: boolean } = { reducedMotion: false },
  ) {}

  async get(): Promise<Settings> {
    if (this.cached) return this.cached
    const { value, migrated } = await readDoc(this.platform.storage.local, SETTINGS_DOC, () => this.platform.now())
    const normalized = normalizeSettings(value, this.os)
    this.cached = normalized
    if (migrated) await writeDoc(this.platform.storage.local, SETTINGS_DOC, normalized)
    return normalized
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get()
    const next = normalizeSettings({ ...current, ...patch }, this.os)
    this.cached = next
    await writeDoc(this.platform.storage.local, SETTINGS_DOC, next)
    this.bus.emit({ type: 'settings.changed', settings: next })
    return next
  }
}
