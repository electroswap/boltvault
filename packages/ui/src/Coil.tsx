/**
 * The Coil (master plan §7.6, §8.8): the farm multiplier gauge. Outer ring =
 * the duration multiplier's travel from 1.0× to 2.5× over a year of blocks,
 * with the dates to 2.0× and 2.5× engraved on it; inner ring = the BOLT
 * stair (1.00 / 1.05 / 1.15). The glow is proportional to pending rewards,
 * so a coil with DYNO waiting visibly hums. It never twitches per block —
 * the ring moves about a pixel a week.
 */
import Svg, { Circle, Defs, RadialGradient, Stop, Text as SvgText } from 'react-native-svg'
import { Column } from './primitives'
import { fonts, light, paint } from './tokens'

export interface CoilProps {
  /** 10000..25000 */
  readonly durationMultiplier: number
  /** 10000 | 10500 | 11500 */
  readonly boltMultiplier: number
  /** 0..1 — pending rewards relative to a "full" coil (the screen decides the scale). */
  readonly glow: number
  readonly size?: number
  /** Short labels engraved at 2.0× and 2.5× ("12 Mar", "9 Sep"); null when reached. */
  readonly at2x?: string | null
  readonly at25x?: string | null
  readonly reducedMotion?: boolean
  readonly testID?: string
}

const TAU = Math.PI * 2

function arcLength(r: number, fraction: number): number {
  return TAU * r * Math.max(0, Math.min(1, fraction))
}

export function Coil({
  durationMultiplier,
  boltMultiplier,
  glow,
  size = 200,
  at2x = null,
  at25x = null,
  testID,
}: CoilProps) {
  const cx = size / 2
  const cy = size / 2
  const outerR = size * 0.42
  const innerR = size * 0.3
  const travel = Math.max(0, Math.min(1, (durationMultiplier - 10_000) / 15_000))
  const stair = boltMultiplier >= 11_500 ? 1 : boltMultiplier >= 10_500 ? 0.5 : 0
  const glowAlpha = 0.12 + 0.55 * Math.max(0, Math.min(1, glow))
  const outerC = TAU * outerR
  const innerC = TAU * innerR
  // Ticks at 2.0× (2/3 of the travel) and 2.5× (the end).
  const tick = (fraction: number): { x: number; y: number } => {
    const a = -Math.PI / 2 + TAU * fraction
    return { x: cx + Math.cos(a) * (outerR + 14), y: cy + Math.sin(a) * (outerR + 14) }
  }
  const t2 = tick(2 / 3)
  const t25 = tick(1)
  const multiplierText = `${(durationMultiplier / 10_000).toFixed(2)}×`
  return (
    <Column alignItems="center" justifyContent="center" testID={testID}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient id="coilGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={light.plasma} stopOpacity={glowAlpha} />
            <Stop offset="70%" stopColor={light.plasma} stopOpacity={glowAlpha * 0.35} />
            <Stop offset="100%" stopColor={light.plasma} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={outerR + 10} fill="url(#coilGlow)" />
        {/* Outer ring: track then the duration travel. */}
        <Circle
          cx={cx}
          cy={cy}
          r={outerR}
          stroke="rgba(95,216,255,0.14)"
          strokeWidth={6}
          fill="none"
        />
        <Circle
          cx={cx}
          cy={cy}
          r={outerR}
          stroke={light.arc}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${arcLength(outerR, travel)} ${outerC}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {/* Engraved marks at 2.0× and 2.5×. */}
        <Circle cx={t2.x} cy={t2.y} r={2.2} fill={travel >= 2 / 3 ? light.arc : paint.mute} />
        <Circle cx={t25.x} cy={t25.y} r={2.2} fill={travel >= 1 ? light.arc : paint.mute} />
        {/* Inner ring: the BOLT stair, three steps. */}
        <Circle
          cx={cx}
          cy={cy}
          r={innerR}
          stroke="rgba(167,139,255,0.16)"
          strokeWidth={4}
          fill="none"
        />
        <Circle
          cx={cx}
          cy={cy}
          r={innerR}
          stroke={light.plasma}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${arcLength(innerR, stair)} ${innerC}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <SvgText
          x={cx}
          y={cy + 8}
          fill={paint.ink}
          fontSize={size * 0.16}
          fontWeight="600"
          textAnchor="middle"
          fontFamily={fonts.readout}
        >
          {multiplierText}
        </SvgText>
        <SvgText
          x={cx}
          y={cy + 8 + size * 0.11}
          fill={paint.mute}
          fontSize={size * 0.06}
          textAnchor="middle"
          fontFamily={fonts.text}
        >
          {`BOLT ${(boltMultiplier / 10_000).toFixed(2)}×`}
        </SvgText>
        {at2x ? (
          <SvgText
            x={t2.x + 6}
            y={t2.y + 4}
            fill={paint.mute}
            fontSize={size * 0.05}
            textAnchor="start"
            fontFamily={fonts.text}
          >
            {`2.0× ${at2x}`}
          </SvgText>
        ) : null}
        {/*
          The 2.5× engraving sits INSIDE the ring, not above its tick.

          The tick for 2.5× is at the top of the travel, `outerR + 14` from the
          centre — two pixels short of the viewBox at the default size — so a
          label drawn above it was painted outside the canvas and simply never
          appeared. The one number §7.12 says must be readable at a glance was
          the one number that could not be read. Inside the ring it is on the
          same face as the multiplier, with room at every size.
        */}
        {at25x ? (
          <SvgText
            x={cx}
            y={cy - outerR + size * 0.085}
            fill={paint.mute}
            fontSize={size * 0.05}
            textAnchor="middle"
            fontFamily={fonts.text}
          >
            {`2.5× ${at25x}`}
          </SvgText>
        ) : null}
      </Svg>
    </Column>
  )
}
