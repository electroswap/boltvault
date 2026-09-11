/**
 * The signing sheet (master plan §8.15) — one screen for sign.html, the
 * popup and the mobile sheet. Top to bottom: origin → who signs → statements
 * → risk plates → fee → verb. Quiet custody mode. Severity drives the
 * primary: warn delays it, danger asks for a typed word, block removes it.
 */
import {
  BarLoader,
  Body,
  Column,
  Field,
  Icon,
  Input,
  Key,
  Plate,
  Row,
  ScrollView,
  Signature,
  metrics,
  paint,
  shortAddress,
  useWindowDimensions,
} from '@boltvault/ui'
import {
  parseApprovalPayload,
  type AccountView,
  type ApprovalPayload,
  type ApprovalRequest,
  type AssessmentView,
  type ChainView,
  type StatementView,
} from '@boltvault/engine'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useFeel } from '../feel'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useApprovals } from '../state/useApprovals'
import { useWalletState } from '../state/useWalletState'
import { useScene } from '../state/useScene'

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
  return severity === 'block' || severity === 'danger'
    ? 'burn'
    : severity === 'warn'
      ? 'ember'
      : 'mute'
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
  if (origin === 'internal:launchpad:contribute')
    return t({ id: 'campaign.contribute', message: 'Contribute' })
  if (origin.startsWith('internal:launchpad:')) return t({ id: 'flow.claim', message: 'Claim' })
  if (origin === 'internal:legends:claim') return t({ id: 'flow.claim', message: 'Claim' })
  if (origin === 'internal:legends:register')
    return t({ id: 'legends.activateVerb', message: 'Activate' })
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
  const { accounts, active, vault, loading: vaultLoading } = useWalletState()
  const { width, height } = useWindowDimensions()
  const scene = useScene()
  const [chains, setChains] = useState<ChainView[]>([])
  const [typed, setTyped] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [armedAt, setArmedAt] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedAccount, setPickedAccount] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  /*
    The transaction's own fields, for every signer.

    These used to render only inside the "what your device shows" plate, which
    is gated on a Ledger/Trezor/Keystone — so someone signing with a software
    key could not see the destination, the value, the calldata or the nonce
    anywhere in the product, and every address that did reach the screen was
    truncated to eight nibbles. The statements stay the primary surface; this
    is the fallback that has to exist when the decoder has nothing useful to
    say (§3.4).
  */
  const [showTx, setShowTx] = useState(false)

  const request: ApprovalRequest | undefined = requestId
    ? pending.find((r) => r.id === requestId)
    : pending[0]
  const payload = useMemo(() => (request ? parseApprovalPayload(request.payload) : null), [request])
  const assessment = payload ? assessmentOf(payload) : null

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
  }, [engine])

  /*
    A typed-data message the decoder cannot explain opens with its raw body
    already showing. `TYPED_DATA_UNKNOWN` means the statements above are, by
    definition, not describing what is about to be signed — so the one surface
    that does describe it should not be behind a tap the user has no reason to
    know to make.
  */
  const unknownTyped = assessment?.rules.some((r) => r.code === 'TYPED_DATA_UNKNOWN') ?? false
  useEffect(() => {
    if (unknownTyped) setShowRaw(true)
  }, [unknownTyped])

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
  const delayMs = Math.max(
    assessment?.presentation.delayMs ?? 0,
    host.onWindowFocus ? FOCUS_INERT_MS : 0,
  )
  const enableAt = armedAt + delayMs
  useEffect(() => {
    if (now >= enableAt) return
    const id = setTimeout(() => setNow(Date.now()), enableAt - now + 10)
    return () => clearTimeout(id)
  }, [now, enableAt])

  /*
    An already-permitted site only needed the unlock: decide without asking again.

    "Needed the unlock" is the whole condition, and it used to go unchecked.
    This screen is reachable for a moment before the vault status has arrived —
    TabShell cannot replace it with Unlock until it knows the vault is locked —
    and in that moment the effect approved a reconnect for a LOCKED vault. The
    decision closed the sign window (owner: "the extension pop-up flickers open
    and then immediately closes"), and the connect then failed 4100 in the
    engine, because a locked vault lists no accounts. The site was left holding
    an error for a request it could no longer answer, and unlocking afterwards
    could not revive it: the request had already been spent.

    So the unlock is waited for, here and in the engine (`approvals.decide`
    refuses a yes while locked). Unlocking re-runs this effect and the
    reconnect completes then, which is what the site is waiting for.
  */
  useEffect(() => {
    if (vaultLoading || !vault?.unlocked) return
    if (payload?.kind === 'connect' && payload.reconnect && request) {
      void engine.approvals.decide({ id: request.id, approve: true })
    }
  }, [payload, request, engine, vault?.unlocked, vaultLoading])

  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const finish = useCallback((): void => {
    if (host.body === 'extension-sign') host.closeWindow?.()
    else if (router.current.screen === 'sign') router.back()
  }, [host, router])

  /*
    A request that leaves the queue while this screen is showing it has been
    answered — signed, rejected, or decided on another surface — and this sheet
    is finished.

    `decide` closes the sheet itself for everything that ends the moment the
    key is pressed, but not for the kinds that go to `signing`: those stay here
    on purpose while the device is asked. Nothing then closed the screen when
    the signature finally landed, so the sheet stayed up and re-rendered as
    "Nothing to sign" — the empty state meant for an expired request, shown at
    the exact moment the send had in fact succeeded.
  */
  /*
    Who signs, and on what — needed above the early returns because the Ledger
    preflight below is a hook and hooks cannot live behind a `return`.
  */
  const signer: AccountView | undefined =
    !payload || !request
      ? undefined
      : payload.kind === 'connect'
        ? (accounts.find((a) => a.id === (pickedAccount ?? active?.id)) ?? active ?? accounts[0])
        : (accounts.find((a) => a.id === request.accountId) ?? active ?? undefined)
  /** The device that has to be touched, when one does. Null for a soft key. */
  const deviceName =
    signer &&
    payload &&
    (payload.kind === 'send_transaction' ||
      payload.kind === 'sign_typed_data' ||
      payload.kind === 'sign_message')
      ? signer.kind === 'ledger'
        ? 'Ledger'
        : signer.kind === 'trezor'
          ? 'Trezor'
          : signer.kind === 'keystone'
            ? 'Keystone'
            : null
      : null
  const signing = request?.status === 'signing'

  /*
    Ask the Ledger whether it can sign before the user commits to finding out.

    On the dashboard the Ethereum app's APDU class belongs to nothing running,
    and some firmware answers by not answering — so pressing the verb used to
    buy a minute of spinner. The engine now refuses that send quickly
    (`signerFor`), but a refusal after the press is still a wasted press: this
    asks while the sheet is being read, and says the one sentence that fixes
    it. The probe is bounded, shows nothing on the device, and stops the moment
    the device is ready or the signer has it.
  */
  const [ledger, setLedger] = useState<{ ready: boolean; message: string | null } | null>(null)
  const probeLedger = deviceName === 'Ledger' && !busy && !signing && ledger?.ready !== true
  useEffect(() => {
    if (deviceName !== 'Ledger') {
      setLedger(null)
      return
    }
    if (!probeLedger) return
    let alive = true
    const check = (): void => {
      void engine.hardware.ledgerPreflight().then(
        (r) => alive && setLedger({ ready: r.state === 'ready', message: r.message }),
        () => undefined,
      )
    }
    check()
    // Plugging it in or opening the app should clear the notice by itself.
    const timer = setInterval(check, 4_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [engine, deviceName, probeLedger])

  /*
    Leaving without deciding is a rejection.

    Android's back gesture pops this sheet like any other screen, and the
    request it was asking about stayed in the queue — undecided, for its full
    five minutes — with the flow behind it still waiting. Owner, after backing
    out of a bridge: "going back into Bridge from the home screen shows
    'Bridging', 'Place order' and 'Waiting for you', but there are no actions
    for me to perform."

    A sheet that offers Reject has no third answer. Dismissing it IS the
    reject, and saying so releases the flow — which already reads a rejection
    as a rejection (`flows.ts`) — and lets the screen or the site ask again.

    Only a request still `pending`, and only when we did not decide it
    ourselves: one that reached `signing` is in the device's hands, and this
    screen is no longer the one answering for it.

    And only when the user is the one leaving. The shell replaces every screen
    with Unlock the moment the vault locks (`TabShell`), which unmounts this one
    — so treating that as a dismissal answered the request on the user's behalf,
    closed the sign window and left the site holding a rejection it never asked
    for. That is the "flickers open and then immediately closes" report, exactly,
    reintroduced from the other side: a locked vault must PARK the request until
    the password arrives, which is what `locked-connect.spec.ts` pins.
  */
  const decided = useRef(false)
  const undecided = useRef<string | null>(null)
  undecided.current = request?.status === 'pending' && !decided.current ? request.id : null
  // Read at cleanup, so it reflects the state that caused the unmount.
  const lockedOut = useRef(false)
  lockedOut.current = vaultLoading || !vault?.unlocked
  useEffect(
    () => () => {
      const id = undecided.current
      if (id === null || lockedOut.current) return
      void engine.approvals.decide({ id, approve: false }).catch(() => undefined)
    },
    [engine],
  )

  const shown = useRef<string | null>(null)
  useEffect(() => {
    if (!loaded) return
    if (request) {
      shown.current = request.id
      return
    }
    if (shown.current === null) return
    shown.current = null
    finish()
  }, [request, loaded, finish])

  if (!loaded) return <Column flex={1} backgroundColor="$void" testID="approval-loading" />
  if (!request || !payload) {
    return (
      <Column
        flex={1}
        backgroundColor="$void"
        padding={inset}
        gap="$4"
        justifyContent="center"
        testID="approval-empty"
      >
        <Body size="title">{t({ id: 'approval.none', message: 'Nothing to sign' })}</Body>
        <Body tone="mute">
          {t({
            id: 'approval.none.body',
            message: 'This request was already decided or has expired.',
          })}
        </Body>
        <Key
          label={t({ id: 'close', message: 'Close' })}
          kind="secondary"
          onPress={finish}
          testID="approval-close"
        />
      </Column>
    )
  }

  const site = siteOf(request.origin)
  const chainId =
    payload.kind === 'connect'
      ? payload.requestedChainId
      : payload.kind === 'switch_chain' || payload.kind === 'add_chain'
        ? payload.chainId
        : (request.chainId ?? 52014)
  const chain = chains.find((c) => c.chainId === chainId)
  const blocked = assessment?.presentation.blocked === true
  const needsTyped = assessment?.presentation.typedConfirmation ?? null
  const typedOk = !needsTyped || typed.trim().toLowerCase() === needsTyped.toLowerCase()
  // A device that has told us it cannot sign holds the verb: pressing it would
  // only spend a round trip to be told the same thing.
  const armed = now >= enableAt && typedOk && !busy && !signing && ledger?.ready !== false
  const verb = verbFor(payload, request.origin)

  const decide = async (approve: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const data =
        approve && payload.kind === 'connect' && signer
          ? { accountId: signer.id, chainId }
          : undefined
      const outcome = await engine.approvals.decide({
        id: request.id,
        approve,
        ...(data ? { data } : {}),
      })
      // Ours now: the unmount above must not reject it a second time. Left
      // false when `decide` throws, so abandoning a failed attempt still does.
      decided.current = true
      if (approve) feel.confirm()
      else feel.heavy()
      /*
        A yes on something that gets signed is not the end any more: the
        request goes to `signing` and stays on this screen until the signer
        answers. Closing here would take the sheet away while a Ledger was
        still waiting to be pressed, and would hide a refusal that the user
        needs to see in order to try again. The request leaving the queue is
        what finishes this screen.
      */
      if (outcome.status !== 'signing' && pending.length <= 1) finish()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Column flex={1} backgroundColor="$void" testID="approval">
      <Field
        scene={scene}
        address={signer?.address ?? '0x0000000000000000000000000000000000000e7n'}
        quiet
        width={width}
        height={height}
        reducedMotion={reducedMotion}
      />
      <ScrollView
        style={{ zIndex: 1 }}
        contentContainerStyle={{ padding: inset, gap: 14, paddingBottom: 120 }}
      >
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
                <Row
                  key={a.id}
                  gap="$3"
                  minHeight={44}
                  onPress={() => setPickedAccount(a.id)}
                  cursor="pointer"
                  testID={`approval-account-${a.id}`}
                >
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
              {t({
                id: 'approval.connect.body',
                message:
                  'The site will see this address and can ask you to sign. It cannot move anything without a signature.',
              })}
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
            {/* Capped: a statement carries names a site or a contract chose, so no single one may consume the sheet and push the verb off screen. */}
            {assessment.statements.map((s, i) => (
              <Body
                key={i}
                tone={toneOf(s.tone)}
                numberOfLines={4}
                testID={`approval-statement-${i}`}
              >
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
            <Body>
              {t({
                id: 'approval.switch.body',
                message: 'Switch this site to {chain}',
                values: { chain: chain?.name ?? String(payload.chainId) },
              })}
            </Body>
          </Plate>
        ) : null}

        {payload.kind === 'watch_asset' ? (
          <Column gap="$2" testID="approval-watch">
            <Plate role="raised" gap={2}>
              <Body size="title">
                {payload.onChain
                  ? t({
                      id: 'approval.watch.title',
                      message: 'Add {s} to your tokens',
                      values: { s: payload.onChain.symbol },
                    })
                  : t({ id: 'approval.watch.title.unknown', message: 'Add a token to your list' })}
              </Body>
              <Body tone="mute" size="caption">
                {payload.address ? shortAddress(payload.address) : '—'}
              </Body>
              {payload.onChain ? (
                <Body tone="mute" size="caption">
                  {t({
                    id: 'approval.watch.onchain',
                    message: 'On chain: {n} · {d} decimals',
                    values: { n: payload.onChain.name, d: payload.onChain.decimals },
                  })}
                </Body>
              ) : (
                <Body tone="ember" size="caption">
                  {t({
                    id: 'approval.watch.nocode',
                    message: 'No contract answered at that address on this chain.',
                  })}
                </Body>
              )}
            </Plate>
            {payload.mismatch && payload.onChain ? (
              <Plate gap={2} borderColor={paint.burn} testID="approval-watch-mismatch">
                <Body tone="burn">
                  {t({
                    id: 'approval.watch.mismatch',
                    message:
                      'The site calls it {s} with {d} decimals; the contract says {cs} with {cd}.',
                    values: {
                      s: payload.symbol ?? '?',
                      d: payload.decimals ?? '?',
                      cs: payload.onChain.symbol,
                      cd: payload.onChain.decimals,
                    },
                  })}
                </Body>
                <Body tone="mute" size="caption">
                  {t({
                    id: 'approval.watch.mismatch.body',
                    message:
                      'BoltVault shows the contract’s own name and decimals, never the site’s.',
                  })}
                </Body>
              </Plate>
            ) : null}
          </Column>
        ) : null}

        {/* Risk plates */}
        {assessment?.rules
          .filter((r) => r.severity !== 'info')
          .map((r) => (
            <Plate
              key={r.code}
              gap={4}
              borderColor={
                r.severity === 'warn'
                  ? paint.ember
                  : r.severity === 'info'
                    ? paint.mute
                    : paint.burn
              }
              testID={`approval-rule-${r.code}`}
            >
              <Body tone={severityTone(r.severity)}>{r.title}</Body>
              <Body tone="mute" size="caption">
                {r.detail}
              </Body>
            </Plate>
          ))}

        {/* Details */}
        {payload.kind === 'sign_typed_data' ? (
          <Column gap="$2">
            {/*
              The domain says which contract, on which chain, this signature is
              valid for. It is the part of a typed-data message that decides
              where the signature can be replayed, so it is always on screen —
              never behind the raw-message toggle.
            */}
            <Plate gap="$1" testID="approval-domain">
              <DetailRow
                label={t({ id: 'typed.type', message: 'Message type' })}
                value={payload.primaryType}
                testID="approval-domain-type"
              />
              <DetailRow
                label={t({ id: 'typed.domain', message: 'Domain' })}
                value={payload.domainName ?? t({ id: 'typed.domain.none', message: 'not named' })}
                testID="approval-domain-name"
              />
              <DetailRow
                label={t({ id: 'typed.contract', message: 'Valid for contract' })}
                value={
                  typedDomain(payload.typedData).verifyingContract ??
                  t({ id: 'typed.contract.none', message: 'not stated' })
                }
                testID="approval-domain-contract"
              />
              <DetailRow
                label={t({ id: 'typed.chain', message: 'Valid on chain' })}
                value={
                  typedDomain(payload.typedData).chainId ??
                  t({ id: 'typed.chain.none', message: 'not stated' })
                }
                testID="approval-domain-chain"
              />
            </Plate>
            <Body
              tone="mute"
              size="caption"
              onPress={() => setShowRaw((v) => !v)}
              testID="approval-raw-toggle"
            >
              {showRaw
                ? t({ id: 'approval.raw.hide', message: 'Hide the raw message' })
                : t({
                    id: 'approval.raw.show',
                    message: 'Show the raw message ({type})',
                    values: { type: payload.primaryType },
                  })}
            </Body>
            {showRaw ? (
              <Plate>
                {/* Truncation is stated, never silent: a cut the user cannot see is a cut they cannot account for. */}
                <Body size="caption" selectable testID="approval-raw">
                  {rawJson(payload.typedData)}
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
        {payload.kind === 'send_transaction' ? (
          <Column gap="$2">
            <Body
              tone="mute"
              size="caption"
              onPress={() => setShowTx((v) => !v)}
              testID="approval-tx-toggle"
            >
              {showTx
                ? t({ id: 'approval.tx.hide', message: 'Hide the transaction details' })
                : t({ id: 'approval.tx.show', message: 'Show the transaction details' })}
            </Body>
            {showTx ? (
              <Plate gap="$1" testID="approval-tx">
                <DetailRow
                  label={t({ id: 'tx.to', message: 'To' })}
                  value={payload.tx.to ?? t({ id: 'device.deploy', message: 'new contract' })}
                  testID="approval-tx-to"
                />
                <DetailRow
                  label={t({ id: 'tx.from', message: 'From' })}
                  value={payload.tx.from}
                  testID="approval-tx-from"
                />
                <DetailRow
                  label={t({ id: 'tx.value', message: 'Value' })}
                  value={`${formatWei(BigInt(payload.tx.value).toString())} ${payload.fee.symbol}`}
                  testID="approval-tx-value"
                />
                <DetailRow
                  label={t({ id: 'tx.chain', message: 'Network' })}
                  value={chain ? `${chain.name} (${chain.chainId})` : String(chainId)}
                  testID="approval-tx-chain"
                />
                <DetailRow
                  label={t({ id: 'tx.nonce', message: 'Nonce' })}
                  value={String(payload.tx.nonce)}
                  testID="approval-tx-nonce"
                />
                <DetailRow
                  label={t({ id: 'tx.gas', message: 'Gas limit' })}
                  value={payload.fee.gasLimit}
                  testID="approval-tx-gas"
                />
                <DetailRow
                  label={t({ id: 'tx.maxfee', message: 'Max network fee' })}
                  value={`${formatWei(payload.fee.maxTotalWei)} ${payload.fee.symbol}`}
                  testID="approval-tx-maxfee"
                />
                {payload.tx.data && payload.tx.data !== '0x' ? (
                  <>
                    <DetailRow
                      label={t({ id: 'tx.selector', message: 'Function' })}
                      value={payload.tx.data.slice(0, 10)}
                      testID="approval-tx-selector"
                    />
                    <DetailRow
                      label={t({
                        id: 'tx.data',
                        message: 'Data ({n} bytes)',
                        values: { n: Math.max(0, (payload.tx.data.length - 2) / 2) },
                      })}
                      value={payload.tx.data}
                      testID="approval-tx-data"
                    />
                  </>
                ) : (
                  <DetailRow
                    label={t({ id: 'tx.data', message: 'Data' })}
                    value={t({ id: 'tx.data.none', message: 'none' })}
                    testID="approval-tx-data"
                  />
                )}
              </Plate>
            ) : null}
          </Column>
        ) : null}
        {payload.kind === 'sign_message' ? (
          <Column gap="$2">
            <Body
              tone="mute"
              size="caption"
              onPress={() => setShowTx((v) => !v)}
              testID="approval-msg-toggle"
            >
              {showTx
                ? t({ id: 'approval.msg.hide', message: 'Hide the exact message' })
                : t({ id: 'approval.msg.show', message: 'Show the exact message' })}
            </Body>
            {showTx ? (
              <Plate gap="$1" testID="approval-msg">
                <DetailRow
                  label={t({ id: 'msg.signer', message: 'Signed by' })}
                  value={payload.from}
                  testID="approval-msg-from"
                />
                <DetailRow
                  label={t({ id: 'msg.raw', message: 'Message' })}
                  value={payload.text ?? payload.message}
                  testID="approval-msg-body"
                />
              </Plate>
            ) : null}
          </Column>
        ) : null}
        {/*
          The device card and "no Ledger is connected" are one slot.

          They used to be two: this card, describing what the Ledger would show,
          and a separate plate down by the keys saying no Ledger was connected —
          both on screen at once, telling the signer to read a screen that was
          not there. Owner: "we have a 'What your Ledger shows' card while
          simultaneously showing 'No Ledger is connected', which is confusing."

          So the slot holds whichever is true. `ledger` is null for Trezor and
          Keystone, which have no readiness probe, so their card shows as before.
        */}
        {signer &&
        (signer.kind === 'ledger' || signer.kind === 'trezor' || signer.kind === 'keystone') &&
        (payload.kind === 'send_transaction' ||
          payload.kind === 'sign_typed_data' ||
          payload.kind === 'sign_message') ? (
          ledger && !ledger.ready && !signing ? (
            <Plate gap={2} borderColor={paint.ember} testID="approval-device-notready">
              <Body tone="ember" size="caption">
                {ledger.message ??
                  t({
                    id: 'approval.ledger.notready',
                    message: 'Your Ledger is not ready to sign.',
                  })}
              </Body>
              <Body tone="mute" size="caption">
                {t({
                  id: 'approval.ledger.notready.body',
                  message:
                    'This clears by itself once the device is unlocked with the Ethereum app open.',
                })}
              </Body>
            </Plate>
          ) : (
            <Plate gap="$1" testID="approval-device">
              <Body size="caption">
                {t({
                  id: 'approval.device',
                  message: 'What your {d} shows',
                  values: {
                    d:
                      signer.kind === 'ledger'
                        ? 'Ledger'
                        : signer.kind === 'trezor'
                          ? 'Trezor'
                          : 'Keystone',
                  },
                })}
              </Body>
              {payload.kind === 'send_transaction' ? (
                <>
                  <DeviceRow
                    label={t({ id: 'device.to', message: 'To' })}
                    value={payload.tx.to ?? t({ id: 'device.deploy', message: 'new contract' })}
                  />
                  <DeviceRow
                    label={t({ id: 'device.amount', message: 'Amount' })}
                    value={`${formatWei(BigInt(payload.tx.value).toString())} ${payload.fee.symbol}`}
                  />
                  <DeviceRow
                    label={t({ id: 'device.maxfee', message: 'Max fee' })}
                    value={`${formatWei(payload.fee.maxTotalWei)} ${payload.fee.symbol}`}
                  />
                  <DeviceRow
                    label={t({ id: 'device.nonce', message: 'Nonce' })}
                    value={String(payload.tx.nonce)}
                  />
                  <DeviceRow
                    label={t({ id: 'device.chain', message: 'Chain' })}
                    value={String(request.chainId ?? '')}
                  />
                  <Body tone="mute" size="caption">
                    {payload.tx.data && payload.tx.data !== '0x'
                      ? t({
                          id: 'device.blind',
                          message:
                            'The device shows the amount and the address; the data is a hash, so use the statements above as the truth. Blind signing must be on in the Ethereum app.',
                        })
                      : t({
                          id: 'device.plain',
                          message: 'A plain send: the device shows exactly these fields.',
                        })}
                  </Body>
                </>
              ) : payload.kind === 'sign_typed_data' ? (
                <Body tone="mute" size="caption">
                  {t({
                    id: 'device.typed',
                    message:
                      'The device shows two hashes (domain and message) — the statements above are what they mean.',
                  })}
                </Body>
              ) : (
                <Body tone="mute" size="caption">
                  {t({ id: 'device.message', message: 'The device shows the message text.' })}
                </Body>
              )}
            </Plate>
          )
        ) : null}

        {needsTyped && !blocked ? (
          <Input
            value={typed}
            onChange={setTyped}
            label={t({
              id: 'approval.typed',
              message: 'Type {word} to continue',
              values: { word: needsTyped },
            })}
            autoCapitalize="none"
            testID="approval-typed"
          />
        ) : null}
        {/*
          `lastError` is the reason a previous attempt did not produce a
          signature — the request came back to the queue carrying it, so the
          user is told why before being asked again.
        */}
        {(error ?? request.lastError) ? (
          <Body tone="burn" testID="approval-error">
            {error ?? request.lastError}
          </Body>
        ) : null}
      </ScrollView>

      {/* Verbs */}
      <Column
        position="absolute"
        left={0}
        right={0}
        bottom={0}
        padding={inset}
        gap="$2"
        backgroundColor="$void"
        zIndex={2}
        testID="approval-verbs"
      >
        {/*
          A hardware signer wants a button pressed on the device, and this
          screen used to say nothing about that — approving simply greyed the
          keys out while the Ledger waited to be noticed. Owner: "I also want
          to wait for the confirmation from the hardware wallet when
          applicable."
        */}
        {(busy || signing) && deviceName ? (
          <Column gap="$2" testID="approval-awaiting-device">
            <BarLoader active reducedMotion={reducedMotion} />
            <Body tone="arc" size="caption">
              {t({
                id: 'approval.awaitDevice',
                message: 'Confirm on your {d}. Check the details on its screen before you approve.',
                values: { d: deviceName },
              })}
            </Body>
          </Column>
        ) : null}
        {blocked ? (
          <Body tone="burn" size="caption" testID="approval-blocked">
            {t({ id: 'approval.blocked', message: 'BoltVault will not sign this. See why above.' })}
          </Body>
        ) : (
          <Key
            label={verb}
            onPress={() => decide(true)}
            disabled={!armed}
            testID="approval-primary"
          />
        )}
        <Key
          label={t({ id: 'approval.reject', message: 'Reject' })}
          kind="secondary"
          onPress={() => decide(false)}
          disabled={busy}
          testID="approval-reject"
        />
        {pending.length > 1 ? (
          <Body tone="mute" size="caption">
            {t({
              id: 'approval.more',
              message: '{n} more waiting',
              values: { n: pending.length - 1 },
            })}
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

/** The raw JSON of a typed-data message, with any truncation stated rather than silent. */
const RAW_MAX = 12_000
function rawJson(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value, null, 1) ?? ''
  } catch {
    return '(this message could not be rendered)'
  }
  if (text.length <= RAW_MAX) return text
  return `${text.slice(0, RAW_MAX)}\n… ${text.length - RAW_MAX} more characters not shown`
}

/**
 * The domain of a typed-data message, read from the payload the sheet renders —
 * which is the same record that gets signed, so what is shown here and what is
 * hashed cannot drift apart.
 */
function typedDomain(value: unknown): { verifyingContract: string | null; chainId: string | null } {
  const d = (value as { domain?: Record<string, unknown> } | null)?.domain
  if (!d || typeof d !== 'object') return { verifyingContract: null, chainId: null }
  const vc = d['verifyingContract']
  const cid = d['chainId']
  return {
    verifyingContract: typeof vc === 'string' ? vc : null,
    chainId: cid === undefined || cid === null ? null : String(cid),
  }
}

/**
 * A field of the thing being signed, shown in full.
 *
 * Deliberately not `DeviceRow`: that one is a one-line summary of what a
 * hardware screen will say, so it truncates. This is the verification surface,
 * so it wraps — an address the user cannot read all of is an address they
 * cannot check, and 6+4 truncation is exactly what address poisoning aims at.
 */
function DetailRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <Column gap={2}>
      <Body tone="mute" size="caption">
        {label}
      </Body>
      <Body size="caption" selectable testID={testID}>
        {value}
      </Body>
    </Column>
  )
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
