/** Settings › Devices & sync (master plan §6): pair, confirm the code, push/pull, move a vault in. */
import { Body, Column, Input, Key, Plate, QR, Readout, Row, ScrollView, metrics } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { RemoteRequest, SyncIncomingItem, SyncStatus } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'

/**
 * How much of an animated export has been read.
 *
 * The frame header (`bv:x/<i>/<n>:`) is minted in `@boltvault/core`, which the
 * wallet does not depend on — and `scanQr`'s callback is synchronous, so it
 * could not ask the engine even if it did. Parsed here for the same reason
 * `urPartsDone` parses UR sequence headers next door.
 */
function exportProgress(frames: readonly string[]): { seen: number; total: number } {
  const indices = new Set<number>()
  let total = 0
  for (const f of frames) {
    const m = /^bv:x\/(\d+)\/(\d+):/.exec(f.trim())
    if (!m) continue
    total = Number(m[2])
    indices.add(Number(m[1]))
  }
  return { seen: indices.size, total }
}

/** "3 May" — the date half of the provenance line §6 asks for. */
function shortDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(at))
}

export function Devices({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [mode, setMode] = useState<'idle' | 'offer' | 'answer'>('idle')
  const [offer, setOffer] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [remote, setRemote] = useState<{ outgoing: RemoteRequest[]; incoming: RemoteRequest[] }>({ outgoing: [], incoming: [] })
  const [waiting, setWaiting] = useState<SyncIncomingItem[]>([])
  const [hasVault, setHasVault] = useState(true)
  const [frames, setFrames] = useState<string[]>([])
  const [movePasted, setMovePasted] = useState('')
  const [code, setCode] = useState('')
  const [movePassword, setMovePassword] = useState('')
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  // Camera or keyboard, the frames are the same list, so everything below reads one.
  const moveFrames = host.scanQr ? frames : movePasted.split(/\s+/).filter(Boolean)
  const moveProgress = exportProgress(moveFrames)
  const moveReady = moveProgress.total > 0 && moveProgress.seen >= moveProgress.total

  const refreshWaiting = useCallback(() => {
    engine.sync.incoming().then(setWaiting, () => undefined)
  }, [engine])

  useEffect(() => {
    engine.sync.status().then(setStatus, () => undefined)
    engine.remote.list().then(setRemote, () => undefined)
    engine.vault.status().then((s) => setHasVault(s.exists), () => undefined)
    refreshWaiting()
    return engine.events.subscribe((e) => {
      if (e.type === 'sync.changed') {
        setStatus(e.status)
        refreshWaiting()
      }
      if (e.type === 'remote.changed') setRemote({ outgoing: e.outgoing, incoming: e.incoming })
      if (e.type === 'vault.status') setHasVault(e.status.exists)
    })
  }, [engine, refreshWaiting])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    setNote(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const scanOrPaste = async (): Promise<string> => (host.scanQr ? host.scanQr() : Promise.resolve(pasted))

  /*
    An export is many frames, not one code, so the scanner is driven with
    `onPart`: it keeps reading distinct codes and stops the moment every
    numbered frame of the set has been seen.
  */
  const scanExport = async (): Promise<void> => {
    if (!host.scanQr) return
    const parts = [...frames]
    await host.scanQr((text) => {
      if (!parts.includes(text)) parts.push(text)
      setFrames([...parts])
      const p = exportProgress(parts)
      return p.total > 0 && p.seen >= p.total
    })
    setFrames([...parts])
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 16 }} testID="devices">
      <PageHeader title={t({ id: 'devices.title', message: 'Devices & sync' })} />

      <Plate gap="$2">
        <Body tone="mute" size="caption">
          {t({ id: 'devices.this', message: 'This device' })}
        </Body>
        <Row gap="$2" alignItems="flex-end">
          <Column flex={1}>
            <Input value={label} onChange={setLabel} placeholder={status?.deviceLabel ?? ''} />
          </Column>
          <Key label={t({ id: 'save', message: 'Save' })} kind="secondary" disabled={!label.trim()} onPress={() => run(async () => { await engine.sync.setDeviceLabel({ label: label.trim() }); setLabel('') })} />
        </Row>
        <Body tone="mute" size="caption">
          {t({ id: 'devices.what', message: 'Paired devices share your address book, account names, custom and hidden tokens, per-site chains, settings, and watch-only and hardware accounts. Seeds and keys never sync — move a vault with the code below.' })}
        </Body>
      </Plate>

      {status?.pending ? (
        <Plate role="raised" gap="$3" testID="sas">
          <Body size="title">{t({ id: 'devices.sas.title', message: 'Compare the codes' })}</Body>
          <Body tone="mute" size="caption">
            {t({ id: 'devices.sas.body', message: 'Both devices show a six-digit code. Confirm only if they match exactly.' })}
          </Body>
          <Readout fontSize={34} letterSpacing={4} testID="sas-code">
            {status.pending.sas}
          </Readout>
          <Row gap="$2">
            <Key label={t({ id: 'devices.sas.match', message: 'They match' })} onPress={() => run(async () => { await engine.sync.confirm(); setMode('idle'); setOffer(null); setAnswer(null) })} testID="sas-confirm" />
            <Key label={t({ id: 'devices.sas.no', message: 'They differ' })} kind="danger" onPress={() => run(async () => { await engine.sync.cancelPairing(); setMode('idle'); setOffer(null); setAnswer(null) })} />
          </Row>
        </Plate>
      ) : null}

      {mode === 'idle' && !status?.pending ? (
        <Column gap="$2">
          <Key label={t({ id: 'devices.pair.new', message: 'Pair a new device' })} onPress={() => run(async () => { const r = await engine.sync.createOffer({ relayUrl: host.relayUrl }); setOffer(r.offer); setMode('offer') })} testID="pair-new" />
          <Key label={t({ id: 'devices.pair.join', message: 'Join from a code' })} kind="secondary" onPress={() => setMode('answer')} testID="pair-join" />
        </Column>
      ) : null}

      {mode === 'offer' && offer ? (
        <Plate gap="$3" testID="offer">
          <Body size="title">{t({ id: 'devices.offer.title', message: 'Scan this on the other device' })}</Body>
          <Column alignItems="center">
            <QR value={offer} size={220} />
          </Column>
          <Body tone="mute" size="caption">
            {t({ id: 'devices.offer.then', message: 'Then scan (or paste) the answer it shows.' })}
          </Body>
          {!host.scanQr ? <Input value={pasted} onChange={setPasted} multiline placeholder={t({ id: 'devices.answer.paste', message: 'Paste the answer code' })} /> : null}
          <Key label={host.scanQr ? t({ id: 'devices.scan', message: 'Scan answer' }) : t({ id: 'devices.use', message: 'Use answer' })} onPress={() => run(async () => { await engine.sync.completeOffer({ answer: await scanOrPaste() }); setPasted('') })} testID="complete-offer" />
          <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" onPress={() => run(async () => { await engine.sync.cancelPairing(); setMode('idle'); setOffer(null) })} />
        </Plate>
      ) : null}

      {mode === 'answer' ? (
        <Plate gap="$3" testID="answer">
          <Body size="title">{t({ id: 'devices.answer.title', message: 'Scan the other device’s code' })}</Body>
          {!host.scanQr ? <Input value={pasted} onChange={setPasted} multiline placeholder={t({ id: 'devices.offer.paste', message: 'Paste the pairing code' })} /> : null}
          {!answer ? (
            <Key label={host.scanQr ? t({ id: 'devices.scan.code', message: 'Scan' }) : t({ id: 'devices.use.code', message: 'Use code' })} onPress={() => run(async () => { const r = await engine.sync.acceptOffer({ offer: await scanOrPaste() }); setAnswer(r.answer); setPasted('') })} testID="accept-offer" />
          ) : (
            <>
              <Body tone="mute" size="caption">
                {t({ id: 'devices.answer.show', message: 'Show this to the first device, then compare the codes.' })}
              </Body>
              <Column alignItems="center">
                <QR value={answer} size={220} />
              </Column>
            </>
          )}
          <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" onPress={() => run(async () => { await engine.sync.cancelPairing(); setMode('idle'); setAnswer(null) })} />
        </Plate>
      ) : null}

      {/*
        §6: a paired device is not trusted for security-relevant state. A name
        or a token it sends is here, but BoltVault does not count it as a name
        it knows until the person in front of this screen says so.
      */}
      {waiting.length > 0 ? (
        <Plate gap="$3" testID="devices-waiting">
          <Body size="title">{t({ id: 'devices.waiting', message: 'Waiting for you to confirm' })}</Body>
          <Body tone="mute" size="caption">
            {t({ id: 'devices.waiting.body', message: 'Names and tokens another device sent. Until you confirm one here, BoltVault will not treat it as a name it knows or a token it recognises — so a device that is not yours cannot put a name on an address or pass one token off as another.' })}
          </Body>
          {waiting.map((i) => (
            <Column key={`${i.collection}:${i.key}`} gap="$1" testID={`devices-waiting-${i.collection}`}>
              <Body>
                {i.collection === 'contact'
                  ? t({ id: 'devices.waiting.name', message: 'Name: {label}', values: { label: i.label } })
                  : t({ id: 'devices.waiting.token', message: 'Token: {label}', values: { label: i.label } })}
              </Body>
              <Body tone="mute" size="caption">
                {i.detail}
              </Body>
              <Body tone="mute" size="caption">
                {t({ id: 'devices.waiting.from', message: 'from {device}, {date}', values: { device: i.fromLabel, date: shortDate(i.at) } })}
              </Body>
              <Row gap="$2">
                <Key label={t({ id: 'devices.waiting.confirm', message: 'Confirm' })} size="compact" onPress={() => run(async () => { setWaiting(await engine.sync.confirmIncoming({ collection: i.collection, key: i.key })) })} testID={`devices-confirm-${i.collection}`} />
                <Key label={t({ id: 'devices.waiting.reject', message: 'Remove it' })} kind="danger" size="compact" onPress={() => run(async () => { setWaiting(await engine.sync.rejectIncoming({ collection: i.collection, key: i.key })) })} testID={`devices-reject-${i.collection}`} />
              </Row>
            </Column>
          ))}
        </Plate>
      ) : null}

      <Plate gap="$2" testID="remote-requests">
        <Body size="title">{t({ id: 'devices.requests', message: 'Signing requests' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'devices.requests.body', message: 'An account whose key lives on another paired device signs there: the request opens as a signing sheet on that device, and the answer comes back here. Only you can approve it, and only after reading what it signs.' })}
        </Body>
        {remote.outgoing.length === 0 && remote.incoming.length === 0 ? (
          <Body tone="mute" size="caption">
            {t({ id: 'devices.requests.none', message: 'Nothing waiting.' })}
          </Body>
        ) : null}
        {remote.outgoing.map((r) => (
          <Row key={r.id} justifyContent="space-between" alignItems="center" testID={`remote-out-${r.id}`}>
            <Body size="caption">{t({ id: 'devices.requests.out', message: 'Waiting for a paired device · {k}', values: { k: r.kind } })}</Body>
            <Body tone="burn" size="caption" onPress={() => void engine.remote.cancel({ id: r.id })}>
              {t({ id: 'cancel', message: 'Cancel' })}
            </Body>
          </Row>
        ))}
        {remote.incoming.map((r) => (
          <Row key={r.id} justifyContent="space-between" alignItems="center" testID={`remote-in-${r.id}`}>
            <Body size="caption">{t({ id: 'devices.requests.in', message: 'From {d} · {k} — open in the signing sheet', values: { d: r.from ?? '?', k: r.kind } })}</Body>
          </Row>
        ))}
      </Plate>

      <Plate gap="$2" testID="paired">
        <Body size="title">{t({ id: 'devices.paired', message: 'Paired devices' })}</Body>
        {status && status.devices.length === 0 ? (
          <Body tone="mute" size="caption">
            {t({ id: 'devices.none', message: 'None yet.' })}
          </Body>
        ) : null}
        {status?.devices.map((d) => (
          <Row key={d.deviceId} justifyContent="space-between">
            <Body>{d.label}</Body>
            <Body tone="burn" size="caption" onPress={() => run(() => engine.sync.unpair({ deviceId: d.deviceId }).then(() => undefined))}>
              {t({ id: 'devices.unpair', message: 'Unpair' })}
            </Body>
          </Row>
        ))}
        {status && status.devices.length > 0 ? (
          <Column gap="$2">
            <Key label={t({ id: 'devices.push', message: 'Send changes' })} kind="secondary" onPress={() => run(async () => { const r = await engine.sync.push(); setNote(t({ id: 'devices.pushed', message: 'Sent {n} records.', values: { n: r.pushed } })) })} />
            <Key label={t({ id: 'devices.pull', message: 'Fetch changes' })} kind="secondary" onPress={() => run(async () => { const r = await engine.sync.pull(); setNote(t({ id: 'devices.pulled', message: 'Applied {n} records.', values: { n: r.applied } })) })} />
          </Column>
        ) : null}
      </Plate>

      {/*
        The receiving half of the air-gapped move (§6). The source device shows
        animated QR frames and a six-word phrase; the phrase is typed here and
        is never displayed on this side, so a camera pointed at this screen
        learns nothing that would open the ciphertext it just watched go past.
      */}
      <Plate gap="$3" testID="vault-move">
        <Body size="title">{t({ id: 'devices.move.title', message: 'Move a vault here' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'devices.move.body', message: 'On the device that holds the vault, open Security and show the export. Read every frame of the moving code with the camera here, then type the six words it shows. BoltVault never shows those words on this side.' })}
        </Body>
        {hasVault ? (
          <Body tone="mute" size="caption">
            {t({ id: 'devices.move.occupied', message: 'This device already holds a vault, and a move only lands on one that does not. Do it while setting the device up, or remove this vault first.' })}
          </Body>
        ) : (
          <>
            {host.scanQr ? (
              <Key label={frames.length === 0 ? t({ id: 'devices.move.scan', message: 'Read the moving code' }) : t({ id: 'devices.move.scan.more', message: 'Keep reading' })} kind="secondary" onPress={() => run(scanExport)} testID="vault-move-scan" />
            ) : (
              <Input value={movePasted} onChange={setMovePasted} multiline placeholder={t({ id: 'devices.move.paste', message: 'Paste every frame, separated by spaces' })} testID="vault-move-paste" />
            )}
            {moveProgress.total > 0 ? (
              <Body tone={moveReady ? 'arc' : 'mute'} size="caption" testID="vault-move-progress">
                {t({ id: 'devices.move.frames', message: '{seen} of {total} frames read.', values: { seen: moveProgress.seen, total: moveProgress.total } })}
              </Body>
            ) : null}
            <Input value={code} onChange={setCode} autoCapitalize="none" placeholder={t({ id: 'devices.move.code', message: 'The six words from the other device' })} testID="vault-move-code" />
            <Input value={movePassword} onChange={setMovePassword} secure placeholder={t({ id: 'devices.move.password', message: 'A password for this device' })} testID="vault-move-password" />
            <Key
              label={t({ id: 'devices.move.go', message: 'Bring the vault here' })}
              disabled={!moveReady || code.trim().split(/\s+/).filter(Boolean).length < 6 || !movePassword}
              onPress={() => run(async () => {
                const r = await engine.vault.importExport({ frames: moveFrames, code: code.trim(), password: movePassword })
                setFrames([])
                setMovePasted('')
                setCode('')
                setMovePassword('')
                setNote(t({ id: 'devices.move.done', message: 'The vault is here — {n} accounts. Delete the export on the other device when you are sure.', values: { n: r.accounts.length } }))
              })}
              testID="vault-move-go"
            />
          </>
        )}
      </Plate>

      {error ? <Body tone="burn">{error}</Body> : null}
      {note ? <Body tone="arc">{note}</Body> : null}
    </ScrollView>
  )
}
