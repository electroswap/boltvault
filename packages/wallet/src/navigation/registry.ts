/**
 * Screen registry — declared once, mounted by every body (master plan §2.5).
 * Params are typed per screen so a deep link, a push and a test all agree.
 * `dock` says whether the tab bar stays under a screen; `grid` whether the
 * Field (the Grid) renders behind it (plan B2).
 */
import type { IconName } from '@boltvault/ui'

export type TabId = 'home' | 'swap' | 'activity'

export interface ScreenParams {
  home: undefined
  portfolio: undefined
  swap: { tokenIn?: string; tokenOut?: string } | undefined
  explore: { segment?: 'tokens' | 'collectibles' | 'launch' | 'farms'; search?: boolean } | undefined
  collection: { chainId: number; address: string }
  nft: { chainId: number; address: string; tokenId: string }
  rack: undefined
  offers: undefined
  farm: { chainId: number; farmId: number }
  campaign: { chainId: number; pool: string }
  legends: undefined
  alerts: undefined
  bridge: { chainId?: number; token?: string } | undefined
  networks: undefined
  addressBook: undefined
  browser: { url?: string } | undefined
  feel: undefined
  about: undefined
  activity: undefined
  settings: undefined
  security: undefined
  devices: undefined
  sites: undefined
  allowances: undefined
  spending: undefined
  accounts: undefined
  backup: undefined
  unlock: undefined
  receive: { token?: string; chainId?: number } | undefined
  send: { token?: string; to?: string; requestId?: string; chainId?: number } | undefined
  token: { chainId: number; address: string }
  sign: { requestId: string } | undefined
  /**
   * The popup renders no secrets, so it hands the whole choice to `tab.html`
   * rather than making the user press "Create a new vault" a second time there.
   * `clampEntryStep` in the screen decides which steps a URL may name.
   */
  onboarding: { path?: 'create' | 'import' | 'watch'; step?: string } | undefined
  moments: undefined
  splash: undefined
}

export type ScreenId = keyof ScreenParams

export type Presentation = 'tab' | 'push' | 'sheet' | 'window'

export interface ScreenMeta {
  readonly id: ScreenId
  readonly presentation: Presentation
  /** Quiet custody mode: the Field dims, no heartbeat, no discharge (§7.9). */
  readonly quiet: boolean
  /** Secrets (seed words, exports) may render here only in a secrets-allowed surface (§3.2). */
  readonly secrets: boolean
  /** The tab bar stays under this screen (plan B2). */
  readonly dock: boolean
  /** The Grid renders behind this screen. Default on: it is the still surface every page sits on. */
  readonly grid: boolean
  /**
   * A darker plate over the Grid so small type reads. The scene still shows
   * through; this is not Off and not quiet custody — just contrast.
   */
  readonly veil: boolean
}

const meta = (id: ScreenId, presentation: Presentation, opts: Partial<Omit<ScreenMeta, 'id' | 'presentation'>> = {}): ScreenMeta => ({ id, presentation, quiet: false, secrets: false, dock: presentation === 'tab' || presentation === 'push', grid: true, veil: false, ...opts })

export const SCREENS: Record<ScreenId, ScreenMeta> = {
  home: meta('home', 'tab'),
  portfolio: meta('portfolio', 'push'),
  swap: meta('swap', 'tab'),
  explore: meta('explore', 'push'),
  activity: meta('activity', 'tab'),
  settings: meta('settings', 'push'),
  security: meta('security', 'push', { quiet: true, secrets: true }),
  devices: meta('devices', 'push'),
  sites: meta('sites', 'push'),
  allowances: meta('allowances', 'push'),
  spending: meta('spending', 'push'),
  collection: meta('collection', 'push'),
  nft: meta('nft', 'push', { veil: true }),
  rack: meta('rack', 'push'),
  offers: meta('offers', 'push'),
  farm: meta('farm', 'push'),
  campaign: meta('campaign', 'push'),
  legends: meta('legends', 'push'),
  alerts: meta('alerts', 'push'),
  bridge: meta('bridge', 'push'),
  networks: meta('networks', 'push'),
  addressBook: meta('addressBook', 'push'),
  browser: meta('browser', 'push', { dock: false }),
  feel: meta('feel', 'push'),
  about: meta('about', 'push'),
  accounts: meta('accounts', 'sheet', { secrets: true }),
  backup: meta('backup', 'push', { quiet: true, secrets: true, dock: false }),
  unlock: meta('unlock', 'window', { quiet: true }),
  receive: meta('receive', 'push', { dock: false }),
  send: meta('send', 'push'),
  token: meta('token', 'push', { veil: true }),
  sign: meta('sign', 'window', { quiet: true }),
  onboarding: meta('onboarding', 'push', { quiet: true, secrets: true, dock: false }),
  moments: meta('moments', 'push', { dock: false }),
  /* Not reachable from the product — the phone shows it while the engine boots. Registered so the screenshot harness can render it. */
  splash: meta('splash', 'push', { dock: false, quiet: true }),
}

export const TABS: Record<TabId, { screen: ScreenId; icon: IconName; labelId: string; labelMessage: string }> = {
  home: { screen: 'home', icon: 'home', labelId: 'tab.home', labelMessage: 'Home' },
  swap: { screen: 'swap', icon: 'swap', labelId: 'tab.swap', labelMessage: 'Swap' },
  activity: { screen: 'activity', icon: 'activity', labelId: 'tab.activity', labelMessage: 'Activity' },
}

/** The dock, in order (plan B2): Home · Swap · Activity. Every body derives its tabs from this. */
export const TAB_ORDER: readonly TabId[] = ['home', 'swap', 'activity']

export function isTabId(x: string): x is TabId {
  return (TAB_ORDER as readonly string[]).includes(x)
}

export function isScreenId(x: string): x is ScreenId {
  return Object.prototype.hasOwnProperty.call(SCREENS, x)
}
