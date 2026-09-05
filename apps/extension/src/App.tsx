import { type CSSProperties } from 'react'
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
  currentAccount,
  switchAccount,
  type IdentityState,
} from './identity'
import { Onboarding } from './Onboarding'
import { AccountSwitcher } from './AccountSwitcher'
import {
  IconHome,
  IconSwap,
  IconActivity,
  IconSettings,
  IconFlask,
  IconScan,
  IconSend,
  IconReceive,
  IconCable,
  IconToken,
  IconRocket,
  IconLayers,
  IconPlug,
  type IconProps,
} from '@boltvault/design'

/**
 * The popup — the v1 product is the popup (design §Layout).
 *
 * Quiet-custody chrome: account plate, big Oxanium total, 2px ETN filament
 * (no blur in the popup), bus-bar portfolio (44px rows, single selection,
 * arc-stroke + arc fill on the seated bar), ONE accessory chip max, a
 * per-tab primary (Receive ETN on Home, the labeled Sign breaker on Swap),
 * and the 4-tab dock. The breaker is a layer, not a 5th tab.
 *
 * Activity + Settings are the quiet stubs this pass (real merge/normalize
 * logic lives in @boltvault/activity + @boltvault/settings; this pass gives
 * them their own surfaces + empty states so the tabs are not Home clones).
 */

type TabId =
  | 'home'
  | 'swap'
  | 'send'
  | 'receive'
  | 'bridge'
  | 'token'
  | 'farm'
  | 'launchpad'
  | 'nft'
  | 'activity'
  | 'approvals'
  | 'settings'

const TABS: { id: TabId; label: string; icon: (p: IconProps) => any }[] = [
  { id: 'home', label: 'Home', icon: IconHome },
  { id: 'swap', label: 'Swap', icon: IconSwap },
  { id: 'send', label: 'Send', icon: IconSend },
  { id: 'receive', label: 'Recv', icon: IconReceive },
  { id: 'bridge', label: 'Warp', icon: IconCable },
  { id: 'token', label: 'Token', icon: IconToken },
  { id: 'farm', label: 'Farm', icon: IconFlask },
  { id: 'launchpad', label: 'Pad', icon: IconRocket },
  { id: 'nft', label: 'NFT', icon: IconLayers },
  { id: 'activity', label: 'Act', icon: IconActivity },
  { id: 'approvals', label: 'Fuse', icon: IconPlug },
  { id: 'settings', label: 'Set', icon: IconSettings },
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
        // Design: 2px arc, NO blur/glow in the popup (glow is the a11y bug).
        borderRadius: '1px',
        marginTop: '16px',
        marginBottom: '24px',
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
}: {
  symbol: string
  share: number
  selected: boolean
  onSelect: () => void
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
        minHeight: 'var(--bv-bus-bar-height)',
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
          height: '10px',
          borderRadius: '5px',
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
            borderRadius: '5px',
          }}
        />
      </div>
      <span style={{ color: 'var(--bv-mute)', width: '36px', textAlign: 'right' }}>
        {Math.round(share * 100)}%
      </span>
    </button>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabId>('home')
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

  // D: before onboarding, the whole chamber is the onboarding flow.
  if (!onboarded) {
    return (
      <Onboarding
        onDone={() => {
          // After onboarding, re-read vault + accounts from the SW.
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
      {/* Account plate + scan */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px var(--bv-inset)',
        }}
      >
        <AccountSwitcher
          accounts={identity.accounts}
          currentId={identity.currentAccountId}
          onSwitch={onSwitch}
          testId="account"
        />
        <span style={{ color: 'var(--bv-mute)', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <IconScan size={16} />
        </span>
      </header>

      <main style={{ flex: 1, padding: '0 var(--bv-inset)', overflowY: 'auto' }}>
        {tab === 'home' && (
          <>
            {/* Big total — Oxanium, left-aligned. Real data (pricedTotalUsd);
                quiet placeholder until the first read lands (no spinner). */}
            <div
              data-testid="total"
              style={{
                fontFamily: 'var(--bv-font-oxanium)',
                fontSize: '32px',
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

            {/* Bus bars — single selection, arc-stroke + arc fill on the seated
                bar. Real rows (native + priced tokens); empty invitation when
                nothing has loaded yet. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {bars.length === 0 ? (
                <div
                  data-testid="portfolio-empty"
                  style={{ color: 'var(--bv-mute)', fontSize: '13px', padding: '16px 4px' }}
                >
                  {pf.loading ? 'Reading your chamber…' : 'Nothing here yet — Receive ETN to begin.'}
                </div>
              ) : (
                bars.map((t) => (
                  <BusBar
                    key={t.symbol}
                    symbol={t.symbol}
                    share={t.share}
                    selected={selectedBar === t.symbol}
                    onSelect={() => setSelectedBar(t.symbol)}
                  />
                ))
              )}
            </div>
            {pf.stale && pf.data && (
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

            {/* One accessory chip slot (bridge > farm > campaign) */}
            <div
              data-testid="accessory-chip"
              style={{
                marginTop: '20px',
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
          </>
        )}

        {tab === 'swap' && (
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

        {tab === 'activity' && <ActivityView items={ACTIVITY} />}

        {tab === 'approvals' && <ApprovalsView approvals={APPROVALS_STUB} />}

        {tab === 'settings' && <SettingsView />}

        {tab === 'send' && (
          <SendView
            account={account ?? '0x0000000000000000000000000000000000000000'}
            onSent={() => setTab('home')}
          />
        )}

        {tab === 'receive' && (
          <ReceiveView address={account ?? '0x0000000000000000000000000000000000000000'} chainId={52014} chainName="ETN" />
        )}

        {tab === 'bridge' && <BridgeView />}

        {tab === 'token' && (
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
        )}

        {tab === 'farm' && <FarmView farms={[{ name: 'WETN/BOLT', startBlock: null, nowBlock: 0, boltDeposited: 0 }]} />}

        {tab === 'launchpad' && <LaunchpadView campaigns={[{ pool: '0x4b7a…99c0', status: 'live', min: 100n, max: 100000n, raised: 12450n, yourFill: 0n, name: 'BOLT Pad #3' }]} />}

        {tab === 'nft' && (
          <NftView
            assets={[
              { collection: '0x8a3f…77c1', tokenId: '#12', name: 'Volt #12', floor: 4.2, listed: true },
              { collection: '0x8a3f…77c1', tokenId: '#40', name: 'Volt #40', floor: 3.1 },
            ]}
          />
        )}
      </main>

      {/* Per-tab primary. Design: one verb per button from a closed table —
          Swap/Sign/Swapped, Connect, Revoke, Receive, Send. Home → Receive ETN;
          Swap → the labeled Sign breaker (in SwapView); Act/Set → Receive ETN
          as the default "empty invitation with a verb". */}
      {tab !== 'swap' && (
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

      {/* 4-tab dock — Home / Swap / Act / Set. Breaker is a layer, not a 5th tab. */}
      <nav
        data-testid="tab-dock"
        style={{
          display: 'flex',
          borderTop: '1px solid var(--bv-glass)',
          background: 'var(--bv-void)',
        }}
      >
        {TABS.map((t) => {
          const TIcon = t.icon
          return (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              height: 'var(--bv-hit)',
              background: 'transparent',
              border: 'none',
              color: tab === t.id ? 'var(--bv-arc)' : 'var(--bv-mute)',
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

export type { CSSProperties }
