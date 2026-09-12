/**
 * QR — a real, scannable code (error correction M) drawn with react-native-svg
 * on both bodies, styled as etched glass: light modules on the void, a soft
 * highlight sweep. Gyroscope parallax on mobile lands with the Receive surface.
 */
import { create as createQr } from 'qrcode'
import { useMemo } from 'react'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { light, paint } from './tokens'

export interface QRProps {
  readonly value: string
  readonly size?: number
  readonly testID?: string
}

export function qrMatrix(value: string): { size: number; cells: Uint8Array } {
  const code = createQr(value, { errorCorrectionLevel: 'M' })
  return { size: code.modules.size, cells: code.modules.data }
}

export function QR({ value, size = 200, testID }: QRProps) {
  const { size: n, cells } = useMemo(() => qrMatrix(value), [value])
  const quiet = 2
  const total = n + quiet * 2
  const cell = size / total
  const rects: Array<{ x: number; y: number }> = []
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (cells[y * n + x]) rects.push({ x: (x + quiet) * cell, y: (y + quiet) * cell })
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      testID={testID}
      accessibilityLabel="QR code"
    >
      <Defs>
        <LinearGradient id="qr-etch" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={light.core} />
          <Stop offset="0.55" stopColor={paint.ink} />
          <Stop offset="1" stopColor={light.arc} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={size} height={size} rx={12} fill={paint.void} />
      {rects.map((r, i) => (
        <Rect key={i} x={r.x} y={r.y} width={cell} height={cell} fill="url(#qr-etch)" />
      ))}
    </Svg>
  )
}
