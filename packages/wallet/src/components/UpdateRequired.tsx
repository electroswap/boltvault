/**
 * The forced-update plate (master plan §3.7): when the signed flags name a
 * minimum version newer than this body, the shell blocks with one message
 * and the store link. Flags can only disable; this is the one thing they
 * can insist on.
 */
import { Body, Column, Key, Plate } from '@boltvault/ui'
import type { FlagsView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'

export function UpdateRequired() {
  const engine = useEngine()
  const host = useHost()
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
    <Column
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={20}
      backgroundColor="rgba(2,3,8,0.92)"
      justifyContent="center"
      padding="$5"
      testID="update-required"
    >
      <Plate role="raised" gap="$3">
        <Body size="title">
          {t({ id: 'update.title', message: 'Update BoltVault to keep going' })}
        </Body>
        <Body tone="mute">
          {t({
            id: 'update.body',
            message:
              'This version ({v}) is older than the minimum ElectroSwap signed ({m}) — usually a security fix. Your vault stays where it is; the update just needs installing.',
            values: { v: host.version ?? '?', m: flags.minVersion ?? '?' },
          })}
        </Body>
        <Key
          label={t({ id: 'update.key', message: 'Get the update' })}
          onPress={() => void host.openUrl?.(store)}
          testID="update-key"
        />
      </Plate>
    </Column>
  )
}
