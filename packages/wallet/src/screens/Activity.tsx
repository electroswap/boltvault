/**
 * Activity (master plan §8.12): the local, encrypted record of what this
 * wallet did and what reached it, with the statements the user was shown at
 * sign time. A "needs attention" section carries the inbox (plan A6); the
 * inbound scan runs debounced in the engine and shows as a sweep, not a
 * blank tab (plan A2).
 */
import { Body, Chip, Column, Icon, Key, Plate, BarLoader, Row, ScrollView, Segmented, Sheet, metrics, paint, shortAddress, type IconName } from '@boltvault/ui'
import { cacheKey, type ActivityEntry, type ChainView, type NotificationView, type ScanSummary } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { HomeKey } from '../components/HomeKey'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { useCached } from '../hooks/useCached'
import { useName } from '../hooks/useNames'
import { useNotifications } from '../hooks/useNotifications'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { recipientOf } from '../state/safeguards'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'
import { useScreenBusy } from '../state/useScreenBusy'

type Filter = 'all' | 'sent' | 'received' | 'approvals'
const ETN = 52014
const RECENT_MAX = 5

function matches(e: ActivityEntry, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'sent') return e.category === 'SEND' || e.category === 'SWAP' || e.category === 'DAPP' || e.category === 'LIMIT' || e.category === 'FARM_DEPOSIT' || e.category === 'FARM_WITHDRAW' || e.category === 'LAUNCHPAD' || e.category === 'NFT'
  if (f === 'received') return e.category === 'RECEIVE' || e.category === 'FARM_COLLECT' || e.category === 'DIVIDEND_CLAIM'
  return e.category === 'APPROVE' || e.category === 'REVOKE'
}

function iconFor(e: ActivityEntry): 'arrowUpRight' | 'arrowDownLeft' | 'approvals' | 'swap' | 'external' | 'farm' | 'star' | 'bolt' {
  switch (e.category) {
    case 'RECEIVE':
    case 'FARM_COLLECT':
    case 'DIVIDEND_CLAIM':
      return 'arrowDownLeft'
    case 'FARM_DEPOSIT':
    case 'FARM_WITHDRAW':
      return 'farm'
    case 'NFT':
      return 'star'
    case 'LAUNCHPAD':
      return 'bolt'
    case 'LIMIT':
      return 'swap'
    case 'APPROVE':
    case 'REVOKE':
      return 'approvals'
    case 'SWAP':
      return 'swap'
    case 'DAPP':
      return 'external'
    default:
      return 'arrowUpRight'
  }
}

const NOTE_ICON: Record<NotificationView['kind'], IconName> = { alert: 'bell', live: 'launch', offer: 'nft', collect: 'farm', dividends: 'star', arrival: 'arrowDownLeft', system: 'info' }
/** Marks that stand for something held, not something to do — drawn solid (owner: the dividends star "should be filled in"). */
const NOTE_FILLED: ReadonlySet<NotificationView['kind']> = new Set<NotificationView['kind']>(['dividends'])

export function Activity({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const { active } = useWalletState()
  const { entries, loaded } = useActivity(active?.id ?? null)
  const { items: notes, markRead } = useNotifications()
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<ActivityEntry | null>(null)
  /*
    Who the open row was with, by name where there is one.

    The detail sheet's only statement of the counterparty was `0x2222…2222`,
    which is the form a poisoned lookalike is designed to survive. Asked for the
    open row alone rather than for every row in the list: a history of two
    hundred sends is two hundred resolver lookups nobody reads.
  */
  /*
    The counterparty, not the contract the call went to.

    A row's `to` is whatever the transaction was addressed to, which for an
    ERC-20 send is the token contract — so the detail sheet printed the token
    under "To", and `useName` then resolved a reverse record for it. A scam
    token whose contract sets its own reverse name to `usdc.etn` therefore had
    the wallet print "To: usdc.etn" after every transfer of it: a contract
    identity rendered as a person's name, which §3.6 and §8.1 both say the
    wallet does not do. `recipientOf` reads the recipient out of the calldata,
    exactly as the firewall does before signing.
  */
  const counterparty = open ? recipientOf({ to: open.to, data: open.data ?? '0x' }) : null
  const isContractItself =
    !!open?.to &&
    !!counterparty &&
    counterparty.toLowerCase() === open.to.toLowerCase() &&
    (open.data ?? '0x').length > 2
  // A name is for a person's address. A contract the call went to is not one.
  const toName = useName(isContractItself ? undefined : (counterparty ?? undefined))
  const [chains, setChains] = useState<ChainView[]>([])
  /*
    Whether the open row can still be replaced, and why not when it cannot
    (§8.12). The engine answers both in one call, and the reason is shown rather
    than the control hidden: on Electroneum a block is five seconds, so there is
    genuinely nothing to speed up, and a user who has just watched a transaction
    sit for a minute deserves to be told that instead of finding no button.
  */
  const [replace, setReplace] = useState<{ can: boolean; why: string | null } | null>(null)
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  // Clearing is irreversible, so it costs a deliberate second press (§8.12).
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const [clearBusy, setClearBusy] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const accountId = active?.id ?? null


  // The shell draws one loader over the whole screen while this is true.
  useScreenBusy('activity', !loaded)

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
  }, [engine])

  // Asked only of a row that is still waiting: a settled transaction has nothing to replace, and saying so on every row is noise.
  useEffect(() => {
    setReplace(null)
    setReplaceError(null)
    if (!open || open.status !== 'pending') return
    let alive = true
    engine.tx.replaceable({ id: open.id }).then(
      (r) => alive && setReplace(r),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [engine, open])

  /*
    Both verbs are the same move — a new transaction at the same nonce, priced
    to evict the old one — and both go through the ordinary signing sheet, so
    the user sees what they are signing and the firewall sees it too. Nothing is
    signed here; this only raises the sheet.
  */
  const replaceWith = (how: 'speedUp' | 'cancel'): void => {
    if (!open) return
    setReplaceBusy(true)
    setReplaceError(null)
    const started = how === 'speedUp' ? engine.tx.speedUp({ id: open.id }) : engine.tx.cancel({ id: open.id })
    started.then(
      (r) => {
        setReplaceBusy(false)
        setOpen(null)
        router.navigate('sign', { requestId: r.requestId })
      },
      (err: unknown) => {
        setReplaceBusy(false)
        setReplaceError(err instanceof Error ? err.message : String(err))
      },
    )
  }

  // Inbound transfers: the engine scans every enabled chain in turn, debounced and on an alarm (plan A2).
  const scan = useCached<ScanSummary>({
    key: accountId ? cacheKey('activity', 'scan', accountId) : null,
    cached: (e) => (accountId ? e.activityScan.cached({ accountId }) : Promise.resolve(null)),
    fresh: (e) => (accountId ? e.activityScan.scanAll({ accountId }) : Promise.reject(new Error('no account'))),
    live: false,
  })

  // Opening the tab is reading the inbox: everything unread is now read (the badge clears); the latest few stay visible.
  const recent = notes.slice(0, RECENT_MAX)
  useEffect(() => {
    const ids = notes.filter((n) => !n.read).map((n) => n.id)
    if (ids.length) markRead(ids)
  }, [notes, markRead])

  const openNote = (n: NotificationView): void => {
    const [kind, ...rest] = (n.target ?? '').split(':')
    const id = rest.join(':')
    if (kind === 'campaign' && id) router.navigate('campaign', { chainId: ETN, pool: id })
    else if (kind === 'token' && id) router.navigate('token', { chainId: ETN, address: id })
    else if (kind === 'collection' && id) router.navigate('collection', { chainId: ETN, address: id })
    else if (kind === 'legends') router.navigate('legends')
    else if (kind === 'offers') router.navigate('offers')
    else if (kind === 'positions') {
      router.setTab('home')
      router.navigate('portfolio')
    }
  }

  const shown = entries.filter((e) => matches(e, filter))
  const explorerFor = (e: ActivityEntry): string | null => {
    const c = chains.find((x) => x.chainId === e.chainId)
    return c?.explorerUrl && e.hash ? `${c.explorerUrl}/tx/${e.hash}` : null
  }
  const originOf = (o: string | null): string | null => {
    if (!o) return null
    if (o.startsWith('internal:')) return null
    try {
      return new URL(o).host
    } catch {
      return o
    }
  }

  /*
    `activity.clear` wipes the encrypted local rows for every account on this
    device and nothing else — the chain still has every transaction, and
    another paired device keeps its own copy. The sheet says exactly that,
    because "clear history" reads like undoing something.
  */
  const clear = (): void => {
    setClearBusy(true)
    setClearError(null)
    engine.activity.clear().then(
      () => {
        setClearBusy(false)
        setClearing(false)
      },
      (err: unknown) => {
        setClearBusy(false)
        setClearError(err instanceof Error ? err.message : String(err))
      },
    )
  }

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="activity">
        <Row justifyContent="space-between" alignItems="center" minHeight={metrics.header}>
          {/* A tab root in the full tab has no Back, so it carries the way home. */}
          <HomeKey />
          <Body size="title" flex={1}>{t({ id: 'activity.title', message: 'Activity' })}</Body>
          {scan.error && !scan.refreshing ? (
            <Body tone="mute" size="caption" testID="activity-scan-problem">
              {t({ id: 'activity.scan.problem', message: 'Some chains did not answer' })}
            </Body>
          ) : null}
        </Row>
        <BarLoader active={scan.refreshing} reducedMotion={reducedMotion} testID="activity-refreshing" />
        {recent.length > 0 ? (
          <Column gap="$2" testID="activity-attention">
            <Body tone="mute" size="caption">
              {t({ id: 'activity.attention', message: 'Needs attention' })}
            </Body>
            {recent.map((n) => (
              <Plate key={n.id} role="card" gap={2} onPress={() => openNote(n)} cursor="pointer" testID={`note-${n.id}`}>
                <Row gap="$3" alignItems="center">
                  <Icon name={NOTE_ICON[n.kind]} filled={NOTE_FILLED.has(n.kind)} size={18} color={n.read ? paint.mute : paint.ember} />
                  <Column flex={1}>
                    <Body numberOfLines={1}>{n.title}</Body>
                    <Body tone="mute" size="caption" numberOfLines={1}>
                      {n.body}
                    </Body>
                  </Column>
                  <Body tone="mute" size="caption">
                    {new Date(n.at).toLocaleDateString()}
                  </Body>
                </Row>
              </Plate>
            ))}
          </Column>
        ) : null}
        <Segmented
          options={[
            { id: 'all', label: t({ id: 'activity.all', message: 'All' }) },
            { id: 'sent', label: t({ id: 'activity.sent', message: 'Sent' }) },
            { id: 'received', label: t({ id: 'activity.received', message: 'Received' }) },
            { id: 'approvals', label: t({ id: 'activity.approvals', message: 'Approvals' }) },
          ]}
          value={filter}
          onChange={(id) => setFilter(id as Filter)}
          testID="activity-filter"
        />
        {loaded && shown.length === 0 ? (
          <Plate gap="$2" testID="activity-empty">
            <Body tone="mute">{t({ id: 'activity.empty', message: 'Nothing yet. Sends, swaps and everything the wallet signs will appear here, with what you were shown when you signed.' })}</Body>
          </Plate>
        ) : null}
        {shown.map((e) => (
          <Plate key={e.id} role="card" gap={4} onPress={() => setOpen(e)} cursor="pointer" testID={`activity-${e.id}`}>
            <Row gap="$3" alignItems="center">
              <Icon name={iconFor(e)} size={18} color={e.status === 'failed' ? paint.burn : e.category === 'RECEIVE' ? paint.arc : paint.mute} />
              {/* minWidth 0 or the text column refuses to shrink and the status
                  chip eats the line — react-native-web's View is flexShrink: 0,
                  so "Received CLUB from …" was cut short by a badge that only
                  ever says one of four words. */}
              <Column flex={1} minWidth={0}>
                <Body numberOfLines={1}>{e.statements[0] ?? e.category}</Body>
                <Row gap="$2">
                  {originOf(e.origin) ? (
                    <Body tone="mute" size="caption">
                      {originOf(e.origin)}
                    </Body>
                  ) : null}
                  <Body tone="mute" size="caption">
                    {new Date(e.submittedAt).toLocaleDateString()}
                  </Body>
                </Row>
              </Column>
              {/* A status is a state, not a control: small, and never the
                  reason a line of text is cut. */}
              <Chip flexShrink={0} height={20} paddingHorizontal={7} borderColor={e.status === 'pending' ? paint.arc : e.status === 'failed' ? paint.burn : e.status === 'unknown' || e.status === 'dropped' ? paint.arc : undefined}>
                <Body tone={e.status === 'pending' ? 'arc' : e.status === 'failed' ? 'burn' : e.status === 'confirmed' ? 'surge' : e.status === 'unknown' || e.status === 'dropped' ? 'arc' : 'mute'} size="caption" fontSize={11} lineHeight={14} testID={`activity-status-${e.id}`}>
                  {/* `unknown` and `dropped` are honest answers, not failures: the
                      wallet broadcast something and cannot say what became of it. */}
                  {e.status === 'pending' ? t({ id: 'activity.pending', message: 'Pending' }) : e.status === 'failed' ? t({ id: 'activity.failed', message: 'Failed' }) : e.status === 'replaced' ? t({ id: 'activity.replaced', message: 'Replaced' }) : e.status === 'dropped' ? t({ id: 'activity.dropped', message: 'Dropped' }) : e.status === 'unknown' ? t({ id: 'activity.unknown', message: 'Unknown' }) : t({ id: 'activity.confirmed', message: 'Confirmed' })}
                </Body>
              </Chip>
            </Row>
          </Plate>
        ))}
        {loaded && entries.length > 0 ? (
          <Row justifyContent="flex-end" paddingTop="$2">
            <Key label={t({ id: 'activity.clear', message: 'Clear history' })} kind="secondary" size="compact" onPress={() => { setClearError(null); setClearing(true) }} testID="activity-clear" />
          </Row>
        ) : null}
      </ScrollView>

      <Sheet
        open={clearing}
        onClose={() => setClearing(false)}
        title={t({ id: 'activity.clear.title', message: 'Clear history on this device?' })}
        reducedMotion={reducedMotion}
        footer={
          <Column gap="$2">
            <Key label={t({ id: 'activity.clear.key', message: 'Clear history' })} kind="danger" disabled={clearBusy} onPress={clear} testID="activity-clear-confirm" />
            <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" size="compact" disabled={clearBusy} onPress={() => setClearing(false)} testID="activity-clear-cancel" />
          </Column>
        }
        testID="activity-clear-sheet"
      >
        <Column gap="$3">
          <Body>
            {t({ id: 'activity.clear.body', message: 'This erases the record kept on this device — every row, and the statements you were shown when you signed. There is no undo.' })}
          </Body>
          <Body tone="mute" size="caption">
            {t({ id: 'activity.clear.scope', message: 'Nothing on the chain changes: the transactions themselves stay where they are, and an explorer still shows them. Another device you have paired keeps its own record.' })}
          </Body>
          {clearError ? (
            <Body tone="burn" size="caption" testID="activity-clear-error">
              {clearError}
            </Body>
          ) : null}
        </Column>
      </Sheet>

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open?.statements[0] ?? ''} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'close', message: 'Close' })} kind="secondary" size="compact" onPress={() => setOpen(null)} />} testID="activity-detail">
        {open ? (
          <Column gap="$3">
            {open.statements.slice(1).map((s, i) => (
              <Body key={i} tone="mute" size="caption">
                {s}
              </Body>
            ))}
            {open.riskCodes.length ? (
              <Plate gap={2}>
                <Body tone="mute" size="caption">
                  {t({ id: 'activity.risks', message: 'What you were warned about' })}
                </Body>
                {open.riskCodes.map((c) => (
                  <Body key={c} tone="ember" size="caption">
                    {c}
                  </Body>
                ))}
              </Plate>
            ) : null}
            <Row justifyContent="space-between">
              <Body tone="mute" size="caption">
                {t({ id: 'activity.to', message: 'To' })}
              </Body>
              <Body size="caption">
                {counterparty ? (toName ?? shortAddress(counterparty)) : '—'}
              </Body>
            </Row>
            <Row justifyContent="space-between">
              <Body tone="mute" size="caption">
                {t({ id: 'activity.status', message: 'Status' })}
              </Body>
              <Body size="caption">
                {open.status}
                {open.blockNumber ? ` · block ${open.blockNumber}` : ''}
              </Body>
            </Row>
            {open.hash ? (
              <Body tone="mute" size="caption" numberOfLines={1}>
                {open.hash}
              </Body>
            ) : null}
            {/*
              Still waiting (§8.12). Speed up repeats the same call at the same
              place in the queue for a higher fee; cancel puts an empty
              transaction there instead, so the original can never land. Only
              one of the two can win, and either way it costs a fee.
            */}
            {/*
              The wallet sent bytes and cannot say what became of them
              (ES-BV-049). Saying so, with the hash to look up, beats a row
              that sits on "pending" or claims a failure that may not be one.
            */}
            {open.status === 'unknown' || open.status === 'dropped' ? (
              <Plate gap="$2" testID="activity-unresolved">
                <Body size="caption">
                  {open.status === 'dropped'
                    ? t({ id: 'activity.dropped.title', message: 'No longer in the queue' })
                    : t({ id: 'activity.unknown.title', message: 'We could not tell' })}
                </Body>
                <Body tone="mute" size="caption">
                  {open.status === 'dropped'
                    ? t({ id: 'activity.dropped.body', message: 'The network no longer has this transaction. It was either replaced at the same position or dropped for price. Nothing was spent.' })
                    : t({ id: 'activity.unknown.body', message: 'This was broadcast but no block has reported it and we stopped asking. Check the hash on the explorer before sending again.' })}
                </Body>
              </Plate>
            ) : null}
            {open.status === 'pending' && replace ? (
              <Plate gap="$2" testID="activity-replace">
                <Body size="caption">{t({ id: 'activity.stuck', message: 'Still waiting' })}</Body>
                {replace.can ? (
                  <>
                    <Body tone="mute" size="caption">
                      {t({
                        id: 'activity.stuck.body',
                        message: 'It has been sent but no block has taken it yet. You can offer the network more to pick it up sooner, or replace it with an empty transaction so it never happens. Each costs its own network fee, and only one of them can win.',
                      })}
                    </Body>
                    <Row gap="$2" flexWrap="wrap">
                      <Key label={t({ id: 'activity.speedUp', message: 'Speed up' })} kind="secondary" size="compact" disabled={replaceBusy} onPress={() => replaceWith('speedUp')} testID="activity-speed-up" />
                      <Key label={t({ id: 'approval.cancel', message: 'Cancel' })} kind="danger" size="compact" disabled={replaceBusy} onPress={() => replaceWith('cancel')} testID="activity-cancel-tx" />
                    </Row>
                  </>
                ) : (
                  // The reason, not an absent control: a missing button explains nothing.
                  <Body tone="mute" size="caption" testID="activity-replace-why">
                    {replace.why ?? t({ id: 'activity.stuck.no', message: 'There is nothing to replace on this one.' })}
                  </Body>
                )}
                {replaceError ? (
                  <Body tone="burn" size="caption" testID="activity-replace-error">
                    {replaceError}
                  </Body>
                ) : null}
              </Plate>
            ) : null}
            {explorerFor(open) && host.openUrl ? <Key label={t({ id: 'activity.explorer', message: 'Open in explorer' })} kind="secondary" size="compact" onPress={() => void host.openUrl?.(explorerFor(open) ?? '')} testID="activity-explorer" /> : null}
          </Column>
        ) : null}
      </Sheet>
    </Column>
  )
}
