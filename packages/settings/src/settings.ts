/**
 * Settings (T6.6) — normalization + per-origin chain editor.
 *
 * `normalizeSettings` turns stored (possibly partial/corrupt) JSON into a valid
 * `BoltVaultSettings`, applying defaults field-by-field and clamping enums. The
 * per-origin chain editor re-seats a connected site's `chainId` (design:
 * per-origin re-seat) and the connected-sites list is origin-scoped.
 */
import type { AutoLock, BoltVaultSettings, ConnectedSite } from '@boltvault/core'
import { DEFAULT_SETTINGS } from '@boltvault/core'

const AUTO_LOCKS: readonly AutoLock[] = ['background', '5min', '15min', '60min', 'never']
/** Pre-idle-timer values (absolute timers, every one shorter than the user meant): one notch up. */
export const LEGACY_AUTO_LOCK: Readonly<Record<string, AutoLock>> = { immediately: '5min', '1min': '5min', '30min': '60min' }
const CURRENCIES = ['USD', 'ETN'] as const
const SCENES = ['circuit', 'grid', 'off'] as const

/**
 * Normalize a raw stored settings object (string JSON or object) into a valid
 * `BoltVaultSettings`. Unknown/missing fields fall back to `DEFAULT_SETTINGS`;
 * enums are clamped to their valid set. `reducedMotion` is the stored choice;
 * `os.reducedMotion` (the system preference) is only its default.
 */
export function normalizeSettings(
  raw: string | Record<string, unknown> | null | undefined,
  os: { reducedMotion?: boolean; body?: 'extension' | 'mobile' } = {},
): BoltVaultSettings {
  let obj: Record<string, unknown>
  if (raw == null) obj = {}
  else if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>
    } catch {
      obj = {}
    }
  } else {
    obj = raw
  }

  const bool = (k: keyof BoltVaultSettings, dflt: boolean): boolean => {
    const v = obj[k]
    return typeof v === 'boolean' ? v : dflt
  }

  const autoLockRaw = obj['autoLock']
  /*
    A phone's default is the idle timer, same as everywhere else.

    It used to be "on leaving" (ES-BV-041), reasoning that an idle timer is the
    extension's control and that a wallet left open on a table should not be
    waiting out fifteen minutes. That reasoning is sound and the setting is
    still there — one tap in Settings › Security — but as a *default* it cost
    more than it bought. Android reports `background` for a great deal that is
    not the user walking away: the QR scanner, the share sheet, `openURL`, and
    every WalletConnect deep-link round trip. So the wallet locked itself in the
    middle of the flows that need it most, and the tester who hit it was the one
    who had already moved off the default.

    The idle timer is only now worth defaulting to: until this release nothing
    on the phone called `vault.touch()`, so "15 minutes" meant fifteen minutes
    after unlocking rather than fifteen idle ones. With the shell's touch
    handler feeding it, the timer measures what its name claims.
  */
  const fallbackAutoLock: AutoLock = DEFAULT_SETTINGS.autoLock
  const autoLock: AutoLock =
    typeof autoLockRaw === 'string' && (AUTO_LOCKS as readonly string[]).includes(autoLockRaw)
      ? (autoLockRaw as AutoLock)
      : (typeof autoLockRaw === 'string' && LEGACY_AUTO_LOCK[autoLockRaw]) || fallbackAutoLock

  const curRaw = obj['displayCurrency']
  const displayCurrency =
    typeof curRaw === 'string' && (CURRENCIES as readonly string[]).includes(curRaw)
      ? (curRaw as 'USD' | 'ETN')
      : DEFAULT_SETTINGS.displayCurrency

  const sceneRaw = obj['scene']
  const scene = typeof sceneRaw === 'string' && (SCENES as readonly string[]).includes(sceneRaw) ? (sceneRaw as 'circuit' | 'grid' | 'off') : DEFAULT_SETTINGS.scene

  return {
    defaultWallet: bool('defaultWallet', DEFAULT_SETTINGS.defaultWallet),
    metaMaskCompat: bool('metaMaskCompat', DEFAULT_SETTINGS.metaMaskCompat),
    ethSignEnabled: bool('ethSignEnabled', DEFAULT_SETTINGS.ethSignEnabled),
    txPreview: obj.txPreview === 'off' ? 'off' : DEFAULT_SETTINGS.txPreview,
    exactApprovals: bool('exactApprovals', DEFAULT_SETTINGS.exactApprovals),
    slippageBips: typeof obj.slippageBips === 'number' && Number.isInteger(obj.slippageBips) && obj.slippageBips >= 1 && obj.slippageBips <= 5_000 ? obj.slippageBips : DEFAULT_SETTINGS.slippageBips,
    enabledChains: Array.isArray(obj.enabledChains) ? obj.enabledChains.filter((c): c is number => typeof c === 'number' && Number.isInteger(c) && c > 0) : [...DEFAULT_SETTINGS.enabledChains],
    showTestnet: bool('showTestnet', DEFAULT_SETTINGS.showTestnet),
    haptics: bool('haptics', DEFAULT_SETTINGS.haptics),
    blockTick: bool('blockTick', DEFAULT_SETTINGS.blockTick),
    sound: bool('sound', DEFAULT_SETTINGS.sound),
    pushEnabled: bool('pushEnabled', DEFAULT_SETTINGS.pushEnabled),
    crashReports: bool('crashReports', DEFAULT_SETTINGS.crashReports),
    sendWhitelist: bool('sendWhitelist', DEFAULT_SETTINGS.sendWhitelist),
    revealNeedsPassword: bool('revealNeedsPassword', DEFAULT_SETTINGS.revealNeedsPassword),
    widgetShowsTotal: bool('widgetShowsTotal', DEFAULT_SETTINGS.widgetShowsTotal),
    autoLock,
    displayCurrency,
    reducedMotion: bool('reducedMotion', typeof os.reducedMotion === 'boolean' ? os.reducedMotion : DEFAULT_SETTINGS.reducedMotion),
    scene,
  }
}

/** Serialize settings to the canonical JSON blob for the KV store. */
export function serializeSettings(s: BoltVaultSettings): string {
  return JSON.stringify(s)
}

// --- per-origin chain editor -------------------------------------------------

/** A single site re-seat (design: per-origin chain, never global). */
export interface ChainReseat {
  readonly origin: string
  readonly chainId: number
}

/**
 * Re-seat the `chainId` for ONE origin, leaving every other origin untouched.
 * Unknown origins are appended (a newly-connected site). Pure.
 */
export function reseatOriginChain(sites: readonly ConnectedSite[], reseat: ChainReseat): ConnectedSite[] {
  const exists = sites.some((s) => s.origin === reseat.origin)
  if (exists) {
    return sites.map((s) => (s.origin === reseat.origin ? { ...s, chainId: reseat.chainId } : s))
  }
  return [
    ...sites,
    {
      origin: reseat.origin,
      chainId: reseat.chainId,
      accountId: null,
      connected: false,
      permissions: [],
      connectedAt: 0,
    },
  ]
}

/** Drop an origin's session (disconnect). Pure. */
export function removeOrigin(sites: readonly ConnectedSite[], origin: string): ConnectedSite[] {
  return sites.filter((s) => s.origin !== origin)
}
