/**
 * An SVG we ship as source, drawn the way this body can draw it — web half.
 *
 * The browser rasterises an SVG data URI in an ordinary image, so that is what
 * it gets. This matters for size, not just taste: routing the web through
 * react-native-svg's SvgXml pulls its XML parser into the popup bundle and put
 * it 687 bytes over the 900 KB budget in e2e/gate.spec.ts. The parser is only
 * needed where Image cannot decode SVG at all, which is Android — see
 * SvgImage.native.tsx.
 */
import { Image } from 'react-native'

export interface SvgImageProps {
  /** The markup. Used by the native half. */
  readonly xml: string
  /** The same drawing as a data URI. Used here. */
  readonly uri: string
  readonly width: number
  readonly height: number
  readonly label?: string
  readonly testID?: string
}

export function SvgImage({ uri, width, height, label, testID }: SvgImageProps) {
  return (
    <Image
      source={{ uri }}
      style={{ width, height }}
      accessibilityLabel={label}
      accessibilityIgnoresInvertColors
      testID={testID}
    />
  )
}
