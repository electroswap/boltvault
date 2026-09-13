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
import { Body, Column, Icon, IconButton, Input, Key, Plate, Pressable, Row, ScrollView, Toggle, metrics, paint, shortAddress } from '@boltvault/ui'
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

/** What the host can say about push (`host.push.status`); `null` is "not asked yet". */
type PushState = 'unavailable' | 'off' | 'granted' | 'denied'

export function Alerts({ body }: { body: BodyKind }) {
  const host = useHost()
  // A control that could never be thrown was still on screen. The plate
  // rendered whenever `host.push` existed and `pushState` started at
  // 'unavailable', so a body or an API without push got a Push plate whose only
  // key was permanently disabled — a switch whose whole job was to explain why
  // it does nothing. Owner: when push is not enabled on the wallet body or on
  // the API, it should not be visible at all.
  //
  // `null` is "we have not asked yet", and it is deliberately neither
  // 'unavailable' nor 'off'. Hiding has to be the settled answer: seeding the
  // state with 'off' flashes the plate in and yanks it out a tick later, and
  // seeding it with 'unavailable' renders "we have not asked" as "there is
  // none", which hides a plate that is about to be legitimate. So nothing is
  // drawn until `push.status()` has answered.
  const [pushState, setPushState] = useState<PushState | null>(null)
  const refreshPush = (): void => {
    if (host.push) host.push.status().then(setPushState, () => setPushState('unavailable'))
  }
  useEffect(refreshPush, [host])
  const engine = useEngine()
  const router = useRouter()
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const { items: notes, markRead, remove: removeNote, clear: clearNotes } = useNotifications()
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

  // Both halves of the owner's condition land in one answer.
  //
  // THE BODY: no `host.push` at all (the extension), or a `push.status()` of
  // 'unavailable'.
  //
  // THE API: `POST /api/wallet/devices` answers 503 — not 404 — when the
  // service runs with `pushEnabled` false, precisely so a client can tell "off"
  // from "gone". The phone's host is what hears that (`apps/mobile/src/push.ts`)
  // and folds it back into `status()` as 'unavailable', because a device the
  // watcher will not register cannot be told anything while the app is closed.
  // No endpoint states that setting, so the wallet cannot know it before it has
  // tried once; what it must never do is call the unknown "available".
  const pushVisible = host.push !== undefined && pushState !== null && pushState !== 'unavailable'

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
            <NoteRow key={n.id} note={n} onOpen={() => openTarget(n.target)} onRemove={() => removeNote(n.id)} />
          ))}
        </Column>
      ) : null}
      {pushVisible ? (
        <Plate gap="$2" testID="alerts-push">
          <Row justifyContent="space-between" alignItems="center">
            <Body size="title">{t({ id: 'alerts.push', message: 'Push' })}</Body>
            {/* 'denied' is the one state that still shows a disabled key: the
                switch is real, it is the system settings that are holding it
                down, and the caption below says so. 'unavailable' no longer
                reaches here at all — the plate is gone instead. */}
            <Key label={pushState === 'granted' ? t({ id: 'alerts.push.off', message: 'Turn off' }) : t({ id: 'alerts.push.on', message: 'Turn on' })} kind="secondary" disabled={pushState === 'denied'} onPress={() => void (pushState === 'granted' ? host.push?.disable().then(() => refreshPush()) : host.push?.enable().then(() => refreshPush()))} testID="alerts-push-toggle" />
          </Row>
          <Body tone="mute" size="caption">
            {pushState === 'granted' ? t({ id: 'alerts.push.granted', message: 'On. Incoming funds, sales and offers, campaigns going live, rewards and dividends arrive while the app is closed.' }) : pushState === 'denied' ? t({ id: 'alerts.push.denied', message: 'Notifications are off for BoltVault in the system settings.' }) : t({ id: 'alerts.push.off.body', message: 'Off. Turn it on to hear about incoming funds, sales, campaigns and rewards while the app is closed. Only a type and an id ever travel; the app fetches the details.' })}
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
          {/*
            The same row shape the address book uses (ES-BV-080).

            This had no `gap`, a text column that could not shrink, and a raw
            `Chip` pressed into service as a button — a decorative frame with no
            `accessibilityRole`, no accessible name, four pixels of visible
            height, and a `minHeight={44}` bolted on to rescue the tap target.
            That 44 px reached well above and below the chip itself and overlapped
            the rest of the row, which is what "the remove buttons are placed
            badly" describes. A long collection name then pushed the whole thing
            to the edge with nothing between them.
          */}
          <Row justifyContent="space-between" alignItems="center" gap="$2">
            <Column flex={1} minWidth={0} alignItems="flex-start">
              <Body numberOfLines={1}>{i.label}</Body>
              <Body tone="mute" size="caption">
                {`${i.kind === 'token' ? t({ id: 'alerts.token', message: 'Token' }) : i.kind === 'collection' ? t({ id: 'alerts.collection', message: 'Collection' }) : t({ id: 'alerts.campaign', message: 'Campaign' })} · ${shortAddress(i.address)}`}
                {i.lastValue !== null && i.kind !== 'campaign' ? ` · ${i.kind === 'token' ? '$' : ''}${i.lastValue}${i.kind === 'collection' ? ' ETN' : ''}` : ''}
              </Body>
            </Column>
            <IconButton
              icon="trash"
              tone="burn"
              label={t({ id: 'alerts.remove.one', message: 'Stop watching {n}', values: { n: i.label } })}
              onPress={() => void engine.watchlist.unstar({ kind: i.kind, chainId: i.chainId, address: i.address })}
              testID={`alert-remove-${i.address}`}
            />
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
function NoteRow({ note, onOpen, onRemove }: { note: NotificationView; onOpen: () => void; onRemove: () => void }) {
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
          {/*
            A note you have dealt with can go (ES-BV-082). The inbox was
            all-or-nothing — `clear` in the section header — so the only way to
            tidy one row was to throw the rest away with it.
          */}
          <IconButton icon="close" label={t({ id: 'alerts.dismiss', message: 'Dismiss {n}', values: { n: note.title } })} onPress={onRemove} testID={`alert-dismiss-${note.id}`} />
        </Row>
      </Plate>
    </Pressable>
  )
}
