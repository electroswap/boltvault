/**
 * Settings document — validated defaults, persisted in platform local storage,
 * change events on the bus. `normalizeSettings` (kept from the prototype) does
 * the field-by-field defaulting and enum clamping.
 */
import { normalizeSettings } from '@boltvault/settings'
import type { Platform } from '@boltvault/platform'
import type { EventBus } from './host'
import { SettingsSchema, type Settings } from './schema'
import { readDoc, writeDoc, type DocSpec } from './storage'

const SETTINGS_DOC: DocSpec<Settings> = {
  key: 'settings',
  version: 1,
  schema: SettingsSchema,
  defaultValue: () => normalizeSettings(null),
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
    // reducedMotion is owned by the OS, never by a caller.
    const { reducedMotion: _ignored, ...rest } = patch
    const next = normalizeSettings({ ...current, ...rest }, this.os)
    this.cached = next
    await writeDoc(this.platform.storage.local, SETTINGS_DOC, next)
    this.bus.emit({ type: 'settings.changed', settings: next })
    return next
  }
}
