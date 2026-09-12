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
const sameSet = (a: readonly unknown[], b: readonly number[]): boolean =>
  a.length === b.length && b.every((x) => a.includes(x))

/** A send allow-list entry as it is stored: one lowercase EVM address. */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DEFAULT_LARGE_SEND_PERCENT = 10
const MAX_ALLOW_LIST = 64

/**
 * The spend policy's own defaulting (§3.4 point 6).
 *
 * `normalizeSettings` belongs to `@boltvault/settings` and returns exactly the
 * fields *it* declares, so anything added to the engine's schema and passed
 * through it comes back missing — which would silently reset the allow-list
 * and the threshold on every unrelated settings write. These two are therefore
 * clamped here, field by field, in the same spirit.
 *
 * Addresses are lowercased and de-duplicated so the firewall's membership test
 * is a plain comparison, and capped so the list stays something a person can
 * read through before trusting it.
 */
function spendPolicy(
  raw: Partial<Settings> | null | undefined,
): Pick<Settings, 'sendAllowList' | 'largeSendPercent'> {
  const percent = raw?.largeSendPercent
  const list = Array.isArray(raw?.sendAllowList) ? raw.sendAllowList : []
  const seen = new Set<string>()
  for (const entry of list) {
    if (typeof entry !== 'string' || !ADDRESS.test(entry)) continue
    seen.add(entry.toLowerCase())
    if (seen.size >= MAX_ALLOW_LIST) break
  }
  return {
    sendAllowList: [...seen],
    largeSendPercent:
      typeof percent === 'number' && Number.isInteger(percent) && percent >= 1 && percent <= 100
        ? percent
        : DEFAULT_LARGE_SEND_PERCENT,
  }
}

const SETTINGS_DOC: DocSpec<Settings> = {
  key: 'settings',
  version: 2,
  schema: SettingsSchema,
  defaultValue: () => ({ ...normalizeSettings(null), ...spendPolicy(null) }),
  migrate: (data, from) => {
    if (from !== 1 || typeof data !== 'object' || data === null) return data
    const d: Record<string, unknown> = { ...(data as Record<string, unknown>) }
    // v1 timers were absolute, not idle: every v1 choice was shorter than the user meant. One notch up.
    const v1 = d['autoLock']
    d['autoLock'] =
      typeof v1 === 'string'
        ? (LEGACY_AUTO_LOCK[v1] ??
          ({ '5min': '15min', never: 'never' } as Record<string, string>)[v1] ??
          '15min')
        : '15min'
    if (Array.isArray(d['enabledChains']) && sameSet(d['enabledChains'], V1_DEFAULT_CHAINS))
      d['enabledChains'] = [1, 56, 8453]
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
    const { value, migrated } = await readDoc(this.platform.storage.local, SETTINGS_DOC, () =>
      this.platform.now(),
    )
    const normalized = { ...normalizeSettings(value, this.os), ...spendPolicy(value) }
    this.cached = normalized
    if (migrated) await writeDoc(this.platform.storage.local, SETTINGS_DOC, normalized)
    return normalized
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get()
    const merged = { ...current, ...patch }
    const next = { ...normalizeSettings(merged, this.os), ...spendPolicy(merged) }
    this.cached = next
    await writeDoc(this.platform.storage.local, SETTINGS_DOC, next)
    this.bus.emit({ type: 'settings.changed', settings: next })
    return next
  }
}
