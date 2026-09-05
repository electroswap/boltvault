/**
 * Screen registry — declared once, mounted by every body (master plan §2.5).
 * Params are typed per screen so a deep link, a push and a test all agree.
 */
import type { IconName } from '@boltvault/ui'

export type TabId = 'home' | 'swap' | 'explore' | 'activity'

export interface ScreenParams {
  home: undefined
  swap: { tokenIn?: string; tokenOut?: string } | undefined
  explore: undefined
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
  receive: { token?: string } | undefined
  send: { token?: string; to?: string; requestId?: string } | undefined
  token: { chainId: number; address: string }
  sign: { requestId: string } | undefined
  onboarding: undefined
  moments: undefined
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
}

export const SCREENS: Record<ScreenId, ScreenMeta> = {
  home: { id: 'home', presentation: 'tab', quiet: false, secrets: false },
  swap: { id: 'swap', presentation: 'tab', quiet: false, secrets: false },
  explore: { id: 'explore', presentation: 'tab', quiet: false, secrets: false },
  activity: { id: 'activity', presentation: 'tab', quiet: false, secrets: false },
  settings: { id: 'settings', presentation: 'push', quiet: false, secrets: false },
  security: { id: 'security', presentation: 'push', quiet: true, secrets: true },
  devices: { id: 'devices', presentation: 'push', quiet: false, secrets: false },
  sites: { id: 'sites', presentation: 'push', quiet: false, secrets: false },
  allowances: { id: 'allowances', presentation: 'push', quiet: false, secrets: false },
  spending: { id: 'spending', presentation: 'push', quiet: false, secrets: false },
  accounts: { id: 'accounts', presentation: 'sheet', quiet: false, secrets: true },
  backup: { id: 'backup', presentation: 'push', quiet: true, secrets: true },
  unlock: { id: 'unlock', presentation: 'window', quiet: true, secrets: false },
  receive: { id: 'receive', presentation: 'push', quiet: false, secrets: false },
  send: { id: 'send', presentation: 'push', quiet: false, secrets: false },
  token: { id: 'token', presentation: 'push', quiet: false, secrets: false },
  sign: { id: 'sign', presentation: 'window', quiet: true, secrets: false },
  onboarding: { id: 'onboarding', presentation: 'push', quiet: true, secrets: true },
  moments: { id: 'moments', presentation: 'push', quiet: false, secrets: false },
}

export const TABS: Record<TabId, { screen: ScreenId; icon: IconName; labelId: string; labelMessage: string }> = {
  home: { screen: 'home', icon: 'home', labelId: 'tab.home', labelMessage: 'Home' },
  swap: { screen: 'swap', icon: 'swap', labelId: 'tab.swap', labelMessage: 'Swap' },
  explore: { screen: 'explore', icon: 'explore', labelId: 'tab.explore', labelMessage: 'Explore' },
  activity: { screen: 'activity', icon: 'activity', labelId: 'tab.activity', labelMessage: 'Activity' },
}

export const TAB_ORDER: readonly TabId[] = ['home', 'swap', 'explore', 'activity']
