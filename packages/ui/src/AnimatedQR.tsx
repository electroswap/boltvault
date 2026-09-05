/**
 * AnimatedQR — cycles through frames (air-gapped vault export, §6). A
 * single-frame payload renders as a plain QR.
 */
import { useEffect, useState } from 'react'
import { Body, Column } from './primitives'
import { QR } from './QR'

export interface AnimatedQRProps {
  readonly frames: readonly string[]
  readonly size?: number
  readonly intervalMs?: number
  readonly testID?: string
}

export function AnimatedQR({ frames, size = 240, intervalMs = 450, testID }: AnimatedQRProps) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (frames.length <= 1) return
    const id = setInterval(() => setI((n) => (n + 1) % frames.length), intervalMs)
    return () => clearInterval(id)
  }, [frames.length, intervalMs])
  const frame = frames[i] ?? ''
  return (
    <Column alignItems="center" gap="$2" testID={testID}>
      <QR value={frame} size={size} />
      {frames.length > 1 ? (
        <Body tone="mute" size="caption">
          {i + 1} / {frames.length}
        </Body>
      ) : null}
    </Column>
  )
}
