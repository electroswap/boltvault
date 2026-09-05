/**
 * TabShell — mounts the four tabs and the push stack for every body. While
 * the vault exists but is locked, every surface except onboarding/harness
 * screens is replaced by Unlock. A pending dApp approval takes over the
 * popup and the mobile body (the sign window mounts it by route).
 */
import { Column, TabBar } from '@boltvault/ui'
import { t } from '../i18n'
import { Accounts } from '../screens/Accounts'
import { Approval } from '../screens/Approval'
import { Backup } from '../screens/Backup'
import { ConnectedSites } from '../screens/ConnectedSites'
import { Devices } from '../screens/Devices'
import { Home, type HomeProps } from '../screens/Home'
import { Moments } from '../screens/Moments'
import { Onboarding } from '../screens/Onboarding'
import { Security } from '../screens/Security'
import { ActivityShell, ExploreShell, PlaceholderScreen, SettingsShell, SwapShell } from '../screens/shells'
import { Unlock } from '../screens/Unlock'
import { useApprovals } from '../state/useApprovals'
import { useWalletState } from '../state/useWalletState'
import { TABS, TAB_ORDER, type TabId } from './registry'
import { useRouter } from './router'

export interface TabShellProps {
  readonly body: HomeProps['body']
  readonly reducedMotionOverride?: boolean
}

export function TabShell({ body, reducedMotionOverride }: TabShellProps) {
  const router = useRouter()
  const { vault, loading } = useWalletState()
  const { pending } = useApprovals()
  const { current, state } = router
  const items = TAB_ORDER.map((id) => ({ id, label: t({ id: TABS[id].labelId, message: TABS[id].labelMessage }), icon: TABS[id].icon }))
  const showTabs = state.stack.length === 0

  const locked = !loading && !!vault?.exists && !vault.unlocked
  if (locked && current.screen !== 'onboarding' && current.screen !== 'moments') {
    return <Unlock body={body} reducedMotion={reducedMotionOverride} />
  }

  // A dApp is waiting: the popup and the phone show the sheet over everything (§8.15).
  if (pending.length > 0 && body !== 'extension-tab' && current.screen !== 'sign' && current.screen !== 'onboarding' && current.screen !== 'moments') {
    return <Approval body={body} reducedMotion={reducedMotionOverride} />
  }

  let screen: React.ReactNode
  switch (current.screen) {
    case 'home':
      screen = <Home body={body} reducedMotionOverride={reducedMotionOverride} />
      break
    case 'swap':
      screen = <SwapShell body={body} />
      break
    case 'explore':
      screen = <ExploreShell body={body} />
      break
    case 'activity':
      screen = <ActivityShell body={body} />
      break
    case 'settings':
      screen = <SettingsShell body={body} />
      break
    case 'security':
      screen = <Security body={body} />
      break
    case 'devices':
      screen = <Devices body={body} />
      break
    case 'sites':
      screen = <ConnectedSites body={body} />
      break
    case 'accounts':
      screen = <Accounts body={body} />
      break
    case 'backup':
      screen = <Backup reducedMotion={reducedMotionOverride} />
      break
    case 'unlock':
      screen = <Unlock body={body} reducedMotion={reducedMotionOverride} />
      break
    case 'onboarding':
      screen = <Onboarding reducedMotion={reducedMotionOverride} />
      break
    case 'moments':
      screen = <Moments reducedMotion={reducedMotionOverride} />
      break
    case 'sign': {
      const requestId = (current.params as { requestId?: string } | undefined)?.requestId
      screen = <Approval body={body} reducedMotion={reducedMotionOverride} {...(requestId ? { requestId } : {})} />
      break
    }
    case 'receive':
      screen = <PlaceholderScreen body={body} title={t({ id: 'receive.title', message: 'Receive' })} note={t({ id: 'receive.soon', message: 'Receive lands with the M4 milestone.' })} />
      break
    case 'send':
      screen = <PlaceholderScreen body={body} title={t({ id: 'send.title', message: 'Send' })} note={t({ id: 'send.soon', message: 'Send lands with the M4 milestone.' })} />
      break
    case 'token':
      screen = <PlaceholderScreen body={body} title={t({ id: 'token.title', message: 'Token' })} note={t({ id: 'token.soon', message: 'The token dossier lands with the M4 milestone.' })} />
      break
  }

  return (
    <Column flex={1} backgroundColor="$void">
      <Column flex={1}>{screen}</Column>
      {showTabs ? <TabBar items={items} activeId={state.tab} onSelect={(id) => router.setTab(id as TabId)} testID="tabs" /> : null}
    </Column>
  )
}
