/**
 * The dApp connection status (owner ask, 2026-09-06): what site the popup
 * was opened over and whether it is connected to BoltVault. A strip half on
 * Home shows the host with a live dot; tapping it opens a sheet with the
 * site's chain (changeable), the account it sees, when it was last used,
 * and Disconnect. A site that is not connected says so and points to the
 * site itself — BoltVault never connects on a site's behalf.
 */
import {
  Artwork,
  Body,
  Column,
  Dot,
  Icon,
  Key,
  Pill,
  Plate,
  Pressable,
  Row,
  Sheet,
  Signature,
  paint,
  shortAddress,
} from '@boltvault/ui'
import type { ChainView, SiteView } from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'
import { ChainSelectPill, ChainSheet } from './ChainSelect'

export type DappState =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'off'
      readonly origin: string
      readonly host: string
      readonly favicon: string | null
    }
  | {
      readonly kind: 'on'
      readonly origin: string
      readonly host: string
      readonly favicon: string | null
      readonly site: SiteView
    }

/** Null while the tab and the site list are still loading. */
export function useDappStatus(enabled: boolean): DappState | null {
  const host = useHost()
  const engine = useEngine()
  const [tab, setTab] = useState<
    { origin: string; host: string; favicon: string | null } | null | undefined
  >(undefined)
  const [sites, setSites] = useState<SiteView[] | null>(null)
  useEffect(() => {
    if (!enabled || !host.currentTab) {
      setTab(null)
      return
    }
    let alive = true
    host.currentTab().then(
      (x) => alive && setTab(x),
      () => alive && setTab(null),
    )
    return () => {
      alive = false
    }
  }, [host, enabled])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    engine.sites.list().then(
      (s) => alive && setSites(s),
      () => alive && setSites([]),
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'sites.changed' && alive) setSites(e.sites)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, enabled])
  return useMemo(() => {
    if (tab === undefined || sites === null) return null
    if (!tab) return { kind: 'none' }
    const site = sites.find((s) => s.origin === tab.origin) ?? null
    return site ? { kind: 'on', ...tab, site } : { kind: 'off', ...tab }
  }, [tab, sites])
}

/** The strip half: favicon or a link glyph, the host, a dot that is lit when connected. */
export function DappStrip({
  state,
  onPress,
  testID = 'home-dapp',
}: {
  state: DappState | null
  onPress: () => void
  testID?: string
}) {
  const none = !state || state.kind === 'none'
  const label = !state
    ? ''
    : state.kind === 'none'
      ? t({ id: 'dapp.none', message: 'No dApp on this tab' })
      : state.host
  const status =
    state?.kind === 'on'
      ? t({ id: 'dapp.on', message: 'Connected' })
      : state?.kind === 'off'
        ? t({ id: 'dapp.off', message: 'Not connected' })
        : ''
  return (
    <Pressable
      onPress={none ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={none ? label : `${label}, ${status}`}
      testID={testID}
      style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <Row gap={8} alignItems="center">
        <Row
          width={22}
          height={22}
          borderRadius={11}
          backgroundColor="$glassRaised"
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
          flexShrink={0}
        >
          {state && state.kind !== 'none' && state.favicon ? (
            <Artwork uri={state.favicon} label={state.host} size={22} radius={0} />
          ) : (
            <Icon name="link" size={12} color={paint.mute} />
          )}
        </Row>
        <Column flex={1} minWidth={0} alignItems="flex-start">
          <Body size="caption" tone={none ? 'mute' : 'ink'} numberOfLines={1}>
            {label}
          </Body>
          {status ? (
            <Row gap={4} alignItems="center">
              <Dot color={state?.kind === 'on' ? paint.surge : paint.mute} size={6} />
              <Body size="caption" tone="mute" fontSize={11} lineHeight={13}>
                {status}
              </Body>
            </Row>
          ) : null}
        </Column>
      </Row>
    </Pressable>
  )
}

export function DappSheet({
  open,
  onClose,
  state,
  reducedMotion = false,
}: {
  open: boolean
  onClose: () => void
  state: DappState | null
  reducedMotion?: boolean
}) {
  const engine = useEngine()
  const router = useRouter()
  const { accounts } = useWalletState()
  const [chains, setChains] = useState<ChainView[]>([])
  const [chainOpen, setChainOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    engine.chains.list().then(setChains, () => undefined)
  }, [engine, open])
  if (!state || state.kind === 'none') return null
  const site = state.kind === 'on' ? state.site : null
  const account = site?.accountId ? (accounts.find((a) => a.id === site.accountId) ?? null) : null
  const chainName = (id: number): string =>
    chains.find((c) => c.chainId === id)?.name ?? (id === 52014 ? 'Electroneum' : `Chain ${id}`)
  const disconnect = async (): Promise<void> => {
    if (!site) return
    setBusy(true)
    try {
      await engine.sites.disconnect({ origin: site.origin })
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={state.host}
        reducedMotion={reducedMotion}
        footer={
          site ? (
            <Key
              label={t({ id: 'sites.disconnect', message: 'Disconnect' })}
              kind="danger"
              size="compact"
              disabled={busy}
              onPress={() => void disconnect()}
              testID="dapp-disconnect"
            />
          ) : undefined
        }
        testID="dapp-sheet"
      >
        <Column gap="$3">
          {site ? (
            <>
              <Row gap="$2" alignItems="center">
                <Dot color={paint.surge} size={8} />
                <Body size="caption" tone="mute" flexShrink={1}>
                  {t({
                    id: 'dapp.on.body',
                    message:
                      'Connected — this site sees the address below and can ask you to sign. It cannot move anything without a signature.',
                  })}
                </Body>
              </Row>
              <Plate role="recessed" gap={4} paddingVertical={8} testID="dapp-details">
                <Row justifyContent="space-between" alignItems="center" minHeight={36}>
                  <Body size="caption" tone="mute">
                    {t({ id: 'dapp.chain', message: 'Chain' })}
                  </Body>
                  <ChainSelectPill
                    chainId={site.chainId}
                    label={chainName(site.chainId)}
                    size="sm"
                    onPress={() => setChainOpen(true)}
                    testID="dapp-chain"
                  />
                </Row>
                <Row justifyContent="space-between" alignItems="center" minHeight={28}>
                  <Body size="caption" tone="mute">
                    {t({ id: 'dapp.account', message: 'Account' })}
                  </Body>
                  {account ? (
                    <Row gap={6} alignItems="center">
                      <Signature address={account.address} size={18} />
                      <Body size="caption">{`${account.label} · ${shortAddress(account.address)}`}</Body>
                    </Row>
                  ) : (
                    <Body size="caption" tone="mute">
                      {t({ id: 'sites.noaccount', message: 'No account' })}
                    </Body>
                  )}
                </Row>
                {site.lastUsed ? (
                  <Row justifyContent="space-between" alignItems="center" minHeight={28}>
                    <Body size="caption" tone="mute">
                      {t({ id: 'dapp.lastUsed', message: 'Last used' })}
                    </Body>
                    <Body size="caption">{new Date(site.lastUsed).toLocaleDateString()}</Body>
                  </Row>
                ) : null}
              </Plate>
              <Pill
                label={t({ id: 'dapp.sites', message: 'All connected sites' })}
                icon={<Icon name="chevronRight" size={14} color={paint.mute} />}
                size="sm"
                onPress={() => {
                  onClose()
                  router.navigate('sites')
                }}
                testID="dapp-sites"
              />
            </>
          ) : (
            <>
              <Body tone="mute" size="caption">
                {t({
                  id: 'dapp.off.body',
                  message:
                    '{h} is not connected to BoltVault. Connect from the site itself: it will ask, and you choose the account.',
                  values: { h: state.host },
                })}
              </Body>
              <Pill
                label={t({ id: 'dapp.sites', message: 'All connected sites' })}
                icon={<Icon name="chevronRight" size={14} color={paint.mute} />}
                size="sm"
                onPress={() => {
                  onClose()
                  router.navigate('sites')
                }}
                testID="dapp-sites"
              />
            </>
          )}
        </Column>
      </Sheet>
      {site ? (
        <ChainSheet
          open={chainOpen}
          onClose={() => setChainOpen(false)}
          title={t({ id: 'dapp.chain.title', message: 'Chain for {h}', values: { h: state.host } })}
          options={chains.map((c) => ({ id: c.chainId, name: c.name }))}
          selected={site.chainId}
          onSelect={(id) => {
            if (id !== 'all')
              void engine.sites
                .setChain({ origin: site.origin, chainId: id })
                .catch(() => undefined)
            setChainOpen(false)
          }}
          reducedMotion={reducedMotion}
          testID="dapp-chain-sheet"
          rowTestID={(id) => `dapp-chain-${id}`}
        />
      ) : null}
    </>
  )
}
