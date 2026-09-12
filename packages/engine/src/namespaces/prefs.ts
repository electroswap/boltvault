/**
 * UI preferences (plan B2): remembered choices that are not settings — the
 * Home chain scope, the dismissed first-swap coach, the chart timeframe,
 * whether portfolio totals are hidden. One small persisted document, one event.
 */
import type { Platform } from '@boltvault/platform'
import type { EventBus, NamespaceSpec } from '../host'
import { PrefsSchema, type Prefs } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'

export const DEFAULT_PREFS: Prefs = { homeScope: 52014, swapCoachDismissed: false, chartDuration: '1D', introSeen: false, hideBalances: false }
const DOC: DocSpec<Prefs> = { key: 'ui.prefs', version: 1, schema: PrefsSchema, defaultValue: () => DEFAULT_PREFS }

export class PrefsService {
  private cached: Prefs | null = null

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
  ) {}

  async get(): Promise<Prefs> {
    if (this.cached) return this.cached
    this.cached = (await readDoc(this.platform.storage.local, DOC, () => this.platform.now())).value
    return this.cached
  }

  async set(patch: Partial<Prefs>): Promise<Prefs> {
    const next = PrefsSchema.parse({ ...(await this.get()), ...patch })
    this.cached = next
    await writeDoc(this.platform.storage.local, DOC, next)
    this.bus.emit({ type: 'prefs.changed', prefs: next })
    return next
  }
}

export function prefsNamespace(p: PrefsService): NamespaceSpec {
  return {
    get: { handler: () => p.get() },
    set: { input: PrefsSchema.partial(), handler: (arg) => p.set(arg as Partial<Prefs>) },
  }
}
