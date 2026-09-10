/**
 * Settings › Notifications (master plan §8.14, §7.13): what the wallet has told
 * you, then the watchlist that decides what it tells you next — a price or
 * floor threshold per starred token or collection, "tell me when it goes live"
 * per campaign — and the two daily nudges it sends on its own.
 *
 * **The inbox had no screen.** Home's Alerts tile badges `notifications.unread`,
 * and this page listed only the watchlist, so a badged "1" opened onto "Nothing
 * starred yet." — two different collections, one of them with nowhere to be
 * read. Owner: "the Alerts button sometimes has a 1 badge, but clicking on it
 * just shows 'Nothing starred yet' and no alert."
 *
 * Opening the page marks them read, which is what clears the badge. That is the
 * whole contract of a badge: it counts what you have not seen, and you have now
 * seen it.
 */
import { Body, Chip, Column, Icon, Input, Key, Plate, Pressable, Row, ScrollView, Toggle, metrics, paint, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { NotificationView, WatchItem } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useNotifications } from '../hooks/useNotifications'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

const ETN = 52014

/** The glyph for each kind of note, from the set the rest of the app already uses. */
const ICONS = { alert: 'bell', live: 'launch', offer: 'nft', collect: 'farm', dividends: 'star', arrival: 'receive', system: 'info' } as const

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Alerts({ body }: { body: BodyKind }) {
  const host = useHost()
  const [pushState, setPushState] = useState<'unavailable' | 'off' | 'granted' | 'denied'>('unavailable')
  const refreshPush = (): void => {
    if (host.push) host.push.status().then(setPushState, () => setPushState('unavailable'))
  }
  useEffect(refreshPush, [host])
  const engine = useEngine()
  const router = useRouter()
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const { items: notes, markRead, clear: clearNotes } = useNotifications()
  const [items, setItems] = useState<WatchItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, { above: string; below: string }>>({})
  const [checked, setChecked] = useState<string[] | null>(null)

  /*
    Marked read on arrival, once. Not per render, or a note that lands while
    the page is open would be marked read before it has been on screen for a
    frame — and not never, or the badge would still be counting notes the user
    is looking at.
  */
  useEffect(() => {
    markRead()
    // Deliberately on mount only: `markRead` is stable enough and re-running
    // this would swallow anything arriving while the page is open.
  }, [])

  useEffect(() => {
    engine.watchlist.list().then(setItems, () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'watchlist.changed') setItems(e.items)
    })
  }, [engine])

  /** Where a note points. The same mapping Home's rotor uses for the same strings. */
  const openTarget = (target: string | null): void => {
    if (target === null) return
    if (target === 'legends') return router.navigate('legends')
    if (target === 'offers' || target === 'positions') return router.navigate('portfolio')
    if (target.startsWith('farm:')) return router.navigate('farm', { chainId: ETN, farmId: Number(target.slice(5)) })
    if (target.startsWith('campaign:')) return router.navigate('campaign', { chainId: ETN, pool: target.slice(9) })
  }

  const key = (i: WatchItem): string => `${i.kind}:${i.chainId}:${i.address.toLowerCase()}`
  const save = async (i: WatchItem): Promise<void> => {
    const d = drafts[key(i)]
    const num = (s: string | undefined, fallback: number | null): number | null => (s === undefined ? fallback : s.trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : fallback)
    await engine.watchlist.setAlert({ kind: i.kind, chainId: i.chainId, address: i.address, above: num(d?.above, i.above), below: num(d?.below, i.below), onLive: i.onLive })
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="alerts">
      <PageHeader title={t({ id: 'alerts.title', message: 'Notifications' })} />
      <Body tone="mute" size="caption">
        {t({ id: 'alerts.body', message: 'Star a token, collection or campaign from Explore, then set what to tell you about. Rewards to collect and dividends to claim are mentioned once a day on their own. Nothing here nags.' })}
      </Body>
      {notes.length > 0 ? (
        <Column gap="$2" testID="alerts-inbox">
          <Row justifyContent="space-between" alignItems="center">
            <Body size="title">{t({ id: 'alerts.inbox', message: 'Recent' })}</Body>
            <Key label={t({ id: 'alerts.clear', message: 'Clear' })} kind="secondary" size="compact" onPress={clearNotes} testID="alerts-clear" />
          </Row>
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} onOpen={() => openTarget(n.target)} />
          ))}
        </Column>
      ) : null}
      {host.push ? (
      <Plate gap="$2" testID="alerts-push">
        <Row justifyContent="space-between" alignItems="center">
          <Body size="title">{t({ id: 'alerts.push', message: 'Push' })}</Body>
          {host.push ? <Key label={pushState === 'granted' ? t({ id: 'alerts.push.off', message: 'Turn off' }) : t({ id: 'alerts.push.on', message: 'Turn on' })} kind="secondary" disabled={pushState === 'denied' || pushState === 'unavailable'} onPress={() => void (pushState === 'granted' ? host.push?.disable().then(() => refreshPush()) : host.push?.enable().then(() => refreshPush()))} testID="alerts-push-toggle" /> : null}
        </Row>
        <Body tone="mute" size="caption">
          {!host.push ? t({ id: 'alerts.push.web', message: 'The extension checks in the background on its own; push is for the phone.' }) : pushState === 'granted' ? t({ id: 'alerts.push.granted', message: 'On. Incoming funds, sales and offers, campaigns going live, rewards and dividends arrive while the app is closed.' }) : pushState === 'denied' ? t({ id: 'alerts.push.denied', message: 'Notifications are off for BoltVault in the system settings.' }) : t({ id: 'alerts.push.off.body', message: 'Off. Turn it on to hear about incoming funds, sales, campaigns and rewards while the app is closed. Only a type and an id ever travel; the app fetches the details.' })}
        </Body>
      </Plate>
      ) : null}
      {items.length === 0 ? (
        <Plate gap="$2" testID="alerts-empty">
          <Body tone="mute" size="caption">
            {t({ id: 'alerts.empty', message: 'Nothing starred yet.' })}
          </Body>
          <Key label={t({ id: 'alerts.explore', message: 'Explore' })} kind="secondary" onPress={() => router.navigate('explore')} testID="alerts-explore" />
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

/** One note: what happened, and a way to go and deal with it. */
function NoteRow({ note, onOpen }: { note: NotificationView; onOpen: () => void }) {
  const tappable = note.target !== null
  return (
    <Pressable onPress={tappable ? onOpen : undefined} disabled={!tappable} accessibilityRole={tappable ? 'button' : undefined} accessibilityLabel={`${note.title}. ${note.body}`} testID={`alert-note-${note.kind}`}>
      <Plate role="card" gap={2} paddingVertical={10}>
        <Row gap="$2" alignItems="center">
          <Icon name={ICONS[note.kind]} size={16} color={note.read ? paint.mute : paint.arc} />
          <Column flex={1} minWidth={0} alignItems="flex-start" gap={1}>
            <Body size="caption" fontWeight={note.read ? '400' : '600'} numberOfLines={1}>
              {note.title}
            </Body>
            <Body tone="mute" size="caption" fontSize={11} lineHeight={14} numberOfLines={2}>
              {note.body}
            </Body>
          </Column>
          {tappable ? <Icon name="chevronRight" size={14} color={paint.mute} /> : null}
        </Row>
      </Plate>
    </Pressable>
  )
}
