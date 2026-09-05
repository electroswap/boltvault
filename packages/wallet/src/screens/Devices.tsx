/** Settings › Devices & sync (master plan §6): pair, confirm the code, push/pull. */
import { Body, Column, Icon, Input, Key, Plate, QR, Readout, Row, ScrollView, metrics, paint } from '@boltvault/ui'
import type { SyncStatus } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

export function Devices({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [mode, setMode] = useState<'idle' | 'offer' | 'answer'>('idle')
  const [offer, setOffer] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.sync.status().then(setStatus, () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'sync.changed') setStatus(e.status)
    })
  }, [engine])

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

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 16 }} testID="devices">
      <Row justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'devices.title', message: 'Devices & sync' })}</Body>
      </Row>

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
          {t({ id: 'devices.what', message: 'Paired devices share settings, per-site chains and watch/hardware accounts. Seeds and keys never sync — move a vault with the export code in Security.' })}
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
          {!host.scanQr ? <Input value={pasted} onChange={setPasted} multiline mono placeholder={t({ id: 'devices.answer.paste', message: 'Paste the answer code' })} /> : null}
          <Key label={host.scanQr ? t({ id: 'devices.scan', message: 'Scan answer' }) : t({ id: 'devices.use', message: 'Use answer' })} onPress={() => run(async () => { await engine.sync.completeOffer({ answer: await scanOrPaste() }); setPasted('') })} testID="complete-offer" />
          <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" onPress={() => run(async () => { await engine.sync.cancelPairing(); setMode('idle'); setOffer(null) })} />
        </Plate>
      ) : null}

      {mode === 'answer' ? (
        <Plate gap="$3" testID="answer">
          <Body size="title">{t({ id: 'devices.answer.title', message: 'Scan the other device’s code' })}</Body>
          {!host.scanQr ? <Input value={pasted} onChange={setPasted} multiline mono placeholder={t({ id: 'devices.offer.paste', message: 'Paste the pairing code' })} /> : null}
          {!answer ? (
            <Key label={host.scanQr ? t({ id: 'devices.scan', message: 'Scan' }) : t({ id: 'devices.use.code', message: 'Use code' })} onPress={() => run(async () => { const r = await engine.sync.acceptOffer({ offer: await scanOrPaste() }); setAnswer(r.answer); setPasted('') })} testID="accept-offer" />
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
      {error ? <Body tone="burn">{error}</Body> : null}
      {note ? <Body tone="arc">{note}</Body> : null}
    </ScrollView>
  )
}
