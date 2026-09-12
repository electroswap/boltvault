/**
 * ChainMark — a two-colour monogram per chain, authored in-repo (no remote
 * fetch, no brand files): the Home chain selector, the Bridge, Networks,
 * the Token page's chain chip. An unknown chain is a lettered ring.
 */
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg'
import { fonts, paint } from './tokens'

export interface ChainMarkProps {
  readonly chainId: number
  readonly size?: number
  readonly ring?: boolean
  readonly testID?: string
}

interface Mark {
  readonly bg: string
  readonly fg: string
  readonly glyph?: string
  readonly letter?: string
  readonly dashed?: boolean
}

/** Glyphs on a 24-unit grid, drawn as fills. */
export const CHAIN_MARKS: Readonly<Record<number, Mark>> = {
  52014: { bg: '#141A48', fg: '#4FC3FF', glyph: 'M13 3 5.5 13.5H11L10 21l8.5-11.5H13z' },
  5201420: {
    bg: '#141A48',
    fg: '#4FC3FF',
    glyph: 'M13 3 5.5 13.5H11L10 21l8.5-11.5H13z',
    dashed: true,
  },
  1: {
    bg: '#627EEA',
    fg: '#FFFFFF',
    glyph: 'M12 3 6.5 12.2 12 15.4l5.5-3.2zM6.5 13.4 12 21l5.5-7.6L12 16.6z',
  },
  8453: {
    bg: '#0052FF',
    fg: '#FFFFFF',
    glyph: 'M12 4.5a7.5 7.5 0 1 1-7.4 8.6h7.2v-2.2H4.6A7.5 7.5 0 0 1 12 4.5z',
  },
  56: {
    bg: '#F3BA2F',
    fg: '#1E2026',
    glyph:
      'M12 4l2.6 2.6L12 9.2 9.4 6.6zM6.6 9.4 9.2 12l-2.6 2.6L4 12zM17.4 9.4 20 12l-2.6 2.6L14.8 12zM12 14.8l2.6 2.6L12 20l-2.6-2.6zM12 9.4l2.6 2.6L12 14.6 9.4 12z',
  },
  43114: {
    bg: '#E84142',
    fg: '#FFFFFF',
    glyph: 'M11 5 4 17h4.2l4.3-7.3L10.7 6.7zM13.6 12 10.6 17h9.2l-2.4-4.2z',
  },
  42161: {
    bg: '#213147',
    fg: '#12AAFF',
    glyph:
      'M12 3.5 5 7.5v9l7 4 7-4v-9zm0 2.3 4.8 2.8v6.2L12 17.6 7.2 14.8V8.6zM10.5 9l3.2 6.4h1.8L12.3 9z',
  },
  10: { bg: '#FF0420', fg: '#FFFFFF', letter: 'OP' },
  137: {
    bg: '#8247E5',
    fg: '#FFFFFF',
    glyph:
      'M8 8.5 4.5 10.5v4.6L8 17l3.5-1.9v-2.3L8 14.7l-1.7-.9v-2.2L8 10.7l1.7.9V9.5zM16 7l-3.5 1.9v2.3l3.5-1.9 1.7.9v2.2L16 13.3l-1.7-.9v2.1L16 16.4l3.5-2V9.9z',
  },
  130: { bg: '#F50DB4', fg: '#FFFFFF', letter: 'U' },
  59144: { bg: '#121212', fg: '#FFFFFF', letter: 'L' },
}

export function ChainMark({ chainId, size = 20, ring = false, testID }: ChainMarkProps) {
  const m = CHAIN_MARKS[chainId]
  const bg = m?.bg ?? paint.glassRaisedSolid
  const fg = m?.fg ?? paint.mute
  const letter = m ? m.letter : String(chainId).charAt(0)
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" testID={testID}>
      <Circle cx={12} cy={12} r={12} fill={bg} />
      {m?.glyph ? <Path d={m.glyph} fill={fg} /> : null}
      {letter ? (
        <SvgText
          x={12}
          y={letter.length > 1 ? 15.5 : 16.5}
          fontSize={letter.length > 1 ? 9 : 12}
          fontWeight="700"
          fontFamily={fonts.text}
          fill={fg}
          textAnchor="middle"
        >
          {letter}
        </SvgText>
      ) : null}
      {m?.dashed ? (
        <Circle
          cx={12}
          cy={12}
          r={11}
          stroke={paint.mute}
          strokeWidth={1.5}
          strokeDasharray="3 2"
          fill="none"
        />
      ) : null}
      {ring ? (
        <Circle cx={12} cy={12} r={11.25} stroke={paint.void} strokeWidth={1.5} fill="none" />
      ) : null}
    </Svg>
  )
}
