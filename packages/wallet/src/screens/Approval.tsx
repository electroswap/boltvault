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
  Icon,
  Input,
  Key,
  Pill,
  Plate,
  Row,
  ScrollView,
  Sheet,
  Signature,
  metrics,
  paint,
  shortAddress,
  differingAt,
  fullAddress,
} from '@boltvault/ui'
import {
  clampPerGas,
  gasBand,
  parseApprovalPayload,
  suggestedPerGas,
  type AccountView,
  type ApprovalPayload,
  type ApprovalRequest,
  type AssessmentView,
  type ChainView,
  type GasDecisionData,
  type PreparedTx,
  type StatementView,
} from '@boltvault/engine'
import { untrusted } from '@boltvault/security'
import { parseUnits } from 'viem'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScreenFooter } from '../components/ScreenFooter'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useFeel } from '../feel'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWcProposal } from '../hooks/useWcProposal'
import { COOLING_MS, needsCooling, needsStepUp, recipientOf } from '../state/safeguards'
import { useApprovals } from '../state/useApprovals'
import { useScreenBusy } from '../state/useScreenBusy'
import { useWalletState } from '../state/useWalletState'

/**
 * How long after the sheet appears before any verb can be pressed
 * (ES-BV-066).
 *
 * It was applied only where the host reports a window focus event, which is
 * the extension. On mobile there is no such event and the takeover mounts
 * inside a 150 ms fade, so for an `info`-severity request with no reading
 * delay of its own the verb was armed from the first, nearly transparent
 * frame — a tap meant for the page underneath could land on Approve. It is a
 * floor on every body now: 600 ms is what the extension already waited, and
 * it comfortably outlasts the fade.
 */
const FOCUS_INERT_MS = 600

export interface ApprovalProps {
  readonly requestId?: string
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly reducedMotion?: boolean
}

/**
 * One address with the characters that differ from another one marked
 * (ES-BV-033).
 *
 * The plate told the reader to check every character and then handed them two
 * forty-character strings and a list of positions to count to. The firewall
 * already knows which characters differ; a person should not have to do the
 * comparison the wallet has already done.
 */
function MarkedAddress({ address, against }: { address: string; against: string }) {
  const diff = new Set(differingAt(address, against))
  if (diff.size === 0) return <>{fullAddress(address)}</>
  const cased = fullAddress(address)
  return (
    <>
      {'0x'}
      {cased
        .slice(2)
        .split('')
        .map((c, i) =>
          diff.has(i) ? (
            // Colour is not the only signal: the weight carries it for a
            // reader who cannot tell these two apart.
            <Body key={i} tone="burn" size="caption" fontWeight="700">
              {c}
            </Body>
          ) : (
            c
          ),
        )}
    </>
  )
}

function siteOf(origin: string): { host: string; internal: boolean } {
  if (origin.startsWith('internal:')) return { host: 'BoltVault', internal: true }
  /*
    A paired device is not a site and has no host — `new URL('device:Pixel 8')`
    parses happily and answers an empty one, so the origin line on a remote-sign
    sheet was blank. It is named the way `explain.ts siteName()` names it.
  */
  /*
    A paired device's own name for itself, stripped (ES-BV-014, ES-BV-061).

    It is a string the peer chose and it becomes the origin line on a
    remote-sign sheet, so an unbounded one pushes the verb off the screen and a
    bidi override reorders the line around it. The engine bounds it at pairing
    and on every read of the row, and this is the render site, which is where
    the same rule has to hold whatever reached it.
  */
  if (origin.startsWith('device:'))
    return { host: `your ${untrusted(origin.slice(7), 32) || 'paired device'} (paired device)`, internal: true }
  try {
    return { host: new URL(origin).host || origin, internal: false }
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
  const [chains, setChains] = useState<ChainView[]>([])
  const [typed, setTyped] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [armedAt, setArmedAt] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedAccount, setPickedAccount] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  /*
    The large-send step-up (§3.4 point 6), which nothing in the product
    performed: the rule fired, the button was greyed for 1.5 s, and
    `vault.unlock` was never called from here. Proving the vault opens again is
    the whole point of the safeguard — an unlocked wallet left on a desk is the
    threat it is written against — so the verb stays shut until one of this
    vault's own unlock factors answers.
  */
  const [stepUpDone, setStepUpDone] = useState(false)
  const [stepUpPassword, setStepUpPassword] = useState('')
  const [stepUpBusy, setStepUpBusy] = useState(false)
  const [stepUpError, setStepUpError] = useState<string | null>(null)
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
  /*
    The network fee, which was a readout on every sheet in the product.

    `null` means "whatever the node suggested", which is what every signature
    before this used. A choice is a price per unit of gas, clamped in the engine
    at the point of signing rather than trusted from here (`applyGasDecision`) —
    this screen is a page, and a page must not be the last word on what gets
    signed.
  */
  const [gasChoice, setGasChoice] = useState<GasDecisionData | null>(null)
  const [gasOpen, setGasOpen] = useState(false)
  const [gasTyped, setGasTyped] = useState('')

  const request: ApprovalRequest | undefined = requestId
    ? pending.find((r) => r.id === requestId)
    : pending[0]
  const payload = useMemo(() => (request ? parseApprovalPayload(request.payload) : null), [request])
  const assessment = payload ? assessmentOf(payload) : null
  /*
    Hold the shell's ES overlay until this sheet has a request to show.

    Swap (and Send) cover the wait to get here; we cover the last beat so the
    loader lifts onto a painted preview rather than onto `approval-loading`.
  */
  useScreenBusy('sign', Boolean(requestId) && (!loaded || !request || !payload))

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
    setStepUpDone(false)
    setStepUpPassword('')
    setStepUpError(null)
  }, [request?.id])
  /*
    Read from the rule CODES, not their severity: the severity of both of these
    was wrong, and a re-tuning of severities in the firewall must not silently
    take either safeguard away again (`state/safeguards.ts`).
  */
  const codes = (assessment?.rules ?? []).map((r) => r.code)
  const firstTimeRecipient = needsCooling(codes)
  /* The address a lookalike recipient is imitating, where the firewall found
     one — so the plate can show the difference (ES-BV-033). */
  // The WalletConnect proposal behind this sheet, where there is one (ES-BV-040).
  const proposal = useWcProposal(request?.origin ?? null)
  const lookalikeOf =
    assessment?.rules.find((r) => r.code === 'RECIPIENT_LOOKALIKE')?.lookalikeOf ?? null
  const largeSend = needsStepUp(codes)
  const delayMs = Math.max(
    assessment?.presentation.delayMs ?? 0,
    FOCUS_INERT_MS,
    firstTimeRecipient ? COOLING_MS : 0,
  )
  const enableAt = armedAt + delayMs
  // Half-second steps while it counts down, so the number on screen is the
  // number of seconds actually left rather than one frozen figure.
  useEffect(() => {
    if (now >= enableAt) return
    const id = setTimeout(() => setNow(Date.now()), Math.min(500, enableAt - now + 10))
    return () => clearTimeout(id)
  }, [now, enableAt])
  /*
    Keep the clock running while the sheet is open.

    `now` previously stopped advancing the moment the primary armed, which is
    fine for a countdown and wrong for anything that ages — the preview's "taken
    N seconds ago" would have been frozen at the age it had when the button
    became live, which is to say it would never have appeared at all.
  */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])

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
  const [ledger, setLedger] = useState<{
    ready: boolean
    message: string | null
    clearSigning: boolean | null
  } | null>(null)
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
        (r) =>
          alive && setLedger({ ready: r.state === 'ready', message: r.message, clearSigning: r.clearSigning }),
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
    Which second factor to offer, read exactly as Unlock reads it: a wrap this
    vault actually carries AND a body that can still produce the secret. A
    device wrap outlives its keystore entry when the enrolled biometrics
    change, so the wrap alone is not an offer.
  */
  const passkeyIds = (vault?.wraps ?? []).filter((w) => w.by === 'prf').map((w) => w.id)
  const deviceWrapped = (vault?.wraps ?? []).some((w) => w.by === 'device')
  const [passkeyOk, setPasskeyOk] = useState(false)
  const [biometricOk, setBiometricOk] = useState(false)
  useEffect(() => {
    let alive = true
    if (passkeyIds.length && host.passkeys) host.passkeys.supported().then((ok) => alive && setPasskeyOk(ok), () => undefined)
    return () => {
      alive = false
    }
  }, [host.passkeys, passkeyIds.length])
  /*
    The step-up does not take the device factor on Android (ES-BV-005).

    A large-send step-up is a second factor asked for on a phone that is
    already unlocked — so it has to be something the person holding the
    unlocked phone does not already have. On Android the keystore wrap is
    released by the screen-lock credential and survives a new fingerprint
    enrolment, which is exactly what the holder of an unlocked phone has. The
    password is the factor here.
  */
  useEffect(() => {
    let alive = true
    if (deviceWrapped && host.deviceKey && !host.isAndroid) host.deviceKey.available().then((ok) => alive && setBiometricOk(ok), () => undefined)
    return () => {
      alive = false
    }
  }, [host.deviceKey, host.isAndroid, deviceWrapped])

  const stepUp = async (fn: () => Promise<void>): Promise<void> => {
    setStepUpBusy(true)
    setStepUpError(null)
    try {
      await fn()
      setStepUpDone(true)
      setStepUpPassword('')
    } catch {
      setStepUpError(t({ id: 'approval.stepup.fail', message: 'That did not open this vault. Nothing has been signed.' }))
    } finally {
      setStepUpBusy(false)
    }
  }
  const stepUpWithPassword = (): Promise<void> => stepUp(async () => {
    await engine.vault.unlock({ password: stepUpPassword })
  })
  const stepUpWithPasskey = (): Promise<void> => stepUp(async () => {
    if (!host.passkeys) throw new Error('no passkeys here')
    const r = await host.passkeys.get(passkeyIds)
    await engine.vault.unlockWithPasskey({ credentialId: r.credentialId, prfSecretHex: r.prfSecretHex })
  })
  const stepUpWithDevice = (): Promise<void> => stepUp(async () => {
    if (!host.deviceKey) throw new Error('no keystore here')
    const read = await host.deviceKey.read(t({ id: 'approval.stepup.reason', message: 'Confirm this send' }))
    if (!read.ok) throw new Error(read.reason === 'cancelled' ? 'cancelled' : 'device key unavailable')
    await engine.vault.unlockWithDevice({ keyId: host.deviceKey.id, keyHex: read.keyHex })
  })

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

  if (!loaded) return <Column flex={1} testID="approval-loading" />
  if (!request || !payload) {
    return (
      <Column
        flex={1}
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
  /*
    Fail closed. `typedConfirmation` is null when no word is wanted and a
    string when one is — an EMPTY string is a bug upstream, not a licence to
    arm, and it is exactly what a `device:` origin used to produce. A word is
    required whenever the field is not null, and an empty one means "confirm".
  */
  const needsTyped = assessment?.presentation.typedConfirmation ?? null
  const wantedWord = needsTyped === null ? null : needsTyped || 'confirm'
  const typedOk = wantedWord === null || typed.trim().toLowerCase() === wantedWord.toLowerCase()
  const stepUpPending = largeSend && !stepUpDone
  // A device that has told us it cannot sign holds the verb: pressing it would
  // only spend a round trip to be told the same thing.
  const armed = now >= enableAt && typedOk && !stepUpPending && !busy && !signing && ledger?.ready !== false
  const secondsLeft = Math.max(0, Math.ceil((enableAt - now) / 1000))
  const recipient = payload.kind === 'send_transaction' ? recipientOf(payload.tx) : null
  const verb = verbFor(payload, request.origin)

  /*
    The fee, as it will actually be signed.

    Every figure on this screen is derived from one price per unit of gas — the
    user's, if they chose one, and the node's if they did not — so the row, the
    sheet and the transaction cannot disagree. Multiplying by the gas limit is
    what turns it into something a person can judge: a fee in the chain's own
    coin, not a price per unit of something they have never heard of.
  */
  const tx: PreparedTx | null = payload.kind === 'send_transaction' ? payload.tx : null
  const gasLimit = tx ? BigInt(tx.gas) : 0n
  const band = tx ? gasBand(tx) : null
  const perGas = tx ? perGasOf(tx, gasChoice) : 0n
  const feeTotalWei = perGas * gasLimit
  const feeSymbol = payload.kind === 'send_transaction' ? payload.fee.symbol : ''
  const totalAt = (p: bigint): string => `${formatWei((p * gasLimit).toString())} ${feeSymbol}`
  /*
    What the typed figure asks for, before the clamp has its say. Kept separate
    from `perGas` so the sheet can tell the user their number is being lifted or
    trimmed rather than silently doing it.
  */
  const typedWei = tx && gasTyped.trim() ? parseCoin(gasTyped) : null
  const typedPerGas = typedWei !== null && gasLimit > 0n ? typedWei / gasLimit : null
  const tooLow = band !== null && typedPerGas !== null && typedPerGas < band.floor
  const tooHigh = band !== null && typedPerGas !== null && typedPerGas > band.ceiling

  const decide = async (approve: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      /*
        The typed decision payload, in the shape the Connect sheet established:
        the engine parses it where the signature is made and ignores anything it
        does not recognise. A fee choice rides the same field.
      */
      const data =
        approve && payload.kind === 'connect' && signer
          ? { accountId: signer.id, chainId }
          : approve && payload.kind === 'send_transaction' && gasChoice
            ? gasChoice
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
    <Column flex={1} testID="approval">
      {/*
        The scroll region and the verbs are siblings, not layers.

        This screen used to pin its own verbs with `position: absolute` and buy
        the room back with `paddingBottom: 120` on the scroll content — a
        number that was right once and has not been since. The footer is 146 px
        in the popup (two 56 px keys, a gap and the inset), so the last 26 px of
        the sheet sat under the buttons: the owner photographed "No Ledger is
        connected" cut in half by them, its second line half behind Sign. It
        also grows — the device loader, the countdown, "2 more waiting" — so no
        constant could have been right for every state.

        `ScreenFooter` is what Send, Swap, Bridge, Allowances and the Rack use:
        the footer takes its own height out of the column and the scroll region
        keeps the rest, so nothing can hide under it.
      */}
      <ScrollView style={{ zIndex: 1 }} contentContainerStyle={{ padding: inset, gap: 14 }}>
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

        {/*
          What the peer says it is, said to be what it says (ES-BV-040).

          A proposal Verify could not vouch for gets a synthetic
          `<topic>.walletconnect.invalid` origin — right for the firewall,
          useless to a reader — and that host was the whole of what this sheet
          showed. The claimed name and URL have been on the proposal since it
          arrived and nothing read them, nor the lookalike verdict the engine
          computes from the claimed host.
        */}
        {payload.kind === 'connect' && proposal ? (
          <Plate gap="$1" testID="approval-wc-claim" {...(proposal.claimLooksLike ? { borderColor: paint.burn } : {})}>
            <Body tone="mute" size="caption">
              {t({ id: 'approval.wc.claim', message: 'Claimed by the app — not verified' })}
            </Body>
            <Body numberOfLines={1}>{proposal.name || t({ id: 'approval.wc.noname', message: 'unnamed' })}</Body>
            {proposal.url ? (
              <Body tone="mute" size="caption" numberOfLines={1} selectable>
                {proposal.url}
              </Body>
            ) : null}
            {proposal.claimLooksLike ? (
              <Body tone="burn" size="caption" testID="approval-wc-lookalike">
                {t({
                  id: 'approval.wc.lookalike',
                  message: 'That address imitates {h}, which is a site you use. Nothing has checked that this app is who it says.',
                  values: { h: proposal.claimLooksLike },
                })}
              </Body>
            ) : null}
          </Plate>
        ) : null}

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
                /*
                  A message's own text is rendered in full below (ES-BV-026),
                  so its statement need not carry it — and every other
                  statement carries names a site or a contract chose, where the
                  cap is what stops one of them pushing the verb off screen.
                */
                numberOfLines={payload.kind === 'sign_message' ? 2 : 4}
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
                {/*
                  The preview runs once, when the request arrives, and is never
                  re-run — so a sheet left open shows a picture of a state that
                  may have moved on. Say how old it is rather than let it pass
                  for current.
                */}
                {assessment.simulatedAt > 0 && now - assessment.simulatedAt > 30_000 ? (
                  <Body tone="ember" size="caption" testID="approval-preview-age">
                    {t({
                      id: 'approval.preview.age',
                      message: 'Taken {n} seconds ago — the chain may have moved since.',
                      values: { n: Math.round((now - assessment.simulatedAt) / 1000) },
                    })}
                  </Body>
                ) : null}
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
              {/*
                In full (ES-BV-033). Anyone may deploy a token calling itself
                USDC, so the address is the only thing that distinguishes the
                real one — and it was the field the sheet truncated.
              */}
              <Body tone="mute" size="caption" selectable testID="approval-watch-address">
                {payload.address ? fullAddress(payload.address) : '—'}
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
            {/*
              A symbol that already belongs to another address (ES-BV-037).

              The lookalike check added for token lists never reached this
              sheet, which is the one a page drives. Anyone may deploy a token
              calling itself USDC; saying which address the real one is at is
              the difference between a warning and a fact.
            */}
            {payload.lookalikeOf ? (
              <Plate gap={2} borderColor={paint.burn} testID="approval-watch-lookalike">
                <Body tone="burn">
                  {t({
                    id: 'approval.watch.lookalike',
                    message: 'This is not the {s} you already have.',
                    values: { s: payload.onChain?.symbol ?? payload.symbol ?? '' },
                  })}
                </Body>
                <Body tone="mute" size="caption" selectable>
                  {t({ id: 'approval.watch.lookalike.real', message: 'Yours is at {a}', values: { a: fullAddress(payload.lookalikeOf) } })}
                </Body>
              </Plate>
            ) : null}
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

        {/*
          The first-time recipient, in full.

          §3.6 is explicit that the whole address is shown and not truncated:
          6+4 truncation is precisely the shape address poisoning is built to
          survive, and the ends of a poisoned address are the part that
          matches. So the plate shows all forty nibbles, selectable, and the
          verb stays shut while it is being read.
        */}
        {firstTimeRecipient ? (
          <Plate gap="$2" borderColor={paint.ember} testID="approval-first-time">
            <Body tone="ember">
              {t({ id: 'approval.firstTimeTo', message: 'You have never sent to this address' })}
            </Body>
            <Body tone="mute" size="caption">
              {t({
                id: 'approval.firstTimeTo.body',
                message: 'Check the whole address against the one you were given — every character, not just the ends. An address that only matches at the ends is the commonest theft there is.',
              })}
            </Body>
            {recipient ? (
              <Body size="caption" selectable testID="approval-first-time-address">
                {lookalikeOf ? <MarkedAddress address={recipient} against={lookalikeOf} /> : fullAddress(recipient)}
              </Body>
            ) : null}
            {/*
              Where it differs from the address it is imitating (ES-BV-033).
              The firewall computes this and nothing rendered it, so the plate
              said "check every character" and left the reader to do the
              comparison unaided.
            */}
            {lookalikeOf && recipient ? (
              <Column gap={2} testID="approval-lookalike-diff">
                <Body tone="mute" size="caption">
                  {t({ id: 'approval.lookalike.mine', message: 'The address you use' })}
                </Body>
                <Body size="caption" selectable>
                  <MarkedAddress address={lookalikeOf} against={recipient} />
                </Body>
                <Body tone="ember" size="caption">
                  {t({
                    id: 'approval.lookalike.diff',
                    message: 'They differ at {n} of the 40 characters, marked above.',
                    values: { n: differingAt(recipient, lookalikeOf).length },
                  })}
                </Body>
              </Column>
            ) : null}
            {secondsLeft > 0 ? (
              <Body tone="ember" size="caption" testID="approval-cooling">
                {t({ id: 'approval.cooling', message: '{n} seconds to read it.', values: { n: secondsLeft } })}
              </Body>
            ) : null}
          </Plate>
        ) : null}

        {/*
          The large-send step-up (§3.4 point 6). Settings promises it by name
          and nothing performed it; the verb now waits on one of this vault's
          own unlock factors, preferring the enrolled ones because a password
          typed in front of whoever is standing there is the weaker proof.
        */}
        {largeSend ? (
          <Plate gap="$2" borderColor={stepUpDone ? paint.arc : paint.ember} testID="approval-stepup">
            <Body tone={stepUpDone ? 'arc' : 'ember'}>
              {stepUpDone
                ? t({ id: 'approval.stepup.done', message: 'Unlocked — you can continue' })
                : t({ id: 'approval.stepup.title', message: 'Unlock again to send this much' })}
            </Body>
            {stepUpDone ? null : (
              <>
                <Body tone="mute" size="caption">
                  {t({
                    id: 'approval.stepup.body',
                    message: 'This moves more than a tenth of what you hold of that token, so BoltVault asks who is at the keyboard before it signs — an open wallet is not the same as you.',
                  })}
                </Body>
                {passkeyOk ? <Key label={t({ id: 'unlock.passkey', message: 'Unlock with passkey' })} kind="secondary" size="compact" disabled={stepUpBusy} onPress={() => void stepUpWithPasskey()} testID="approval-stepup-passkey" /> : null}
                {biometricOk ? <Key label={t({ id: 'unlock.biometric', message: 'Unlock with biometrics' })} kind="secondary" size="compact" disabled={stepUpBusy} onPress={() => void stepUpWithDevice()} testID="approval-stepup-biometric" /> : null}
                <Input
                  value={stepUpPassword}
                  onChange={setStepUpPassword}
                  secure
                  placeholder={t({ id: 'unlock.ph', message: 'Password' })}
                  onSubmit={() => void stepUpWithPassword()}
                  testID="approval-stepup-password"
                />
                {/* Argon2id takes a moment, and a key that looks inert is a key people press again. */}
                <Key label={stepUpBusy ? t({ id: 'approval.stepup.checking', message: 'Checking…' }) : t({ id: 'unlock.key', message: 'Unlock' })} kind="secondary" size="compact" disabled={stepUpBusy || !stepUpPassword} onPress={() => void stepUpWithPassword()} testID="approval-stepup-submit" />
                {stepUpError ? (
                  <Body tone="burn" size="caption" testID="approval-stepup-error">
                    {stepUpError}
                  </Body>
                ) : null}
              </>
            )}
          </Plate>
        ) : null}

        {/* Risk plates */}
        {assessment?.rules
          .filter((r) => r.severity !== 'info' && r.code !== 'RECIPIENT_FIRST_TIME')
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
              {/* Both are the site's own words: bounded to two lines so one
                  cannot push the verb off the sheet (ES-BV-038). */}
              <DetailRow
                label={t({ id: 'typed.type', message: 'Message type' })}
                value={payload.primaryType}
                numberOfLines={2}
                testID="approval-domain-type"
              />
              <DetailRow
                label={t({ id: 'typed.domain', message: 'Domain' })}
                value={payload.domainName ?? t({ id: 'typed.domain.none', message: 'not named' })}
                numberOfLines={2}
                testID="approval-domain-name"
              />
              <DetailRow
                label={t({ id: 'typed.contract', message: 'Valid for contract' })}
                /*
                  Checksummed (ES-BV-033). This is the contract a Permit2 or
                  Seaport signature will be presented to, and it arrives from
                  the page in whatever casing the page chose — which is the
                  one thing EIP-55 exists to make comparable.
                */
                value={
                  (() => {
                    const vc = typedDomain(payload.typedData).verifyingContract
                    return vc ? fullAddress(vc) : t({ id: 'typed.contract.none', message: 'not stated' })
                  })()
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
        {payload.kind === 'send_transaction' && tx ? (
          <Row justifyContent="space-between" alignItems="center" gap="$2" testID="approval-fee">
            <Body tone="mute" size="caption">
              {t({ id: 'approval.fee', message: 'Network fee up to' })}
            </Body>
            <Row gap="$2" alignItems="center">
              <Body size="caption" tone={gasChoice ? 'arc' : 'ink'} testID="approval-fee-total">{`${formatWei(feeTotalWei.toString())} ${feeSymbol}`}</Body>
              <Pill
                size="sm"
                label={t({ id: 'approval.fee.change', message: 'Change' })}
                selected={gasChoice !== null}
                onPress={() => {
                  setGasTyped(formatWei(feeTotalWei.toString()))
                  setGasOpen(true)
                }}
                accessibilityLabel={t({ id: 'approval.fee.change.a11y', message: 'Change the network fee' })}
                testID="approval-fee-change"
              />
            </Row>
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
                  // The details plate is where somebody checks an address
                  // against another one, so it is whole and checksummed.
                  value={payload.tx.to ? fullAddress(payload.tx.to) : t({ id: 'device.deploy', message: 'new contract' })}
                  testID="approval-tx-to"
                />
                <DetailRow
                  label={t({ id: 'tx.from', message: 'From' })}
                  value={fullAddress(payload.tx.from)}
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
                  /* The chosen fee, not the prepared one — these details are the verification surface. */
                  value={`${formatWei(feeTotalWei.toString())} ${feeSymbol}`}
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
                    /* Distinct from the `Data ({n} bytes)` label above: one id
                       may not carry two source messages, and the extractor
                       refuses the catalog outright while it does. */
                    label={t({ id: 'tx.data.label', message: 'Data' })}
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
            {/*
              The whole message, without a tap (ES-BV-026).

              The statement was truncated at 400 characters and rendered at
              four lines, and the full text only appeared once the details
              toggle was opened — which is closed by default. A SIWE message
              puts its resources at the bottom, so the part that says what is
              actually being authorised was the part below the fold. It is a
              signature: the thing being signed is the point of the screen.
            */}
            <Plate gap="$1" testID="approval-msg">
              <Body tone="mute" size="caption">
                {t({ id: 'msg.raw', message: 'Message' })}
              </Body>
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                <Body size="caption" selectable testID="approval-msg-body">
                  {payload.text ?? payload.message}
                </Body>
              </ScrollView>
            </Plate>
            {/* The toggle keeps what it was always for: the bytes. */}
            <Body
              tone="mute"
              size="caption"
              onPress={() => setShowTx((v) => !v)}
              testID="approval-msg-toggle"
            >
              {showTx
                ? t({ id: 'approval.msg.hide', message: 'Hide the raw bytes' })
                : t({ id: 'approval.msg.show', message: 'Show the raw bytes' })}
            </Body>
            {showTx ? (
              <Plate gap="$1" testID="approval-msg-raw">
                <DetailRow
                  label={t({ id: 'msg.signer', message: 'Signed by' })}
                  value={payload.from}
                  testID="approval-msg-from"
                />
                <DetailRow
                  label={t({ id: 'msg.bytes', message: 'Bytes' })}
                  value={payload.message}
                  testID="approval-msg-bytes"
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
                    /*
                      The device shows a checksummed address; this card is for
                      comparing the two, so it has to be written the same way.
                    */
                    value={payload.tx.to ? fullAddress(payload.tx.to) : t({ id: 'device.deploy', message: 'new contract' })}
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
                /*
                  Say which of the two EIP-712 flows this signature will take
                  (ES-BV-006).

                  A Ledger signing typed data used to be handed two 32-byte
                  hashes, so the device checked nothing and this card said as
                  much. It is now told the whole message and shows the fields,
                  which is the only reason a hardware wallet helps against a
                  host that is lying. Two things can still send it back to
                  hashes: an Ethereum app too old for the instructions, which
                  the preflight reports, and a message shaped in a way the app
                  cannot be told about, which the engine works out when it
                  builds this sheet. Either one, and the card says so.
                */
                signer.kind === 'ledger' &&
                payload.deviceFields !== false &&
                ledger?.clearSigning !== false ? (
                  <Body tone="mute" size="caption" testID="approval-device-clear">
                    {t({
                      id: 'device.typed.fields',
                      message:
                        'The device shows the fields of this message — check the spender, the amount and the deadline there too.',
                    })}
                  </Body>
                ) : (
                  <Body
                    tone={signer.kind === 'ledger' ? 'ember' : 'mute'}
                    size="caption"
                    testID="approval-device-hashes"
                  >
                    {signer.kind === 'ledger'
                      ? ledger?.clearSigning === false
                        ? t({
                            id: 'device.typed.old',
                            message:
                              'Your Ledger will show hashes only — update the Ethereum app to see the fields. Until then the statements above are the only description of what you are signing.',
                          })
                        : t({
                            id: 'device.typed.shape',
                            message:
                              'Your Ledger cannot show this message as fields, so it will show hashes only — the statements above are the only description of what you are signing.',
                          })
                      : t({
                          id: 'device.typed',
                          message:
                            'The device shows two hashes (domain and message) — the statements above are what they mean.',
                        })}
                  </Body>
                )
              ) : (
                <Body tone="mute" size="caption">
                  {t({ id: 'device.message', message: 'The device shows the message text.' })}
                </Body>
              )}
            </Plate>
          )
        ) : null}

        {wantedWord !== null && !blocked ? (
          <Input
            value={typed}
            onChange={setTyped}
            label={t({
              id: 'approval.typed',
              message: 'Type {word} to continue',
              values: { word: wantedWord },
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
      <ScreenFooter inset={inset} testID="approval-verbs">
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
        {!blocked && !armed && !busy && !signing && secondsLeft > 0 ? (
          <Body tone="ember" size="caption" testID="approval-wait">
            {t({ id: 'approval.wait', message: '{verb} in {n} s', values: { verb, n: secondsLeft } })}
          </Body>
        ) : null}
        {!blocked && stepUpPending && secondsLeft === 0 ? (
          <Body tone="ember" size="caption" testID="approval-stepup-wait">
            {t({ id: 'approval.stepup.wait', message: 'Unlock above to continue.' })}
          </Body>
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
      </ScreenFooter>

      {/*
        The fee editor. Everything in it is money in the chain's own coin: what
        this costs, and what a cheaper one risks. Nobody reads "gwei" here,
        because nobody has to — the three choices and the field are all totals.
      */}
      <Sheet
        open={gasOpen && tx !== null}
        onClose={() => setGasOpen(false)}
        title={t({ id: 'gas.title', message: 'Network fee' })}
        reducedMotion={reducedMotion}
        footer={<Key label={t({ id: 'close', message: 'Close' })} kind="secondary" size="compact" onPress={() => setGasOpen(false)} testID="gas-close" />}
        testID="approval-gas-sheet"
      >
        {tx && band ? (
          <Column gap="$3">
            <Body tone="mute" size="caption">
              {t({
                id: 'gas.body',
                message: 'This is what the network charges to process your transaction, not a BoltVault fee. It is paid in {sym} whether the transaction succeeds or fails.',
                values: { sym: feeSymbol },
              })}
            </Body>
            <Row gap="$2" flexWrap="wrap">
              {GAS_CHOICES.map((choice) => {
                const at = gasChoiceFor(tx, (suggestedPerGas(tx) * BigInt(choice.percent)) / 100n)
                const isOn = choice.percent === 100 ? gasChoice === null : perGasOf(tx, gasChoice) === perGasOf(tx, at)
                return (
                  <Pill
                    key={choice.percent}
                    label={`${choice.label()} · ${totalAt(perGasOf(tx, at))}`}
                    selected={isOn}
                    onPress={() => {
                      setGasChoice(choice.percent === 100 ? null : at)
                      setGasTyped(formatWei((perGasOf(tx, at) * gasLimit).toString()))
                    }}
                    testID={`gas-preset-${choice.percent}`}
                  />
                )
              })}
            </Row>
            <Input
              label={t({ id: 'gas.exact', message: 'Or set the most you will pay ({sym})', values: { sym: feeSymbol } })}
              value={gasTyped}
              onChange={(v) => {
                setGasTyped(v)
                const wei = parseCoin(v)
                // An unreadable or empty field means "no choice", not "a fee of nothing".
                setGasChoice(wei === null || gasLimit === 0n ? null : gasChoiceFor(tx, wei / gasLimit))
              }}
              numeric
              testID="gas-exact"
            />
            {/*
              Said plainly, and said before it is done. The engine clamps this
              anyway at the moment of signing, so the only question here is
              whether the user finds out from us or from a transaction that
              never arrives.
            */}
            {tooLow ? (
              <Body tone="ember" size="caption" testID="gas-too-low">
                {t({
                  id: 'gas.tooLow',
                  message: 'Under {min} {sym} the network will not pick this up at all — it would sit unsent until it expired. BoltVault will use {min} {sym}.',
                  values: { min: formatWei((band.floor * gasLimit).toString()), sym: feeSymbol },
                })}
              </Body>
            ) : null}
            {tooHigh ? (
              <Body tone="ember" size="caption" testID="gas-too-high">
                {t({
                  id: 'gas.tooHigh',
                  message: 'That is far more than this transaction needs. BoltVault will use {max} {sym}, which is already four times the going rate.',
                  values: { max: formatWei((band.ceiling * gasLimit).toString()), sym: feeSymbol },
                })}
              </Body>
            ) : null}
            {gasChoice && !tooLow && !tooHigh && perGas < band.suggested ? (
              <Body tone="ember" size="caption" testID="gas-slower">
                {t({ id: 'gas.slower', message: 'Paying less than the network suggests means waiting longer, and in a busy hour it may not go through at all.' })}
              </Body>
            ) : null}
            <Row justifyContent="space-between" alignItems="center">
              <Body tone="mute" size="caption">
                {t({ id: 'gas.willPay', message: 'You will pay up to' })}
              </Body>
              <Body size="caption" testID="gas-total">{`${formatWei(feeTotalWei.toString())} ${feeSymbol}`}</Body>
            </Row>
            {/*
              The gas limit stays a readout. Raising it changes nothing — unused
              gas comes back — and lowering it below the estimate buys a
              transaction that runs out halfway and still charges for every unit
              it burned. It is shown because the sheet is a verification surface,
              not because it is a setting.
            */}
            <Row justifyContent="space-between" alignItems="center">
              <Body tone="mute" size="caption">
                {t({ id: 'gas.work', message: 'Work this needs' })}
              </Body>
              <Body tone="mute" size="caption" testID="gas-limit">
                {t({ id: 'gas.work.units', message: '{n} units of gas', values: { n: gasLimit.toString() } })}
              </Body>
            </Row>
          </Column>
        ) : null}
      </Sheet>
    </Column>
  )
}

/** The three fees a person actually wants, as percentages of what the node suggested. */
const GAS_CHOICES = [
  { percent: 70, label: () => t({ id: 'gas.slow', message: 'Cheaper' }) },
  { percent: 100, label: () => t({ id: 'gas.normal', message: 'Suggested' }) },
  { percent: 150, label: () => t({ id: 'gas.fast', message: 'Faster' }) },
] as const

const hexOf = (n: bigint): string => `0x${n.toString(16)}`

/** The price per unit of gas this sheet will sign with: the user's choice, or the node's. */
function perGasOf(tx: PreparedTx, choice: GasDecisionData | null): bigint {
  const asked = tx.type === 'eip1559' ? choice?.maxFeePerGas : choice?.gasPrice
  return asked === undefined ? suggestedPerGas(tx) : clampPerGas(tx, BigInt(asked))
}

/**
 * A fee choice at a given price per unit of gas, in whichever model this chain
 * uses. The tip moves with the ceiling: raising only the ceiling costs more
 * without being any faster, because it is the tip that decides the order.
 */
function gasChoiceFor(tx: PreparedTx, perGas: bigint): GasDecisionData {
  const capped = clampPerGas(tx, perGas)
  if (tx.type !== 'eip1559') return { gasPrice: hexOf(capped) }
  const suggested = suggestedPerGas(tx)
  const tip = suggested > 0n ? (BigInt(tx.maxPriorityFeePerGas ?? '0x0') * capped) / suggested : 0n
  return { maxFeePerGas: hexOf(capped), maxPriorityFeePerGas: hexOf(tip > capped ? capped : tip) }
}

/** A typed amount of the chain's own coin, in wei; null when it is not a number. */
function parseCoin(text: string): bigint | null {
  const trimmed = text.trim().replace(/,/g, '')
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return null
  try {
    return parseUnits(trimmed, 18)
  } catch {
    return null
  }
}

function formatWei(wei: string): string {
  const n = BigInt(wei)
  const whole = n / 10n ** 18n
  const frac = (n % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

/** The raw JSON of a typed-data message, with any truncation stated rather than silent. */
const RAW_MAX = 12_000
/**
 * Characters that move text about rather than being text (ES-BV-038).
 *
 * `JSON.stringify` preserves them, so a typed-data message whose field values
 * carry U+202E renders reordered in the raw plate — the one place on the sheet
 * that is meant to show exactly what is being signed. They are printed as
 * their escapes instead, which is both honest and visible.
 */
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}]/gu

function rawJson(value: unknown): string {
  let text: string
  try {
    text = (JSON.stringify(value, null, 1) ?? '').replace(
      INVISIBLE,
      (c) => `\\u${c.codePointAt(0)?.toString(16).padStart(4, '0') ?? '0000'}`,
    )
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
function DetailRow({ label, value, numberOfLines, testID }: { label: string; value: string; numberOfLines?: number; testID?: string }) {
  return (
    <Column gap={2}>
      <Body tone="mute" size="caption">
        {label}
      </Body>
      {/* A value the site chose can be any length; the caller says how much of
          the sheet it may take (ES-BV-038). */}
      <Body size="caption" selectable {...(numberOfLines !== undefined ? { numberOfLines } : {})} testID={testID}>
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
