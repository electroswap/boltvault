/**
 * Settings › Notifications (master plan §8.14, §7.13): the watchlist with
 * its alerts — a price or floor threshold per starred token or collection,
 * "tell me when it goes live" per campaign — and the two daily nudges the
 * wallet sends on its own (rewards to collect, dividends to claim).
 */
import { Body, Chip, Column, Icon, Input, Key, Plate, Row, ScrollView, Toggle, metrics, paint, shortAddress } from '@boltvault/ui'
import type { WatchItem } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Alerts({ body }: { body: BodyKind }) {
  const engine = useEngine()
  const router = useRouter()
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [items, setItems] = useState<WatchItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, { above: string; below: string }>>({})
  const [checked, setChecked] = useState<string[] | null>(null)

  useEffect(() => {
    engine.watchlist.list().then(setItems, () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'watchlist.changed') setItems(e.items)
    })
  }, [engine])

  const key = (i: WatchItem): string => `${i.kind}:${i.chainId}:${i.address.toLowerCase()}`
  const save = async (i: WatchItem): Promise<void> => {
    const d = drafts[key(i)]
    const num = (s: string | undefined, fallback: number | null): number | null => (s === undefined ? fallback : s.trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : fallback)
    await engine.watchlist.setAlert({ kind: i.kind, chainId: i.chainId, address: i.address, above: num(d?.above, i.above), below: num(d?.below, i.below), onLive: i.onLive })
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="alerts">
      <Row justifyContent="space-between" alignItems="center">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'alerts.title', message: 'Notifications' })}</Body>
      </Row>
      <Body tone="mute" size="caption">
        {t({ id: 'alerts.body', message: 'Star a token, collection or campaign from Explore, then set what to tell you about. Rewards to collect and dividends to claim are mentioned once a day on their own. Nothing here nags.' })}
      </Body>
      {items.length === 0 ? (
        <Plate gap="$2" testID="alerts-empty">
          <Body tone="mute" size="caption">
            {t({ id: 'alerts.empty', message: 'Nothing starred yet.' })}
          </Body>
          <Key label={t({ id: 'alerts.explore', message: 'Explore' })} kind="secondary" onPress={() => router.setTab('explore')} testID="alerts-explore" />
        </Plate>
      ) : null}
      {items.map((i) => (
        <Plate key={key(i)} gap="$2" testID={`alert-${i.kind}-${i.address}`}>
          <Row justifyContent="space-between" alignItems="center">
            <Column>
              <Body>{i.label}</Body>
              <Body tone="mute" size="caption">
                {`${i.kind === 'token' ? t({ id: 'alerts.token', message: 'Token' }) : i.kind === 'collection' ? t({ id: 'alerts.collection', message: 'Collection' }) : t({ id: 'alerts.campaign', message: 'Campaign' })} · ${shortAddress(i.address)}`}
                {i.lastValue !== null && i.kind !== 'campaign' ? ` · ${i.kind === 'token' ? '$' : ''}${i.lastValue}${i.kind === 'collection' ? ' ETN' : ''}` : ''}
              </Body>
            </Column>
            <Chip onPress={() => void engine.watchlist.unstar({ kind: i.kind, chainId: i.chainId, address: i.address })} cursor="pointer" minHeight={44} justifyContent="center" testID={`alert-remove-${i.address}`}>
              <Body tone="burn" size="caption">
                {t({ id: 'alerts.remove', message: 'Remove' })}
              </Body>
            </Chip>
          </Row>
          {i.kind === 'campaign' ? (
            <Toggle value={i.onLive} onChange={(v) => void engine.watchlist.setAlert({ kind: i.kind, chainId: i.chainId, address: i.address, above: i.above, below: i.below, onLive: v })} label={t({ id: 'alerts.onLive', message: 'Tell me when it goes live' })} testID={`alert-live-${i.address}`} />
          ) : (
            <Row gap="$2" alignItems="flex-end">
              <Column flex={1}>
                <Input value={drafts[key(i)]?.above ?? (i.above === null ? '' : String(i.above))} onChange={(v) => setDrafts((d) => ({ ...d, [key(i)]: { above: v, below: d[key(i)]?.below ?? (i.below === null ? '' : String(i.below)) } }))} label={i.kind === 'token' ? t({ id: 'alerts.above', message: 'Above $' }) : t({ id: 'alerts.aboveEtn', message: 'Floor above (ETN)' })} placeholder="—" testID={`alert-above-${i.address}`} />
              </Column>
              <Column flex={1}>
                <Input value={drafts[key(i)]?.below ?? (i.below === null ? '' : String(i.below))} onChange={(v) => setDrafts((d) => ({ ...d, [key(i)]: { above: d[key(i)]?.above ?? (i.above === null ? '' : String(i.above)), below: v } }))} label={i.kind === 'token' ? t({ id: 'alerts.below', message: 'Below $' }) : t({ id: 'alerts.belowEtn', message: 'Floor below (ETN)' })} placeholder="—" testID={`alert-below-${i.address}`} />
              </Column>
              <Key label={t({ id: 'save', message: 'Save' })} kind="secondary" onPress={() => void save(i)} testID={`alert-save-${i.address}`} />
            </Row>
          )}
        </Plate>
      ))}
      {items.length ? (
        <Row gap="$2" alignItems="center">
          <Key label={t({ id: 'alerts.check', message: 'Check now' })} kind="secondary" onPress={() => engine.watchlist.check().then(setChecked, () => setChecked([]))} testID="alerts-check" />
          {checked ? (
            <Body tone="mute" size="caption" testID="alerts-checked">
              {checked.length ? t({ id: 'alerts.sent', message: '{n} sent', values: { n: checked.length } }) : t({ id: 'alerts.quiet', message: 'Nothing to tell you' })}
            </Body>
          ) : null}
        </Row>
      ) : null}
    </ScrollView>
  )
}
