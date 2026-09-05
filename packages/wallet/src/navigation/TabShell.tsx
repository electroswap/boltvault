/**
 * TabShell — mounts the four tabs and the push stack for every body. The
 * popup is 360×600 with the tab bar pinned; the tab and mobile get the same
 * shell with room.
 */
import { Column, TabBar } from '@boltvault/ui'
import { t } from '../i18n'
import { Home, type HomeProps } from '../screens/Home'
import { Moments } from '../screens/Moments'
import { ActivityShell, ExploreShell, PlaceholderScreen, SettingsShell, SwapShell } from '../screens/shells'
import { TABS, TAB_ORDER, type TabId } from './registry'
import { useRouter } from './router'

export interface TabShellProps {
  readonly body: HomeProps['body']
  readonly reducedMotionOverride?: boolean
}

export function TabShell({ body, reducedMotionOverride }: TabShellProps) {
  const router = useRouter()
  const { current, state } = router
  const items = TAB_ORDER.map((id) => ({ id, label: t({ id: TABS[id].labelId, message: TABS[id].labelMessage }), icon: TABS[id].icon }))
  const showTabs = state.stack.length === 0

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
    case 'moments':
      screen = <Moments reducedMotion={reducedMotionOverride} />
      break
    case 'accounts':
      screen = <PlaceholderScreen body={body} title={t({ id: 'accounts.title', message: 'Accounts' })} note={t({ id: 'accounts.soon', message: 'The accounts sheet — every seed, key, device and watch address — lands with the M2 milestone.' })} />
      break
    case 'onboarding':
      screen = <PlaceholderScreen body={body} title={t({ id: 'onboarding.title', message: 'Create your vault' })} note={t({ id: 'onboarding.soon', message: 'Onboarding, backup quiz and passkeys land with the M2 milestone.' })} />
      break
    case 'receive':
      screen = <PlaceholderScreen body={body} title={t({ id: 'receive.title', message: 'Receive' })} note={t({ id: 'receive.soon', message: 'Receive lands with the M4 milestone.' })} />
      break
    case 'send':
      screen = <PlaceholderScreen body={body} title={t({ id: 'send.title', message: 'Send' })} note={t({ id: 'send.soon', message: 'Send lands with the M4 milestone.' })} />
      break
    case 'token':
      screen = <PlaceholderScreen body={body} title={t({ id: 'token.title', message: 'Token' })} note={t({ id: 'token.soon', message: 'The token dossier lands with the M4 milestone.' })} />
      break
    case 'sign':
      screen = <PlaceholderScreen body={body} title={t({ id: 'sign.title', message: 'Sign' })} note={t({ id: 'sign.soon', message: 'The signing sheet lands with the M3 milestone.' })} />
      break
  }

  return (
    <Column flex={1} backgroundColor="$void">
      <Column flex={1}>{screen}</Column>
      {showTabs ? <TabBar items={items} activeId={state.tab} onSelect={(id) => router.setTab(id as TabId)} testID="tabs" /> : null}
    </Column>
  )
}
