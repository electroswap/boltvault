/**
 * The signing sheet (master plan §8.15) — one screen for sign.html, the
 * popup and the mobile sheet. Top to bottom: origin → who signs → statements
 * → risk plates → fee → verb. Quiet custody mode. Severity drives the
 * primary: warn delays it, danger asks for a typed word, block removes it.
 */
import { Body, Column, Field, Icon, Input, Key, Plate, Row, ScrollView, Signature, metrics, paint, shortAddress, useWindowDimensions } from '@boltvault/ui'
import { parseApprovalPayload, type AccountView, type ApprovalPayload, type ApprovalRequest, type AssessmentView, type ChainView, type StatementView } from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useFeel } from '../feel'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useApprovals } from '../state/useApprovals'
import { useWalletState } from '../state/useWalletState'

const FOCUS_INERT_MS = 600

export interface ApprovalProps {
  readonly requestId?: string
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly reducedMotion?: boolean
}

function siteOf(origin: string): { host: string; internal: boolean } {
  if (origin.startsWith('internal:')) return { host: 'BoltVault', internal: true }
  try {
    return { host: new URL(origin).host, internal: false }
  } catch {
    return { host: origin, internal: false }
  }
}

type BodyTone = 'ink' | 'mute' | 'arc' | 'ember' | 'burn'

function toneOf(tone: StatementView['tone']): BodyTone {
  return tone === 'out' ? 'ember' : tone === 'in' ? 'arc' : tone === 'warn' ? 'burn' : 'ink'
}

function severityTone(severity: AssessmentView['severity']): BodyTone {
  return severity === 'block' || severity === 'danger' ? 'burn' : severity === 'warn' ? 'ember' : 'mute'
}

function verbFor(payload: ApprovalPayload, origin: string): string {
  // Our own surfaces keep their verb through the flow (§7.10).
  if (origin === 'internal:send') return t({ id: 'key.send', message: 'Send' })
  if (origin === 'internal:approvals') return t({ id: 'allow.revoke', message: 'Revoke' })
  if (origin === 'internal:swap') return t({ id: 'swap.key', message: 'Swap' })
  if (origin === 'internal:limit') return t({ id: 'swap.limit.key', message: 'Place order' })
  if (origin === 'internal:limit:cancel') return t({ id: 'approval.cancel', message: 'Cancel' })
  if (origin === 'internal:nft:list') return t({ id: 'piece.list', message: 'List' })
  if (origin === 'internal:nft:offer') return t({ id: 'piece.offer', message: 'Offer' })
  if (origin === 'internal:nft:buy') return t({ id: 'piece.buy', message: 'Buy' })
  if (origin === 'internal:nft:accept') return t({ id: 'sign.accept', message: 'Accept' })
  if (origin === 'internal:nft:cancel') return t({ id: 'approval.cancel', message: 'Cancel' })
  if (origin === 'internal:nft:transfer') return t({ id: 'key.send', message: 'Send' })
  if (origin === 'internal:nft:mint') return t({ id: 'collection.mint.key', message: 'Mint' })
  if (origin === 'internal:farm:deposit') return t({ id: 'farm.deposit', message: 'Deposit' })
  if (origin === 'internal:farm:withdraw') return t({ id: 'farm.withdraw', message: 'Withdraw' })
  if (origin === 'internal:farm:collect') return t({ id: 'farm.collect', message: 'Collect' })
  if (origin === 'internal:launchpad:contribute') return t({ id: 'campaign.contribute', message: 'Contribute' })
  if (origin.startsWith('internal:launchpad:')) return t({ id: 'flow.claim', message: 'Claim' })
  if (origin === 'internal:legends:claim') return t({ id: 'flow.claim', message: 'Claim' })
  if (origin === 'internal:legends:register') return t({ id: 'legends.activateVerb', message: 'Activate' })
  switch (payload.kind) {
    case 'connect':
      return t({ id: 'approval.connect', message: 'Connect' })
    case 'switch_chain':
    case 'add_chain':
      return t({ id: 'approval.switch', message: 'Switch' })
    case 'watch_asset':
      return t({ id: 'approval.accept', message: 'Accept' })
    default:
      return t({ id: 'approval.sign', message: 'Sign' })
  }
}

function assessmentOf(payload: ApprovalPayload): AssessmentView | null {
  return 'assessment' in payload ? payload.assessment : null
}

export function Approval({ requestId, body, reducedMotion = false }: ApprovalProps) {
  const engine = useEngine()
  const host = useHost()
  const feel = useFeel()
  const router = useRouter()
  const { pending, loaded } = useApprovals()
  const { accounts, active } = useWalletState()
  const { width, height } = useWindowDimensions()
  const [chains, setChains] = useState<ChainView[]>([])
  const [typed, setTyped] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [armedAt, setArmedAt] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedAccount, setPickedAccount] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const request: ApprovalRequest | undefined = requestId ? pending.find((r) => r.id === requestId) : pending[0]
  const payload = useMemo(() => (request ? parseApprovalPayload(request.payload) : null), [request])
  const assessment = payload ? assessmentOf(payload) : null

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
  }, [engine])

  // Inert after the window gains focus or resizes (clickjacking, §3.5), and after the sheet first shows.
  useEffect(() => {
    if (!host.onWindowFocus) return
    return host.onWindowFocus(() => setArmedAt(Date.now()))
  }, [host])
  useEffect(() => {
    setArmedAt(Date.now())
    setTyped('')
    setShowRaw(false)
  }, [request?.id])
  const delayMs = Math.max(assessment?.presentation.delayMs ?? 0, host.onWindowFocus ? FOCUS_INERT_MS : 0)
  const enableAt = armedAt + delayMs
  useEffect(() => {
    if (now >= enableAt) return
    const id = setTimeout(() => setNow(Date.now()), enableAt - now + 10)
    return () => clearTimeout(id)
  }, [now, enableAt])

  // An already-permitted site only needed the unlock: decide without asking again.
  useEffect(() => {
    if (payload?.kind === 'connect' && payload.reconnect && request) {
      void engine.approvals.decide({ id: request.id, approve: true })
    }
  }, [payload, request, engine])

  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const finish = (): void => {
    if (host.body === 'extension-sign') host.closeWindow?.()
    else if (router.current.screen === 'sign') router.back()
  }

  if (!loaded) return <Column flex={1} backgroundColor="$void" testID="approval-loading" />
  if (!request || !payload) {
    return (
      <Column flex={1} backgroundColor="$void" padding={inset} gap="$4" justifyContent="center" testID="approval-empty">
        <Body size="title">{t({ id: 'approval.none', message: 'Nothing to sign' })}</Body>
        <Body tone="mute">{t({ id: 'approval.none.body', message: 'This request was already decided or has expired.' })}</Body>
        <Key label={t({ id: 'close', message: 'Close' })} kind="secondary" onPress={finish} testID="approval-close" />
      </Column>
    )
  }

  const site = siteOf(request.origin)
  const chainId = payload.kind === 'connect' ? payload.requestedChainId : payload.kind === 'switch_chain' || payload.kind === 'add_chain' ? payload.chainId : (request.chainId ?? 52014)
  const chain = chains.find((c) => c.chainId === chainId)
  const signer: AccountView | undefined = payload.kind === 'connect' ? (accounts.find((a) => a.id === (pickedAccount ?? active?.id)) ?? active ?? accounts[0]) : (accounts.find((a) => a.id === request.accountId) ?? active ?? undefined)
  const blocked = assessment?.presentation.blocked === true
  const needsTyped = assessment?.presentation.typedConfirmation ?? null
  const typedOk = !needsTyped || typed.trim().toLowerCase() === needsTyped.toLowerCase()
  const armed = now >= enableAt && typedOk && !busy
  const verb = verbFor(payload, request.origin)

  const decide = async (approve: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const data = approve && payload.kind === 'connect' && signer ? { accountId: signer.id, chainId } : undefined
      await engine.approvals.decide({ id: request.id, approve, ...(data ? { data } : {}) })
      if (approve) feel.confirm()
      else feel.heavy()
      if (pending.length <= 1) finish()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Column flex={1} backgroundColor="$void" testID="approval">
      <Field address={signer?.address ?? '0x0000000000000000000000000000000000000e7n'} quiet width={width} height={height} reducedMotion={reducedMotion} />
      <ScrollView style={{ zIndex: 1 }} contentContainerStyle={{ padding: inset, gap: 14, paddingBottom: 120 }}>
        {/* Origin */}
        <Column gap="$1" testID="approval-origin">
          <Row gap="$2">
            {site.internal ? null : <Icon name="lock" size={16} color={paint.mute} />}
            <Body size="title" numberOfLines={1} testID="approval-host">
              {site.host}
            </Body>
          </Row>
          <Row gap="$2">
            {payload.kind === 'connect' && payload.firstTime ? (
              <Body tone="ember" size="caption">
                {t({ id: 'approval.firstTime', message: 'First time here' })}
              </Body>
            ) : null}
            <Body tone="mute" size="caption">
              {chain ? chain.name : `Chain ${chainId}`}
            </Body>
          </Row>
        </Column>

        {/* Who signs */}
        {payload.kind === 'connect' ? (
          <Plate gap="$2" testID="approval-accounts">
            <Body tone="mute" size="caption">
              {t({ id: 'approval.connectAs', message: 'Connect as' })}
            </Body>
            {accounts
              .filter((a) => !a.hidden)
              .map((a) => (
                <Row key={a.id} gap="$3" minHeight={44} onPress={() => setPickedAccount(a.id)} cursor="pointer" testID={`approval-account-${a.id}`}>
                  <Signature address={a.address} size={28} />
                  <Column flex={1}>
                    <Body numberOfLines={1}>{a.label}</Body>
                    <Body tone="mute" size="caption">
                      {shortAddress(a.address)}
                    </Body>
                  </Column>
                  {signer?.id === a.id ? (
                    <Body tone="arc" size="caption">
                      {t({ id: 'approval.selected', message: 'Selected' })}
                    </Body>
                  ) : null}
                </Row>
              ))}
            <Body tone="mute" size="caption">
              {t({ id: 'approval.connect.body', message: 'The site will see this address and can ask you to sign. It cannot move anything without a signature.' })}
            </Body>
          </Plate>
        ) : signer ? (
          <Row gap="$3" testID="approval-signer">
            <Signature address={signer.address} size={28} />
            <Column flex={1}>
              <Body numberOfLines={1}>{signer.label}</Body>
              <Body tone="mute" size="caption">
                {shortAddress(signer.address)}
              </Body>
            </Column>
          </Row>
        ) : null}

        {/* Statements */}
        {assessment ? (
          <Plate role="raised" gap="$2" testID="approval-statements">
            {assessment.statements.map((s, i) => (
              <Body key={i} tone={toneOf(s.tone)} testID={`approval-statement-${i}`}>
                {s.text}
              </Body>
            ))}
            {assessment.changes.length ? (
              <Column gap={2} marginTop={4}>
                <Body tone="mute" size="caption">
                  {t({ id: 'approval.preview', message: 'Preview of what moves' })}
                </Body>
                {assessment.changes.map((s, i) => (
                  <Body key={i} tone={toneOf(s.tone)} size="caption">
                    {s.text}
                  </Body>
                ))}
              </Column>
            ) : null}
          </Plate>
        ) : null}

        {payload.kind === 'switch_chain' || payload.kind === 'add_chain' ? (
          <Plate role="raised" gap="$1">
            <Body>{t({ id: 'approval.switch.body', message: 'Switch this site to {chain}', values: { chain: chain?.name ?? String(payload.chainId) } })}</Body>
          </Plate>
        ) : null}

        {payload.kind === 'watch_asset' ? (
          <Column gap="$2" testID="approval-watch">
            <Plate role="raised" gap={2}>
              <Body size="title">{payload.onChain ? t({ id: 'approval.watch.title', message: 'Add {s} to your tokens', values: { s: payload.onChain.symbol } }) : t({ id: 'approval.watch.title.unknown', message: 'Add a token to your list' })}</Body>
              <Body tone="mute" size="caption">
                {payload.address ? shortAddress(payload.address) : '—'}
              </Body>
              {payload.onChain ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'approval.watch.onchain', message: 'On chain: {n} · {d} decimals', values: { n: payload.onChain.name, d: payload.onChain.decimals } })}
                </Body>
              ) : (
                <Body tone="ember" size="caption">
                  {t({ id: 'approval.watch.nocode', message: 'No contract answered at that address on this chain.' })}
                </Body>
              )}
            </Plate>
            {payload.mismatch && payload.onChain ? (
              <Plate gap={2} borderColor={paint.burn} testID="approval-watch-mismatch">
                <Body tone="burn">{t({ id: 'approval.watch.mismatch', message: 'The site calls it {s} with {d} decimals; the contract says {cs} with {cd}.', values: { s: payload.symbol ?? '?', d: payload.decimals ?? '?', cs: payload.onChain.symbol, cd: payload.onChain.decimals } })}</Body>
                <Body tone="mute" size="caption">
                  {t({ id: 'approval.watch.mismatch.body', message: 'BoltVault shows the contract’s own name and decimals, never the site’s.' })}
                </Body>
              </Plate>
            ) : null}
          </Column>
        ) : null}

        {/* Risk plates */}
        {assessment?.rules
          .filter((r) => r.severity !== 'info')
          .map((r) => (
            <Plate key={r.code} gap={4} borderColor={r.severity === 'warn' ? paint.ember : r.severity === 'info' ? paint.mute : paint.burn} testID={`approval-rule-${r.code}`}>
              <Body tone={severityTone(r.severity)}>{r.title}</Body>
              <Body tone="mute" size="caption">
                {r.detail}
              </Body>
            </Plate>
          ))}

        {/* Details */}
        {payload.kind === 'sign_typed_data' ? (
          <Column gap="$2">
            <Body tone="mute" size="caption" onPress={() => setShowRaw((v) => !v)} testID="approval-raw-toggle">
              {showRaw ? t({ id: 'approval.raw.hide', message: 'Hide the raw message' }) : t({ id: 'approval.raw.show', message: 'Show the raw message ({type})', values: { type: payload.primaryType } })}
            </Body>
            {showRaw ? (
              <Plate>
                <Body size="caption" testID="approval-raw">
                  {JSON.stringify(payload.typedData, null, 1).slice(0, 4000)}
                </Body>
              </Plate>
            ) : null}
          </Column>
        ) : null}
        {payload.kind === 'send_transaction' ? (
          <Row justifyContent="space-between" testID="approval-fee">
            <Body tone="mute" size="caption">
              {t({ id: 'approval.fee', message: 'Network fee up to' })}
            </Body>
            <Body size="caption">{`${formatWei(payload.fee.maxTotalWei)} ${payload.fee.symbol}`}</Body>
          </Row>
        ) : null}
        {signer && (signer.kind === 'ledger' || signer.kind === 'trezor' || signer.kind === 'keystone') && (payload.kind === 'send_transaction' || payload.kind === 'sign_typed_data' || payload.kind === 'sign_message') ? (
          <Plate gap="$1" testID="approval-device">
            <Body size="caption">{t({ id: 'approval.device', message: 'What your {d} shows', values: { d: signer.kind === 'ledger' ? 'Ledger' : signer.kind === 'trezor' ? 'Trezor' : 'Keystone' } })}</Body>
            {payload.kind === 'send_transaction' ? (
              <>
                <DeviceRow label={t({ id: 'device.to', message: 'To' })} value={payload.tx.to ?? t({ id: 'device.deploy', message: 'new contract' })} />
                <DeviceRow label={t({ id: 'device.amount', message: 'Amount' })} value={`${formatWei(BigInt(payload.tx.value).toString())} ${payload.fee.symbol}`} />
                <DeviceRow label={t({ id: 'device.maxfee', message: 'Max fee' })} value={`${formatWei(payload.fee.maxTotalWei)} ${payload.fee.symbol}`} />
                <DeviceRow label={t({ id: 'device.nonce', message: 'Nonce' })} value={String(payload.tx.nonce)} />
                <DeviceRow label={t({ id: 'device.chain', message: 'Chain' })} value={String(request.chainId ?? '')} />
                <Body tone="mute" size="caption">
                  {payload.tx.data && payload.tx.data !== '0x' ? t({ id: 'device.blind', message: 'The device shows the amount and the address; the data is a hash, so use the statements above as the truth. Blind signing must be on in the Ethereum app.' }) : t({ id: 'device.plain', message: 'A plain send: the device shows exactly these fields.' })}
                </Body>
              </>
            ) : payload.kind === 'sign_typed_data' ? (
              <Body tone="mute" size="caption">
                {t({ id: 'device.typed', message: 'The device shows two hashes (domain and message) — the statements above are what they mean.' })}
              </Body>
            ) : (
              <Body tone="mute" size="caption">
                {t({ id: 'device.message', message: 'The device shows the message text.' })}
              </Body>
            )}
          </Plate>
        ) : null}
        {payload.kind === 'send_transaction' && assessment?.simulationMode !== 'trace' ? (
          <Body tone="mute" size="caption">
            {t({ id: 'approval.nopreview', message: 'No balance preview on this network — only the revert check ran.' })}
          </Body>
        ) : null}

        {needsTyped && !blocked ? (
          <Input value={typed} onChange={setTyped} label={t({ id: 'approval.typed', message: 'Type {word} to continue', values: { word: needsTyped } })} autoCapitalize="none" testID="approval-typed" />
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
      </ScrollView>

      {/* Verbs */}
      <Column position="absolute" left={0} right={0} bottom={0} padding={inset} gap="$2" backgroundColor="$void" zIndex={2} testID="approval-verbs">
        {blocked ? (
          <Body tone="burn" size="caption" testID="approval-blocked">
            {t({ id: 'approval.blocked', message: 'BoltVault will not sign this. See why above.' })}
          </Body>
        ) : (
          <Key label={verb} onPress={() => decide(true)} disabled={!armed} testID="approval-primary" />
        )}
        <Key label={t({ id: 'approval.reject', message: 'Reject' })} kind="secondary" onPress={() => decide(false)} disabled={busy} testID="approval-reject" />
        {pending.length > 1 ? (
          <Body tone="mute" size="caption">
            {t({ id: 'approval.more', message: '{n} more waiting', values: { n: pending.length - 1 } })}
          </Body>
        ) : null}
      </Column>
    </Column>
  )
}

function formatWei(wei: string): string {
  const n = BigInt(wei)
  const whole = n / 10n ** 18n
  const frac = (n % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

function DeviceRow({ label, value }: { label: string; value: string }) {
  return (
    <Row justifyContent="space-between" gap="$3">
      <Body tone="mute" size="caption">
        {label}
      </Body>
      <Body size="caption" numberOfLines={1} flexShrink={1}>
        {value}
      </Body>
    </Row>
  )
}
