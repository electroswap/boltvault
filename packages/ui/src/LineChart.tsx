/**
 * LineChart — a price series as one smooth path with the current, a
 * gradient area beneath it, a dashed baseline at the open and a lit end
 * dot (plan B1). react-native-svg, so the same file draws on the phone and
 * in the extension. A flat or single-point series draws a mute dashed line.
 */
import { useId } from 'react'
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg'
import { current, light, paint } from './tokens'

export interface ChartPoint {
  readonly t: number
  readonly v: number
}

export interface LineChartProps {
  /** Oldest first. */
  readonly points: ReadonlyArray<ChartPoint>
  readonly width: number
  readonly height: number
  readonly stroke?: 'current' | 'surge' | 'burn' | 'mute'
  /** A vertical gradient under the line, from the stroke colour to nothing. */
  readonly area?: boolean
  /** A dashed hairline at this value (the period's open). */
  readonly baseline?: number | null
  readonly endDot?: boolean
  readonly reducedMotion?: boolean
  readonly testID?: string
}

const PAD = 6

/** Catmull-Rom through the points, emitted as cubic Béziers. */
export function smoothPath(xs: readonly number[], ys: readonly number[]): string {
  if (xs.length === 0) return ''
  if (xs.length === 1) return `M${xs[0]} ${ys[0]}`
  let d = `M${xs[0]?.toFixed(2)} ${ys[0]?.toFixed(2)}`
  for (let i = 0; i < xs.length - 1; i++) {
    const p0x = xs[i - 1] ?? xs[i] ?? 0
    const p0y = ys[i - 1] ?? ys[i] ?? 0
    const p1x = xs[i] ?? 0
    const p1y = ys[i] ?? 0
    const p2x = xs[i + 1] ?? 0
    const p2y = ys[i + 1] ?? 0
    const p3x = xs[i + 2] ?? p2x
    const p3y = ys[i + 2] ?? p2y
    const c1x = p1x + (p2x - p0x) / 6
    const c1y = p1y + (p2y - p0y) / 6
    const c2x = p2x - (p3x - p1x) / 6
    const c2y = p2y - (p3y - p1y) / 6
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2x.toFixed(2)} ${p2y.toFixed(2)}`
  }
  return d
}

export function LineChart({
  points,
  width,
  height,
  stroke = 'current',
  area = true,
  baseline = null,
  endDot = true,
  testID,
}: LineChartProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const vs = points.map((p) => p.v).filter((v) => Number.isFinite(v))
  const min = Math.min(...vs, baseline ?? Infinity)
  const max = Math.max(...vs, baseline ?? -Infinity)
  const flat =
    points.length < 2 || !Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-12
  const solid =
    stroke === 'surge'
      ? paint.surge
      : stroke === 'burn'
        ? paint.burn
        : stroke === 'mute'
          ? paint.mute
          : null
  const strokePaint = solid ?? `url(#${id}-line)`
  if (flat) {
    return (
      <Svg width={width} height={height} testID={testID} aria-hidden>
        <Line
          x1={PAD}
          y1={height / 2}
          x2={width - PAD}
          y2={height / 2}
          stroke={paint.mute}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          strokeOpacity={0.6}
        />
      </Svg>
    )
  }
  const xs = points.map((_, i) => PAD + (i * (width - PAD * 2)) / (points.length - 1))
  const y = (v: number): number => height - PAD - ((v - min) / (max - min)) * (height - PAD * 2)
  const ys = points.map((p) => y(p.v))
  const line = smoothPath(xs, ys)
  const areaPath = `${line} L${(xs[xs.length - 1] ?? 0).toFixed(2)} ${height} L${(xs[0] ?? 0).toFixed(2)} ${height} Z`
  const lastX = xs[xs.length - 1] ?? 0
  const lastY = ys[ys.length - 1] ?? 0
  const areaColor = solid ?? current.from
  return (
    <Svg width={width} height={height} testID={testID} aria-hidden>
      <Defs>
        <LinearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={current.from} />
          <Stop offset="1" stopColor={current.to} />
        </LinearGradient>
        <LinearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={areaColor} stopOpacity={0.28} />
          <Stop offset="1" stopColor={areaColor} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {area ? <Path d={areaPath} fill={`url(#${id}-area)`} /> : null}
      {baseline !== null && Number.isFinite(baseline) ? (
        <Line
          x1={PAD}
          y1={y(baseline)}
          x2={width - PAD}
          y2={y(baseline)}
          stroke={paint.mute}
          strokeWidth={1}
          strokeDasharray="3 4"
          strokeOpacity={0.5}
        />
      ) : null}
      <Path
        d={line}
        fill="none"
        stroke={strokePaint}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {endDot ? (
        <>
          <Circle cx={lastX} cy={lastY} r={8} fill={solid ?? current.to} fillOpacity={0.18} />
          <Circle cx={lastX} cy={lastY} r={3} fill={light.core} />
        </>
      ) : null}
    </Svg>
  )
}

/** A 64×20 line for list rows. */
export function Sparkline({
  points,
  stroke,
  testID,
}: {
  points: ReadonlyArray<ChartPoint>
  stroke?: LineChartProps['stroke']
  testID?: string
}) {
  return (
    <LineChart
      points={points}
      width={64}
      height={20}
      area={false}
      endDot={false}
      {...(stroke ? { stroke } : {})}
      {...(testID ? { testID } : {})}
    />
  )
}
