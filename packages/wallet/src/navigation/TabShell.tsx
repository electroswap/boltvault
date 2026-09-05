/**
 * TabShell — mounts the four tabs and the push stack for every body. While
 * the vault exists but is locked, every surface except onboarding/harness
 * screens is replaced by Unlock. A pending dApp approval takes over the
 * popup and the mobile body (the sign window mounts it by route).
 */
import { Column, TabBar } from '@boltvault/ui'
import { t } from '../i18n'
import { Accounts } from '../screens/Accounts'
import { Activity } from '../screens/Activity'
import { Allowances } from '../screens/Allowances'
import { Approval } from '../screens/Approval'
import { Backup } from '../screens/Backup'
import { ConnectedSites } from '../screens/ConnectedSites'
import { Devices } from '../screens/Devices'
import { Home, type HomeProps } from '../screens/Home'
import { Moments } from '../screens/Moments'
import { Onboarding } from '../screens/Onboarding'
import { Receive } from '../screens/Receive'
import { Security } from '../screens/Security'
import { Send } from '../screens/Send'
import { SettingsShell } from '../screens/shells'
import { Explore } from '../screens/Explore'
import { Collection } from '../screens/Collection'
import { Piece } from '../screens/Piece'
import { Rack } from '../screens/Rack'
import { Offers } from '../screens/Offers'
import { Farm } from '../screens/Farm'
import { Campaign } from '../screens/Campaign'
import { Legends } from '../screens/Legends'
import { Alerts } from '../screens/Alerts'
import { Bridge } from '../screens/Bridge'
import { Networks } from '../screens/Networks'
import { Spending } from '../screens/Spending'
import { Swap } from '../screens/Swap'
import { Token } from '../screens/Token'
import { Unlock } from '../screens/Unlock'
import { useApprovals } from '../state/useApprovals'
import { HardwarePrompt } from '../components/HardwarePrompt'
import { useFlowNavigation } from '../state/useSwapFlow'
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
  // A swap or limit-order flow opens its sheets from here, where nothing unmounts (§8.6).
  useFlowNavigation()
  const items = TAB_ORDER.map((id) => ({ id, label: t({ id: TABS[id].labelId, message: TABS[id].labelMessage }), icon: TABS[id].icon }))
  const showTabs = state.stack.length === 0

  const locked = !loading && !!vault?.exists && !vault.unlocked
  if (locked && current.screen !== 'onboarding' && current.screen !== 'moments') {
    return <Unlock body={body} reducedMotion={reducedMotionOverride} />
  }

  // A dApp is waiting: the popup and the phone show the sheet over everything (§8.15).
  // Our own flows (Send, Revoke) navigate to the sheet themselves.
  const external = pending.filter((p) => !p.origin.startsWith('internal:'))
  if (external.length > 0 && body !== 'extension-tab' && current.screen !== 'sign' && current.screen !== 'onboarding' && current.screen !== 'moments') {
    return <Approval body={body} reducedMotion={reducedMotionOverride} requestId={external[0]?.id} />
  }

  let screen: React.ReactNode
  switch (current.screen) {
    case 'home':
      screen = <Home body={body} reducedMotionOverride={reducedMotionOverride} />
      break
    case 'swap': {
      const p = current.params as { tokenIn?: string; tokenOut?: string } | undefined
      screen = <Swap body={body} reducedMotion={reducedMotionOverride} {...(p?.tokenIn ? { tokenIn: p.tokenIn } : {})} {...(p?.tokenOut ? { tokenOut: p.tokenOut } : {})} />
      break
    }
    case 'explore': {
      const p = current.params as { segment?: 'tokens' | 'collectibles' | 'launch' | 'farms' } | undefined
      screen = <Explore body={body} {...(p?.segment ? { segment: p.segment } : {})} />
      break
    }
    case 'collection': {
      const p = current.params as { chainId: number; address: string } | undefined
      screen = <Collection body={body} reducedMotion={reducedMotionOverride} chainId={p?.chainId ?? 52014} address={p?.address ?? ''} />
      break
    }
    case 'nft': {
      const p = current.params as { chainId: number; address: string; tokenId: string } | undefined
      screen = <Piece body={body} reducedMotion={reducedMotionOverride} chainId={p?.chainId ?? 52014} address={p?.address ?? ''} tokenId={p?.tokenId ?? '0'} />
      break
    }
    case 'rack':
      screen = <Rack body={body} />
      break
    case 'offers':
      screen = <Offers body={body} reducedMotion={reducedMotionOverride} />
      break
    case 'farm': {
      const p = current.params as { chainId: number; farmId: number } | undefined
      screen = <Farm body={body} reducedMotion={reducedMotionOverride} chainId={p?.chainId ?? 52014} farmId={p?.farmId ?? 0} />
      break
    }
    case 'campaign': {
      const p = current.params as { chainId: number; pool: string } | undefined
      screen = <Campaign body={body} reducedMotion={reducedMotionOverride} chainId={p?.chainId ?? 52014} pool={p?.pool ?? ''} />
      break
    }
    case 'legends':
      screen = <Legends body={body} reducedMotion={reducedMotionOverride} />
      break
    case 'bridge': {
      const p = current.params as { chainId?: number; token?: string } | undefined
      screen = <Bridge body={body} reducedMotion={reducedMotionOverride} {...(p?.chainId ? { chainId: p.chainId } : {})} {...(p?.token ? { token: p.token } : {})} />
      break
    }
    case 'networks':
      screen = <Networks body={body} />
      break
    case 'alerts':
      screen = <Alerts body={body} />
      break
    case 'activity':
      screen = <Activity body={body} />
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
    case 'allowances':
      screen = <Allowances body={body} />
      break
    case 'spending':
      screen = <Spending body={body} />
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
    case 'receive': {
      const p = current.params as { token?: string; chainId?: number } | undefined
      screen = <Receive body={body} {...(p?.token ? { token: p.token } : {})} {...(p?.chainId ? { chainId: p.chainId } : {})} />
      break
    }
    case 'send': {
      const p = current.params as { token?: string; to?: string; requestId?: string; chainId?: number } | undefined
      screen = <Send body={body} reducedMotion={reducedMotionOverride} {...(p?.token ? { token: p.token } : {})} {...(p?.to ? { to: p.to } : {})} {...(p?.requestId ? { requestId: p.requestId } : {})} {...(p?.chainId ? { chainId: p.chainId } : {})} />
      break
    }
    case 'token': {
      const p = current.params as { chainId: number; address: string } | undefined
      screen = <Token body={body} chainId={p?.chainId ?? 52014} address={p?.address ?? 'native'} />
      break
    }
  }

  return (
    <Column flex={1} backgroundColor="$void">
      <Column flex={1}>{screen}</Column>
      {showTabs ? <TabBar items={items} activeId={state.tab} onSelect={(id) => router.setTab(id as TabId)} testID="tabs" /> : null}
      {/* Last child, so a device round trip sheet paints above the tab bar (§7.5). */}
      <HardwarePrompt body={body} reducedMotion={reducedMotionOverride} />
    </Column>
  )
}
