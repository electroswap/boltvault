/**
 * Activity (master plan §8.12): the local, encrypted record of what this
 * wallet did and what reached it, with the statements the user was shown at
 * sign time. A "needs attention" section carries the inbox (plan A6); the
 * inbound scan runs debounced in the engine and shows as a sweep, not a
 * blank tab (plan A2).
 */
import { Body, Chip, Column, Icon, Key, Plate, Refreshing, Row, ScrollView, Segmented, Sheet, SkeletonRows, metrics, paint, shortAddress, type IconName } from '@boltvault/ui'
import { cacheKey, type ActivityEntry, type ChainView, type NotificationView, type ScanSummary } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { useCached } from '../hooks/useCached'
import { useNotifications } from '../hooks/useNotifications'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'

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
  const [chains, setChains] = useState<ChainView[]>([])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const accountId = active?.id ?? null

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
  }, [engine])

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

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="activity">
        <Row justifyContent="space-between" alignItems="center" minHeight={metrics.header}>
          <Body size="title">{t({ id: 'activity.title', message: 'Activity' })}</Body>
          {scan.error && !scan.refreshing ? (
            <Body tone="mute" size="caption" testID="activity-scan-problem">
              {t({ id: 'activity.scan.problem', message: 'Some chains did not answer' })}
            </Body>
          ) : null}
        </Row>
        <Refreshing active={scan.refreshing} reducedMotion={reducedMotion} testID="activity-refreshing" />
        {recent.length > 0 ? (
          <Column gap="$2" testID="activity-attention">
            <Body tone="mute" size="caption">
              {t({ id: 'activity.attention', message: 'Needs attention' })}
            </Body>
            {recent.map((n) => (
              <Plate key={n.id} role="card" gap={2} onPress={() => openNote(n)} cursor="pointer" testID={`note-${n.id}`}>
                <Row gap="$3" alignItems="center">
                  <Icon name={NOTE_ICON[n.kind]} size={18} color={n.read ? paint.mute : paint.ember} />
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
        {!loaded ? <SkeletonRows rows={4} avatar={false} reducedMotion={reducedMotion} testID="activity-loading" /> : null}
        {loaded && shown.length === 0 ? (
          <Plate gap="$2" testID="activity-empty">
            <Body tone="mute">{t({ id: 'activity.empty', message: 'Nothing yet. Sends, swaps and everything the wallet signs will appear here, with what you were shown when you signed.' })}</Body>
          </Plate>
        ) : null}
        {shown.map((e) => (
          <Plate key={e.id} role="card" gap={4} onPress={() => setOpen(e)} cursor="pointer" testID={`activity-${e.id}`}>
            <Row gap="$3" alignItems="center">
              <Icon name={iconFor(e)} size={18} color={e.status === 'failed' ? paint.burn : e.category === 'RECEIVE' ? paint.arc : paint.mute} />
              <Column flex={1}>
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
              <Chip borderColor={e.status === 'pending' ? paint.arc : e.status === 'failed' ? paint.burn : undefined}>
                <Body tone={e.status === 'pending' ? 'arc' : e.status === 'failed' ? 'burn' : e.status === 'confirmed' ? 'surge' : 'mute'} size="caption" testID={`activity-status-${e.id}`}>
                  {e.status === 'pending' ? t({ id: 'activity.pending', message: 'Pending' }) : e.status === 'failed' ? t({ id: 'activity.failed', message: 'Failed' }) : e.status === 'replaced' ? t({ id: 'activity.replaced', message: 'Replaced' }) : t({ id: 'activity.confirmed', message: 'Confirmed' })}
                </Body>
              </Chip>
            </Row>
          </Plate>
        ))}
      </ScrollView>

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
              <Body size="caption">{open.to ? shortAddress(open.to) : '—'}</Body>
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
            {explorerFor(open) && host.openUrl ? <Key label={t({ id: 'activity.explorer', message: 'Open in explorer' })} kind="secondary" size="compact" onPress={() => void host.openUrl?.(explorerFor(open) ?? '')} testID="activity-explorer" /> : null}
          </Column>
        ) : null}
      </Sheet>
    </Column>
  )
}
