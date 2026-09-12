/** Settings › Connected sites (master plan §8.14): origins as plugs, per-site chain and account, disconnect. */
import {
  Body,
  ChainMark,
  Column,
  Input,
  Key,
  Pill,
  Plate,
  Pressable,
  Row,
  ScrollView,
  Signature,
  Toggle,
  metrics,
  shortAddress,
} from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { ChainView, Settings, SiteView, WcSessionView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'

export function ConnectedSites({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const { accounts } = useWalletState()
  const [sites, setSites] = useState<SiteView[]>([])
  const [chains, setChains] = useState<ChainView[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  /** The origin whose account rows are open; only one at a time, like the chain editor. */
  const [seating, setSeating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const host = useHost()
  const [wc, setWc] = useState<{ available: boolean; sessions: WcSessionView[] } | null>(null)
  const [wcUri, setWcUri] = useState('')
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    const offWc = engine.events.subscribe((e) => {
      if (e.type === 'connect.changed')
        setWc((prev) => ({ available: prev?.available ?? true, sessions: e.sessions }))
    })
    engine.sites.list().then(setSites, () => undefined)
    engine.settings.get().then(setSettings, () => undefined)
    engine.connect.status().then(
      (st) => setWc({ available: st.available, sessions: st.sessions }),
      () => setWc({ available: false, sessions: [] }),
    )
    engine.chains.list().then(setChains, () => undefined)
    const offSites = engine.events.subscribe((e) => {
      if (e.type === 'sites.changed') setSites(e.sites)
    })
    return () => {
      offSites()
      offWc()
    }
  }, [engine])

  const setSetting = (patch: Partial<Settings>): void => {
    engine.settings.set(patch).then(setSettings, () => undefined)
  }

  const hostOf = (origin: string): string => {
    try {
      return new URL(origin).host
    } catch {
      return origin
    }
  }

  const reseat = (origin: string, accountId: string): void => {
    setError(null)
    engine.sites.setAccount({ origin, accountId }).then(
      () => setSeating(null),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="sites">
      <PageHeader title={t({ id: 'sites.title', message: 'Connected sites' })} />

      {/*
        How BoltVault introduces itself to a page, which is connection
        behaviour and therefore belongs beside the sites it decides for. Both
        switches change what a page finds when it loads, so a page already
        open keeps what it found — hence the line about reloading.

        Every wallet worth the name offers EIP-6963, and BoltVault always
        announces itself that way; these two are only for the older sites that
        look for one `window.ethereum` and assume it is MetaMask.
      */}
      <Plate gap="$2" testID="sites-default">
        <Toggle
          value={settings?.defaultWallet ?? false}
          onChange={(v) => setSetting({ defaultWallet: v })}
          label={t({ id: 'sites.default', message: 'BoltVault is my default wallet' })}
          hint={t({
            id: 'sites.default.hint',
            message:
              'Off. Sites that offer a wallet chooser find BoltVault either way. Turn this on and BoltVault also takes the single slot older sites reach for — which is the same slot another extension wants, so the last one to load wins and neither is reliable.',
          })}
          testID="sites-default-toggle"
        />
      </Plate>

      <Plate gap="$2" testID="sites-compat">
        <Toggle
          value={settings?.metaMaskCompat ?? false}
          onChange={(v) => setSetting({ metaMaskCompat: v })}
          label={t({ id: 'sites.compat', message: 'Answer to sites that only support MetaMask' })}
          hint={t({
            id: 'sites.compat.hint',
            message:
              'Off. Some sites refuse anything that does not say it is MetaMask; with this on, BoltVault says so. Nothing else changes — every request still comes to you in this wallet’s own sheet — but a site will name MetaMask in its own copy, and a site that behaves differently for MetaMask will do that too.',
          })}
          testID="sites-compat-toggle"
        />
      </Plate>

      <Body tone="mute" size="caption" testID="sites-reload-note">
        {t({
          id: 'sites.reload',
          message:
            'A page decides which wallet it is talking to when it loads. Reload any site you already have open for either of these to reach it.',
        })}
      </Body>

      {sites.length === 0 ? (
        <Plate gap="$1">
          <Body tone="mute">
            {t({
              id: 'sites.none',
              message:
                'No site is connected. When a site asks to connect, it appears here with the account and chain it sees.',
            })}
          </Body>
        </Plate>
      ) : null}
      {/* WalletConnect is the phone's; in the browser BoltVault is already in every tab (plan A4). */}
      {body === 'mobile' ? (
        <Plate gap="$2" testID="walletconnect">
          <Row justifyContent="space-between" alignItems="center">
            <Body size="title">{t({ id: 'wc.title', message: 'WalletConnect' })}</Body>
            {wc?.available && host.scanQr ? (
              <Key
                label={t({ id: 'wc.scan', message: 'Scan' })}
                kind="secondary"
                onPress={() =>
                  void host
                    .scanQr?.()
                    .then((uri) => engine.connect.pair({ uri }))
                    .catch((err: unknown) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    )
                }
                testID="wc-scan"
              />
            ) : null}
          </Row>
          {wc && !wc.available ? (
            <Body tone="mute" size="caption">
              {t({
                id: 'wc.web',
                message:
                  'WalletConnect lives in the phone app. In the browser, BoltVault is already in every tab.',
              })}
            </Body>
          ) : (
            <>
              <Body tone="mute" size="caption">
                {t({
                  id: 'wc.body',
                  message:
                    'Paste or scan a wc: link from a site. The site then asks to connect like any other, and its signatures come through the same sheet.',
                })}
              </Body>
              <Input value={wcUri} onChange={setWcUri} placeholder="wc:…" testID="wc-uri" />
              <Key
                label={t({ id: 'wc.pair', message: 'Pair' })}
                kind="secondary"
                disabled={!wcUri.startsWith('wc:')}
                onPress={() =>
                  void engine.connect.pair({ uri: wcUri.trim() }).then(
                    () => setWcUri(''),
                    (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
                  )
                }
                testID="wc-pair"
              />
            </>
          )}
          {wc?.sessions.map((s) => (
            <Row
              key={s.topic}
              justifyContent="space-between"
              alignItems="center"
              testID={`wc-session-${s.topic}`}
            >
              <Column gap={2} flexShrink={1}>
                <Body numberOfLines={1}>{s.name || hostOf(s.origin)}</Body>
                <Body tone="mute" size="caption">
                  {hostOf(s.origin)} · {s.chains.length} {t({ id: 'wc.chains', message: 'chains' })}
                </Body>
              </Column>
              <Key
                label={t({ id: 'sites.disconnect', message: 'Disconnect' })}
                kind="danger"
                size="compact"
                onPress={() => void engine.connect.disconnect({ topic: s.topic })}
                testID={`wc-disconnect-${s.topic}`}
              />
            </Row>
          ))}
        </Plate>
      ) : null}
      {sites.map((s) => {
        const account = accounts.find((a) => a.id === s.accountId)
        const chain = chains.find((c) => c.chainId === s.chainId)
        return (
          <Plate key={s.origin} gap="$2" testID={`site-${hostOf(s.origin)}`}>
            <Row justifyContent="space-between">
              <Body size="title" numberOfLines={1}>
                {hostOf(s.origin)}
              </Body>
              <Pill
                label={chain?.name ?? String(s.chainId)}
                icon={<ChainMark chainId={s.chainId} size={14} />}
                chevron
                size="sm"
                onPress={() => setEditing(editing === s.origin ? null : s.origin)}
                testID={`site-chain-${hostOf(s.origin)}`}
              />
            </Row>
            {/*
              The account was a caption — the one fact on this plate the user
              could read and not change, so moving a dApp to another address
              meant disconnecting and hoping the site offered a way back in.
              It opens the same kind of inline editor the chain pill does.
            */}
            <Pressable
              onPress={() => setSeating(seating === s.origin ? null : s.origin)}
              accessibilityRole="button"
              accessibilityLabel={t({
                id: 'sites.account.a11y',
                message: 'Change the account this site sees',
              })}
              style={{ minHeight: 44, justifyContent: 'center' }}
              testID={`site-account-${hostOf(s.origin)}`}
            >
              <Row gap="$2" alignItems="center">
                {account ? <Signature address={account.address} size={22} /> : null}
                <Column flex={1} minWidth={0} alignItems="flex-start">
                  <Body size="caption" numberOfLines={1}>
                    {account
                      ? `${account.label} · ${shortAddress(account.address)}`
                      : t({ id: 'sites.noaccount', message: 'No account' })}
                  </Body>
                  <Body tone="mute" size="caption">
                    {s.lastUsed
                      ? t({
                          id: 'sites.lastused',
                          message: 'Last used {d}',
                          values: { d: new Date(s.lastUsed).toLocaleDateString() },
                        })
                      : t({ id: 'sites.account.change', message: 'Tap to change' })}
                  </Body>
                </Column>
                <Body tone="arc" size="caption">
                  {seating === s.origin
                    ? t({ id: 'sites.account.done', message: 'Done' })
                    : t({ id: 'sites.account.key', message: 'Change' })}
                </Body>
              </Row>
            </Pressable>
            {seating === s.origin ? (
              <Column gap={2} testID={`site-accounts-${hostOf(s.origin)}`}>
                {accounts
                  .filter((a) => !a.hidden)
                  .map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => reseat(s.origin, a.id)}
                      accessibilityRole="button"
                      accessibilityLabel={a.label}
                      style={{ minHeight: 44, justifyContent: 'center' }}
                      testID={`site-account-${hostOf(s.origin)}-${a.id}`}
                    >
                      <Row gap="$3" alignItems="center">
                        <Signature address={a.address} size={26} />
                        <Column flex={1} minWidth={0} alignItems="flex-start">
                          <Body numberOfLines={1} fontWeight={a.id === s.accountId ? '600' : '400'}>
                            {a.label}
                          </Body>
                          <Body tone="mute" size="caption">
                            {shortAddress(a.address)}
                          </Body>
                        </Column>
                        {a.id === s.accountId ? (
                          <Body tone="arc" size="caption">
                            {t({ id: 'sites.account.current', message: 'In use' })}
                          </Body>
                        ) : null}
                      </Row>
                    </Pressable>
                  ))}
                <Body tone="mute" size="caption">
                  {t({
                    id: 'sites.account.body',
                    message:
                      'The site is told straight away, the way it would be if you switched accounts on the site itself. No other site and no other screen is affected.',
                  })}
                </Body>
              </Column>
            ) : null}
            {editing === s.origin ? (
              <Row gap="$2" flexWrap="wrap">
                {chains.map((c) => (
                  <Pill
                    key={c.chainId}
                    label={c.name}
                    icon={<ChainMark chainId={c.chainId} size={14} />}
                    selected={c.chainId === s.chainId}
                    size="sm"
                    onPress={() => {
                      setError(null)
                      engine.sites.setChain({ origin: s.origin, chainId: c.chainId }).then(
                        () => setEditing(null),
                        (err: unknown) =>
                          setError(err instanceof Error ? err.message : String(err)),
                      )
                    }}
                    testID={`site-chain-${hostOf(s.origin)}-${c.chainId}`}
                  />
                ))}
              </Row>
            ) : null}
            <Row>
              <Key
                label={t({ id: 'sites.disconnect', message: 'Disconnect' })}
                kind="danger"
                size="compact"
                onPress={() => void engine.sites.disconnect({ origin: s.origin })}
                testID={`site-disconnect-${hostOf(s.origin)}`}
              />
            </Row>
          </Plate>
        )
      })}
      {error ? <Body tone="burn">{error}</Body> : null}
      <Column gap="$1">
        <Body tone="mute" size="caption">
          {t({
            id: 'sites.note.v2',
            message:
              'Each site keeps its own account and its own chain. Changing what Home shows never changes a site, and changing a site never tells any other site.',
          })}
        </Body>
      </Column>
    </ScrollView>
  )
}
