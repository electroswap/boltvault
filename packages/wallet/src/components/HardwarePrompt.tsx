/**
 * The device round trips that happen after Sign (master plan §2.7 S7, §6):
 * a Keystone request is an animated QR to show and an answer to scan; a
 * remote sign is a wait for the paired device that holds the key. Mounted
 * once per body, fed by engine events, so it works whatever screen started
 * the signature.
 */
import { AnimatedQR, Body, Column, Input, Key, Plate, Row, Sheet, paint } from '@boltvault/ui'
import type { KeystonePending, RemoteRequest } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useReducedMotion } from '../state/useReducedMotion'

/** True once the scanned parts can complete a UR: a single-part code, or every index of `i-N` seen. */
export function urPartsDone(parts: readonly string[]): boolean {
  if (parts.length === 0) return false
  const seq = /^ur:[a-z0-9-]+\/(\d+)-(\d+)\//i
  const total = new Set<number>()
  let expected = 0
  for (const p of parts) {
    const m = seq.exec(p.trim())
    if (!m) return true
    expected = Number(m[2])
    total.add(Number(m[1]))
  }
  return expected > 0 && total.size >= expected
}

export function HardwarePrompt({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const reducedMotion = useReducedMotion()
  const [pending, setPending] = useState<KeystonePending[]>([])
  const [outgoing, setOutgoing] = useState<RemoteRequest[]>([])
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    engine.hardware.keystonePending().then(setPending, () => undefined)
    engine.remote.list().then((r) => setOutgoing(r.outgoing), () => undefined)
  }, [engine])
  useEngineEvent(
    'hardware.keystone',
    useCallback((e: { pending: KeystonePending[] }) => setPending(e.pending), []),
  )
  useEngineEvent(
    'remote.changed',
    useCallback((e: { outgoing: RemoteRequest[] }) => setOutgoing(e.outgoing), []),
  )

  const current = pending[0] ?? null
  const waiting = outgoing.find((o) => o.state === 'waiting') ?? null
  if (!current && !waiting) return null

  const submit = async (parts: string[]): Promise<void> => {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      await engine.hardware.keystoneSubmit({ id: current.id, parts })
      setPasted('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const scan = async (): Promise<void> => {
    if (!host.scanQr) return
    const parts: string[] = []
    try {
      await host.scanQr((text) => {
        parts.push(text)
        return urPartsDone(parts)
      })
      await submit(parts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const kindLabel = (k: KeystonePending['kind']): string => (k === 'transaction' || k === 'typed_transaction' ? t({ id: 'keystone.kind.tx', message: 'a transaction' }) : k === 'personal_message' ? t({ id: 'keystone.kind.msg', message: 'a message' }) : t({ id: 'keystone.kind.typed', message: 'typed data' }))

  return (
    <Sheet open onClose={() => (current ? void engine.hardware.keystoneCancel({ id: current.id }) : waiting ? void engine.remote.cancel({ id: waiting.id }) : undefined)} title={current ? t({ id: 'keystone.title', message: 'Sign on your Keystone' }) : t({ id: 'remote.title', message: 'Sign on another device' })} reducedMotion={reducedMotion} testID="hardware-prompt">
      {current ? (
        <Column gap="$3" alignItems="stretch">
          <Body tone="mute" size="caption">
            {t({ id: 'keystone.body', message: 'Scan this with the Keystone, check {what} on its screen, then scan its answer here.', values: { what: kindLabel(current.kind) } })}
          </Body>
          <Column alignItems="center">
            <AnimatedQR frames={current.frames} size={body === 'extension-popup' ? 220 : 280} testID="keystone-frames" />
          </Column>
          <Row gap="$2" flexWrap="wrap">
            {host.scanQr ? <Key label={t({ id: 'keystone.scan', message: 'Scan the answer' })} disabled={busy} onPress={() => void scan()} testID="keystone-scan" /> : null}
            <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" disabled={busy} onPress={() => void engine.hardware.keystoneCancel({ id: current.id })} testID="keystone-cancel" />
          </Row>
          <Plate gap="$2">
            <Body tone="mute" size="caption">
              {t({ id: 'keystone.paste', message: 'No camera here? Paste the UR text of the answer.' })}
            </Body>
            <Input value={pasted} onChange={setPasted} mono placeholder="UR:ETH-SIGNATURE/…" testID="keystone-paste" />
            <Key label={t({ id: 'keystone.use', message: 'Use answer' })} kind="secondary" disabled={busy || !pasted.trim()} onPress={() => void submit(pasted.split(/\s+/).filter(Boolean))} testID="keystone-use" />
          </Plate>
          {error ? (
            <Body tone="burn" size="caption" testID="keystone-error">
              {error}
            </Body>
          ) : null}
        </Column>
      ) : waiting ? (
        <Column gap="$3">
          <Body tone="mute" size="caption">
            {t({ id: 'remote.body', message: 'This account signs on a paired device. Open BoltVault there — the request appears as a signing sheet with everything it is about to sign.' })}
          </Body>
          <Plate gap={2} testID="remote-waiting">
            <Body>{waiting.kind === 'transaction' ? t({ id: 'remote.kind.tx', message: 'Waiting for the transaction to be signed' }) : waiting.kind === 'message' ? t({ id: 'remote.kind.msg', message: 'Waiting for the message to be signed' }) : t({ id: 'remote.kind.typed', message: 'Waiting for the typed data to be signed' })}</Body>
            <Body tone="mute" size="caption" color={paint.mute}>
              {t({ id: 'remote.timeout', message: 'Gives up after ten minutes.' })}
            </Body>
          </Plate>
          <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" onPress={() => void engine.remote.cancel({ id: waiting.id })} testID="remote-cancel" />
        </Column>
      ) : null}
    </Sheet>
  )
}
