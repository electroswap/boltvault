import { useEffect, useMemo, useState } from 'react'
import { SwapView } from './SwapView'
import { SendView } from './Send'
import { ReceiveView } from './Receive'
import { BridgeView } from './Bridge'
import { TokenView } from './Token'
import { FarmView } from './Farm'
import { LaunchpadView } from './Launchpad'
import { NftView } from './Nft'
import { ActivityView, type ActivityItem } from './Activity'
import { ApprovalsView, type ApprovalFuse } from './Approvals'
import { SettingsView } from './Settings'
import { useBlockHeartbeat, usePortfolio, type SafeRow } from './data-layer'
import {
  type VaultAccount,
  emptyIdentity,
  switchAccount,
  type IdentityState,
} from './identity'
import { Onboarding } from './Onboarding'
import { AccountSwitcher } from './AccountSwitcher'
import {
  IconHome,
  IconSwap,
  IconSend,
  IconActivity,
  IconSettings,
  IconFlask,
  IconScan,
  IconReceive,
  IconCable,
  IconToken,
  IconRocket,
  IconLayers,
  IconPlug,
  IconArrowLeft,
  IconChevronDown,
  type IconProps,
} from '@boltvault/design'

/**
 * The popup — the v1 product (design §Layout).
 *
 * Navigation is a 5-tab dock (Home / Swap / Send / Activity / Settings).
 * The lower-frequency functions (Receive, Bridge, Token, Farm, Launchpad,
 * NFT, Approvals) are NOT in the dock — they live on the Home tab, where the
 * bottom ⅔ "features" them as a grid. The top ⅓ is a COLLAPSED portfolio that
 * expands (tap) into the full portfolio view. The breaker is a layer, not a tab.
 */

/** The 5 dock tabs. */
type TabId = 'home' | 'swap' | 'send' | 'activity' | 'settings'

/** The non-dock functions, featured on Home's bottom ⅔. */
type FeatureId = 'receive' | 'bridge' | 'token' | 'farm' | 'launchpad' | 'nft' | 'approvals'

const DOCK: { id: TabId; label: string; icon: (p: IconProps) => any }[] = [
  { id: 'home', label: 'Home', icon: IconHome },
  { id: 'swap', label: 'Swap', icon: IconSwap },
  { id: 'send', label: 'Send', icon: IconSend },
  { id: 'activity', label: 'Activity', icon: IconActivity },
  { id: 'settings', label: 'Settings', icon: IconSettings },
]

const FEATURES: { id: FeatureId; label: string; icon: (p: IconProps) => any }[] = [
  { id: 'receive', label: 'Receive', icon: IconReceive },
  { id: 'bridge', label: 'Bridge', icon: IconCable },
  { id: 'token', label: 'Token', icon: IconToken },
  { id: 'farm', label: 'Farm', icon: IconFlask },
  { id: 'launchpad', label: 'Launchpad', icon: IconRocket },
  { id: 'nft', label: 'NFT', icon: IconLayers },
  { id: 'approvals', label: 'Approvals', icon: IconPlug },
]

/** Placeholder approvals — @boltvault/approvals fuse-box rows (T6.4). */
const APPROVALS_STUB: ApprovalFuse[] = [
  { id: 'ap1', token: 'ETN', spender: '0x9fE4…99a9', unlimited: true },
  { id: 'ap2', token: 'USDC', spender: '0x3187…6e6e', unlimited: false },
]

/** Placeholder activity — @boltvault/activity merge fills this (T6.1). */
const ACTIVITY: ActivityItem[] = [
  { id: 'a1', label: 'Swap · ETN → USDC', sub: '2m ago · 0x1F9…C277', usd: -42.1 },
  { id: 'a2', label: 'Received 12.4 ETN', sub: '1h ago · Hyperlane', usd: null, pending: true },
  { id: 'a3', label: 'Approval · WETN', sub: '2d ago', usd: null },
]

function Filament({ active }: { active: boolean }) {
  return (
    <div
      data-testid="filament"
      style={{
        height: 'var(--bv-filament)',
        background: active ? 'var(--bv-arc)' : 'var(--bv-mute)',
        borderRadius: '1px',
        marginTop: '10px',
        marginBottom: '14px',
        transition: 'background 120ms linear',
      }}
    />
  )
}

function BusBar({
  symbol,
  share,
  selected,
  onSelect,
  compact = false,
}: {
  symbol: string
  share: number
  selected: boolean
  onSelect: () => void
  compact?: boolean
}) {
  return (
    <button
      data-testid={`busbar-${symbol}`}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        minHeight: compact ? '34px' : 'var(--bv-bus-bar-height)',
        background: 'transparent',
        border: selected ? '1px solid var(--bv-arc)' : '1px solid transparent',
        borderRadius: '6px',
        cursor: 'pointer',
        padding: '0 12px',
        textAlign: 'left',
        color: 'var(--bv-ink)',
        fontFamily: 'var(--bv-font-sora)',
        fontSize: '13px',
      }}
    >
      <span style={{ width: '52px', color: selected ? 'var(--bv-arc)' : 'var(--bv-ink)' }}>{symbol}</span>
      <div
        data-testid={`busbar-${symbol}-fill`}
        style={{
          flex: 1,
          height: compact ? '7px' : '10px',
          borderRadius: 5,
          background: 'var(--bv-glass)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.round(share * 100)}%`,
            height: '100%',
            background: selected ? 'var(--bv-arc)' : 'var(--bv-plasma)',
            borderRadius: 5,
          }}
        />
      </div>
      <span style={{ color: 'var(--bv-mute)', width: '36px', textAlign: 'right' }}>
        {Math.round(share * 100)}%
      </span>
    </button>
  )
}

/** A tile in Home's "featured functions" grid. */
function FeatureTile({
  icon: TileIcon,
  label,
  testId,
  onOpen,
}: {
  icon: (p: IconProps) => any
  label: string
  testId: string
  onOpen: () => void
}) {
  return (
    <button
      data-testid={testId}
      onClick={onOpen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        minHeight: '88px',
        background: 'var(--bv-glass)',
        border: '1px solid var(--bv-glass)',
        borderRadius: '10px',
        color: 'var(--bv-ink)',
        cursor: 'pointer',
        fontFamily: 'var(--bv-font-sora)',
        fontSize: '12px',
      }}
    >
      <TileIcon size={22} />
      <span>{label}</span>
    </button>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabId>('home')
  const [feature, setFeature] = useState<FeatureId | null>(null)
  const [homeExpanded, setHomeExpanded] = useState(false)
  const [selectedBar, setSelectedBar] = useState<string>('ETN')
  const [account, setAccount] = useState<string | null>(null)
  const [vaultState, setVaultState] = useState<{ has: boolean; unlocked: boolean } | null>(null)
  const [identity, setIdentity] = useState<IdentityState>(emptyIdentity)

  // D: learn vault + account state from the SW on mount (and after onboarding).
  useEffect(() => {
    const b = (globalThis as any).browser
    if (!b?.runtime?.sendMessage) return
    void b.runtime.sendMessage({ type: 'bv:vault:state' }).then((r: any) => {
      setVaultState({ has: !!r?.hasVault, unlocked: !!r?.unlocked })
    }).catch(() => {})
    void b.runtime.sendMessage({ type: 'bv:accounts' }).then((r: any) => {
      const addrs: string[] = r?.accounts ?? []
      if (addrs.length > 0) {
        setIdentity((prev) => {
          const accounts: VaultAccount[] = addrs.map((a, i) => ({ id: `acct-${i}`, label: i === 0 ? 'main' : `Account ${i + 1}`, address: a, kind: 'hd' }))
          const current = prev.accounts[0] ?? null
          return { accounts, currentAccountId: current?.id ?? 'acct-0' }
        })
        const firstAddr = addrs[0]
        if (firstAddr) setAccount(firstAddr)
      }
    }).catch(() => {})
  }, [])

  // E0b: the block heartbeat drives the filament + head; the portfolio hook
  // drives the total + bus bars with last-good + refresh (ETN 15s).
  const { state: hb } = useBlockHeartbeat(52014)
  const pf = usePortfolio(52014, account ?? '', { client: undefined })

  const total = pf.data?.pricedTotalUsd ?? null
  const bars: { symbol: string; share: number }[] = useMemo(() => {
    const rows: SafeRow[] = pf.data ? [...(pf.data.native ? [pf.data.native] : []), ...pf.data.rows] : []
    return rows.map((r) => ({ symbol: r.symbol, share: r.share }))
  }, [pf.data])

  const onboarded = vaultState?.has ?? false
  const onSwitch = (id: string) => {
    setIdentity((s) => switchAccount(s, id))
    const a = identity.accounts.find((x) => x.id === id)
    if (a) setAccount(a.address)
  }

  const goTab = (id: TabId) => {
    setTab(id)
    setFeature(null)
  }
  const openFeature = (id: FeatureId) => setFeature(id)
  const closeFeature = () => setFeature(null)

  const featureLabel = feature ? FEATURES.find((f) => f.id === feature)?.label ?? '' : ''

  // The non-dock surfaces, rendered when a feature is open.
  const renderFeature = (id: FeatureId) => {
    switch (id) {
      case 'receive':
        return <ReceiveView address={account ?? '0x0000000000000000000000000000000000000000'} chainId={52014} chainName="ETN" />
      case 'bridge':
        return <BridgeView />
      case 'token':
        return (
          <TokenView
            token={{
              symbol: 'ETN',
              name: 'ElectroSwap Token',
              address: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77',
              chainId: 52014,
              lockPct: 0,
              tags: ['native', 'ETN 52014'],
            }}
            priceUsd={null}
          />
        )
      case 'farm':
        return <FarmView farms={[{ name: 'WETN/BOLT', startBlock: null, nowBlock: 0, boltDeposited: 0 }]} />
      case 'launchpad':
        return <LaunchpadView campaigns={[{ pool: '0x4b7a…99c0', status: 'live', min: 100n, max: 100000n, raised: 12450n, yourFill: 0n, name: 'BOLT Pad #3' }]} />
      case 'nft':
        return (
          <NftView
            assets={[
              { collection: '0x8a3f…77c1', tokenId: '#12', name: 'Volt #12', floor: 4.2, listed: true },
              { collection: '0x8a3f…77c1', tokenId: '#40', name: 'Volt #40', floor: 3.1 },
            ]}
          />
        )
      case 'approvals':
        return <ApprovalsView approvals={APPROVALS_STUB} />
    }
  }

  // The full portfolio body (Home expanded, or the collapsed view's content).
  const portfolioBody = (expanded: boolean) => (
    <>
      <div
        data-testid="total"
        style={{
          fontFamily: 'var(--bv-font-oxanium)',
          fontSize: expanded ? '32px' : '26px',
          letterSpacing: '-0.04em',
          fontWeight: 600,
          color: total == null ? 'var(--bv-mute)' : 'var(--bv-ink)',
        }}
      >
        {total == null ? '—' : `$${total.toFixed(2)}`}
      </div>
      <div
        data-testid="head"
        style={{ color: 'var(--bv-ember)', fontSize: '13px', marginTop: '2px' }}
      >
        {hb.block != null ? `ETN · ${hb.block.toLocaleString()}` : 'ETN'}
      </div>

      <Filament active={!hb.stale} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {bars.length === 0 ? (
          <div
            data-testid="portfolio-empty"
            style={{ color: 'var(--bv-mute)', fontSize: '13px', padding: '16px 4px' }}
          >
            {pf.loading ? 'Reading your chamber…' : 'Nothing here yet — Receive ETN to begin.'}
          </div>
        ) : (
          bars.slice(0, expanded ? bars.length : 3).map((t) => (
            <BusBar
              key={t.symbol}
              symbol={t.symbol}
              share={t.share}
              selected={selectedBar === t.symbol}
              onSelect={() => setSelectedBar(t.symbol)}
              compact={!expanded}
            />
          ))
        )}
        {!expanded && bars.length > 3 && (
          <div style={{ color: 'var(--bv-mute)', fontSize: '12px', padding: '0 12px' }}>
            +{bars.length - 3} more
          </div>
        )}
      </div>
      {expanded && pf.stale && pf.data && (
        <div data-testid="stall" style={{ color: 'var(--bv-mute)', fontSize: '11px', marginTop: '8px' }}>
          Holding last read —{' '}
          <span
            data-testid="stall-retry"
            role="button"
            style={{ color: 'var(--bv-arc)', cursor: 'pointer' }}
            onClick={() => void pf.refresh()}
          >
            Retry
          </span>
        </div>
      )}
      {expanded && (
        <div
          data-testid="accessory-chip"
          style={{
            marginTop: '16px',
            padding: '10px 12px',
            background: 'var(--bv-glass)',
            borderRadius: '8px',
            color: 'var(--bv-ink)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <IconFlask size={18} />
          <span>WETN/BOLT 1.41x · Collect 12 DYNO</span>
        </div>
      )}
    </>
  )

  // Home, split: top ⅓ collapsed portfolio (tap to expand) + bottom ⅔ features.
  const homeSplit = (
    <div data-testid="home" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top ⅓ — collapsed portfolio; tap to expand into the full portfolio. */}
      <button
        data-testid="home-portfolio"
        onClick={() => setHomeExpanded(true)}
        style={{
          flex: '0 0 33.333%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          gap: '4px',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          overflow: 'hidden',
          color: 'var(--bv-ink)',
          fontFamily: 'var(--bv-font-sora)',
        }}
      >
        {portfolioBody(false)}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--bv-mute)',
            fontSize: '12px',
            marginTop: '6px',
          }}
        >
          Expand portfolio <IconChevronDown size={14} />
        </div>
      </button>

      {/* Bottom ⅔ — featured non-essential functions. */}
      <div
        data-testid="home-features"
        style={{ flex: '1 1 66.667%', display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '12px' }}
      >
        <div style={{ color: 'var(--bv-mute)', fontSize: '12px' }}>More</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, alignContent: 'start' }}>
          {FEATURES.map((f) => (
            <FeatureTile key={f.id} icon={f.icon} label={f.label} testId={`feature-${f.id}`} onOpen={() => openFeature(f.id)} />
          ))}
        </div>
      </div>
    </div>
  )

  // D: before onboarding, the whole chamber is the onboarding flow.
  if (!onboarded) {
    return (
      <Onboarding
        onDone={() => {
          const b = (globalThis as any).browser
          if (b?.runtime?.sendMessage) {
            void b.runtime.sendMessage({ type: 'bv:vault:state' }).then((r: any) => {
              setVaultState({ has: !!r?.hasVault, unlocked: !!r?.unlocked })
            }).catch(() => {})
            void b.runtime.sendMessage({ type: 'bv:accounts' }).then((r: any) => {
              const addrs: string[] = r?.accounts ?? []
              const firstAddr = addrs[0]
              if (firstAddr) setAccount(firstAddr)
            }).catch(() => {})
          }
        }}
      />
    )
  }

  return (
    <div
      data-testid="chamber"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bv-void)',
      }}
    >
      {/* Header — account plate + scan, OR a back bar when a feature is open. */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px var(--bv-inset)',
        }}
      >
        {feature ? (
          <button
            data-testid="feature-back"
            onClick={closeFeature}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'transparent',
              border: 'none',
              color: 'var(--bv-ink)',
              cursor: 'pointer',
              fontFamily: 'var(--bv-font-sora)',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            <IconArrowLeft size={20} />
            {featureLabel}
          </button>
        ) : (
          <AccountSwitcher
            accounts={identity.accounts}
            currentId={identity.currentAccountId}
            onSwitch={onSwitch}
            testId="account"
          />
        )}
        <span style={{ color: 'var(--bv-mute)', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <IconScan size={16} />
        </span>
      </header>

      <main
        style={{
          flex: 1,
          padding: '0 var(--bv-inset)',
          overflowY: 'auto',
          display: tab === 'home' && !feature ? 'flex' : 'block',
        }}
      >
        {feature != null && renderFeature(feature)}

        {!feature && tab === 'home' && (homeExpanded ? portfolioBody(true) : homeSplit)}

        {!feature && tab === 'swap' && (
          <SwapView
            chainId={52014}
            tokenIn={{ address: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77', symbol: 'ETN' }}
            tokenOut={{ address: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', symbol: 'USDC' }}
            quote={null}
            now={Date.now()}
            priceImpactPct={0.4}
            sink={null}
            amountInDisplay="0"
          />
        )}

        {!feature && tab === 'send' && (
          <SendView account={account ?? '0x0000000000000000000000000000000000000000'} onSent={() => goTab('home')} />
        )}

        {!feature && tab === 'activity' && <ActivityView items={ACTIVITY} />}

        {!feature && tab === 'settings' && <SettingsView />}
      </main>

      {/* Per-dock-tab primary (not on Swap, which carries its own Sign breaker). */}
      {tab !== 'swap' && !feature && (
        <div style={{ padding: '12px var(--bv-inset)' }}>
          <button
            data-testid="home-primary"
            style={{
              width: '100%',
              height: 'var(--bv-hit)',
              background: 'var(--bv-arc)',
              color: 'var(--bv-void)',
              border: 'none',
              borderRadius: '8px',
              fontFamily: 'var(--bv-font-sora)',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Receive ETN
          </button>
        </div>
      )}

      {/* 5-tab dock. */}
      <nav
        data-testid="tab-dock"
        style={{
          display: 'flex',
          borderTop: '1px solid var(--bv-glass)',
          background: 'var(--bv-void)',
        }}
      >
        {DOCK.map((t) => {
          const TIcon = t.icon
          return (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => goTab(t.id)}
              style={{
                flex: 1,
                height: 'var(--bv-hit)',
                background: 'transparent',
                border: 'none',
                color: tab === t.id && !feature ? 'var(--bv-arc)' : 'var(--bv-mute)',
                fontFamily: 'var(--bv-font-sora)',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
              }}
            >
              <TIcon size={20} />
              {t.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
