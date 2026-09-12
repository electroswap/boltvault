/**
 * TokenMark — what a token with no logo looks like.
 *
 * Owner: "I don't want to see pixel based placeholders anywhere in the app.
 * Use token symbol inside a circle instead resized to fit." This replaces the
 * 5x5 mirrored identicon that used to sit behind every TokenAvatar.
 *
 * Built the way ChainMark is: one in-repo SVG, no network, no generated
 * pattern. A glass disc, a hairline edge, the symbol in ink, sized so it fits
 * whatever the symbol happens to be. The sizing rules live in tokenLogos.ts so
 * they can be tested without a react-native environment.
 */
import Svg, { Circle, Text as SvgText } from 'react-native-svg'
import { markFontSize, markLabel } from './tokenLogos'
import { edge, fonts, paint } from './tokens'

export interface TokenMarkProps {
  readonly symbol?: string | null
  readonly size?: number
  readonly testID?: string
}

export function TokenMark({ symbol, size = 32, testID }: TokenMarkProps) {
  const label = markLabel(symbol)
  const fontSize = markFontSize(label.length)
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" testID={testID}>
      <Circle cx={12} cy={12} r={12} fill={paint.glassRaisedSolid} />
      <Circle cx={12} cy={12} r={11.5} stroke={edge} strokeWidth={1} fill="none" />
      <SvgText
        x={12}
        y={12 + fontSize * 0.35}
        fontSize={fontSize}
        fontWeight="600"
        fontFamily={fonts.text}
        fill={paint.ink}
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </Svg>
  )
}
