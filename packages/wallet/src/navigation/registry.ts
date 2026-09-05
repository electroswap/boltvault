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
  accounts: undefined
  receive: { token?: string } | undefined
  send: { token?: string; to?: string } | undefined
  token: { chainId: number; address: string }
  sign: { requestId: string }
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
}

export const SCREENS: Record<ScreenId, ScreenMeta> = {
  home: { id: 'home', presentation: 'tab', quiet: false },
  swap: { id: 'swap', presentation: 'tab', quiet: false },
  explore: { id: 'explore', presentation: 'tab', quiet: false },
  activity: { id: 'activity', presentation: 'tab', quiet: false },
  settings: { id: 'settings', presentation: 'push', quiet: false },
  accounts: { id: 'accounts', presentation: 'sheet', quiet: false },
  receive: { id: 'receive', presentation: 'push', quiet: false },
  send: { id: 'send', presentation: 'push', quiet: false },
  token: { id: 'token', presentation: 'push', quiet: false },
  sign: { id: 'sign', presentation: 'window', quiet: true },
  onboarding: { id: 'onboarding', presentation: 'push', quiet: true },
  moments: { id: 'moments', presentation: 'push', quiet: false },
}

export const TABS: Record<TabId, { screen: ScreenId; icon: IconName; labelId: string; labelMessage: string }> = {
  home: { screen: 'home', icon: 'home', labelId: 'tab.home', labelMessage: 'Home' },
  swap: { screen: 'swap', icon: 'swap', labelId: 'tab.swap', labelMessage: 'Swap' },
  explore: { screen: 'explore', icon: 'explore', labelId: 'tab.explore', labelMessage: 'Explore' },
  activity: { screen: 'activity', icon: 'activity', labelId: 'tab.activity', labelMessage: 'Activity' },
}

export const TAB_ORDER: readonly TabId[] = ['home', 'swap', 'explore', 'activity']
