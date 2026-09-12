/**
 * The forced-update interstitial (master plan §3.7, ES-BV-007).
 *
 * When the signed flags name a minimum version newer than this body, the
 * wallet stops doing the things that need current code — quoting, routing,
 * signing — and says so. It does NOT stop the user reaching their own
 * recovery material.
 *
 * It used to: a non-dismissible overlay mounted last in the shell, over every
 * screen, with one key on it. So an operational mistake — `minVersion:
 * "9.0.0"` published by accident, or a misused signing key — locked every
 * install out of Backup, Reveal and Export until a corrected file with a newer
 * `issuedAt` was published and fetched, and an offline device stayed locked
 * out indefinitely. A non-custodial wallet must never put the user's recovery
 * phrase behind a remote switch; the flags may disable features, and this is a
 * feature gate, not a door.
 *
 * `blocked` is what the shell reads to decide which screens get the plate.
 */
import { Body, Column, Key, Plate, Row } from '@boltvault/ui'
import type { FlagsView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
// The blocked set lives in its own module so it can be read without pulling
// React Native in behind it (ES-BV-007).
export { isBlockedByUpdate } from '../updateGate'

export function useUpdateRequired(): boolean {
  const engine = useEngine()
  const [flags, setFlags] = useState<FlagsView | null>(null)
  useEffect(() => {
    engine.flags.get().then(setFlags, () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'flags.changed') setFlags(e.flags)
    })
  }, [engine])
  return flags?.updateRequired === true
}

/** The plate itself, rendered in place of a blocked screen's content. */
export function UpdateRequired() {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const [flags, setFlags] = useState<FlagsView | null>(null)
  useEffect(() => {
    engine.flags.get().then(setFlags, () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'flags.changed') setFlags(e.flags)
    })
  }, [engine])
  if (!flags?.updateRequired) return null
  const store =
    host.body === 'mobile'
      ? 'https://wallet.electroswap.io/get'
      : 'https://wallet.electroswap.io/get#extension'
  return (
    <Column flex={1} justifyContent="center" padding="$5" testID="update-required">
      <Plate role="raised" gap="$3">
        <Body size="title">{t({ id: 'update.title', message: 'Update BoltVault to keep going' })}</Body>
        <Body tone="mute">
          {t({
            id: 'update.body',
            message:
              'This version ({v}) is older than the minimum ElectroSwap signed ({m}) — usually a security fix. Your vault stays where it is; the update just needs installing.',
            values: { v: host.version ?? '?', m: flags.minVersion ?? '?' },
          })}
        </Body>
        {/*
          The sentence that makes this an interstitial rather than a lock
          (ES-BV-007). Whatever a flags file says, the phrase is the user's.
        */}
        <Body tone="mute" size="caption" testID="update-recovery">
          {t({
            id: 'update.recovery',
            message: 'Settings, your recovery phrase, export and your activity are still open — nothing signed by us can take those away from you.',
          })}
        </Body>
        {/*
          …and a way to get there (ES-BV-007).

          The copy above says Settings, the recovery phrase and export are
          still open, and they are — but `home` is on the blocked set and the
          product's only navigation to Settings is the icon on Home, so on a
          phone the sentence was true and unreachable at the same time. Deep
          links do not help: they reach home, swap, explore, activity, bridge,
          receive and browser, and nothing else. A key on the plate is the
          shortest honest fix.
        */}
        <Row gap="$2" flexWrap="wrap">
          <Key label={t({ id: 'update.key', message: 'Get the update' })} onPress={() => void host.openUrl?.(store)} testID="update-key" />
          <Key
            label={t({ id: 'update.settings', message: 'Open Settings' })}
            kind="secondary"
            onPress={() => router.navigate('settings')}
            testID="update-settings"
          />
        </Row>
      </Plate>
    </Column>
  )
}
