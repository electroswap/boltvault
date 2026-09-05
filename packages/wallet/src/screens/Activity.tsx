/**
 * Activity (master plan §8.12): the local, encrypted record of what this
 * wallet did and what reached it, with the statements the user was shown at
 * sign time. Pending rows breathe; a detail sheet carries risk codes, the
 * receipt and an explorer link.
 */
import { Body, Chip, Column, Icon, Key, Plate, Row, ScrollView, Segmented, Sheet, metrics, paint, shortAddress } from '@boltvault/ui'
import type { ActivityEntry, ChainView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'

type Filter = 'all' | 'sent' | 'received' | 'approvals'

function matches(e: ActivityEntry, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'sent') return e.category === 'SEND' || e.category === 'SWAP' || e.category === 'DAPP'
  if (f === 'received') return e.category === 'RECEIVE'
  return e.category === 'APPROVE' || e.category === 'REVOKE'
}

function iconFor(e: ActivityEntry): 'arrowUpRight' | 'arrowDownLeft' | 'approvals' | 'swap' | 'external' {
  switch (e.category) {
    case 'RECEIVE':
      return 'arrowDownLeft'
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

export function Activity({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const { active } = useWalletState()
  const { entries, loaded } = useActivity(active?.id ?? null)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<ActivityEntry | null>(null)
  const [chains, setChains] = useState<ChainView[]>([])
  const [scanning, setScanning] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
  }, [engine])

  // Catch up on inbound transfers once per open (bounded, §8.12).
  useEffect(() => {
    if (!active) return
    let alive = true
    setScanning(true)
    engine.activityScan.scan({ accountId: active.id, chainId: 52014 }).catch(() => undefined).finally(() => alive && setScanning(false))
    return () => {
      alive = false
    }
  }, [engine, active])

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
        <Row justifyContent="space-between" alignItems="center">
          <Body size="title">{t({ id: 'activity.title', message: 'Activity' })}</Body>
          {scanning ? (
            <Body tone="mute" size="caption">
              {t({ id: 'activity.scanning', message: 'Checking for arrivals…' })}
            </Body>
          ) : null}
        </Row>
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
          <Plate key={e.id} gap={4} onPress={() => setOpen(e)} cursor="pointer" testID={`activity-${e.id}`}>
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
                <Body tone={e.status === 'pending' ? 'arc' : e.status === 'failed' ? 'burn' : 'mute'} size="caption" testID={`activity-status-${e.id}`}>
                  {e.status === 'pending' ? t({ id: 'activity.pending', message: 'Pending' }) : e.status === 'failed' ? t({ id: 'activity.failed', message: 'Failed' }) : e.status === 'replaced' ? t({ id: 'activity.replaced', message: 'Replaced' }) : t({ id: 'activity.confirmed', message: 'Confirmed' })}
                </Body>
              </Chip>
            </Row>
          </Plate>
        ))}
      </ScrollView>

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open?.statements[0] ?? ''} testID="activity-detail">
        {open ? (
          <Column gap="$3" padding={inset}>
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
              <Body size="caption">{open.status}{open.blockNumber ? ` · block ${open.blockNumber}` : ''}</Body>
            </Row>
            {open.hash ? (
              <Body tone="mute" size="caption" fontFamily="$mono" numberOfLines={1}>
                {open.hash}
              </Body>
            ) : null}
            {explorerFor(open) && host.openUrl ? <Key label={t({ id: 'activity.explorer', message: 'Open in explorer' })} kind="secondary" onPress={() => void host.openUrl?.(explorerFor(open) ?? '')} testID="activity-explorer" /> : null}
            <Key label={t({ id: 'close', message: 'Close' })} kind="secondary" onPress={() => setOpen(null)} />
          </Column>
        ) : null}
      </Sheet>
    </Column>
  )
}
