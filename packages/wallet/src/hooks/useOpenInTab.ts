/**
 * "Open in a full tab" (plan B2, owner item G4): only the popup offers it;
 * the tab and the phone are already full. With no target it re-opens the
 * screen the popup is on, params included.
 */
import { useHost } from '../host'
import type { ScreenId, ScreenParams } from '../navigation/registry'
import { useRouter } from '../navigation/router'

export type OpenInTab = (target?: { screen?: ScreenId; params?: ScreenParams[ScreenId] }) => void

export function useOpenInTab(): OpenInTab | null {
  const host = useHost()
  const router = useRouter()
  if (host.body !== 'extension-popup' || !host.openInTab) return null
  const open = host.openInTab
  return (target) => {
    const screen = target?.screen ?? router.current.screen
    const params = target ? target.params : router.current.params
    open({ tab: router.state.tab, screen, ...(params === undefined ? {} : { params }) })
  }
}
