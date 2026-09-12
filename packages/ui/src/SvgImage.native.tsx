/**
 * An SVG we ship as source, drawn the way this body can draw it — native half.
 *
 * React Native's Image has no SVG decoder on Android: a `data:image/svg+xml`
 * URI decodes to nothing and fails silently, which is why neither the ES mark
 * nor any token logo appeared anywhere on the phone. react-native-svg parses
 * the markup instead, and it is already a dependency of ui, the mobile app and
 * the extension.
 */
import { SvgXml } from 'react-native-svg'
import type { SvgImageProps } from './SvgImage'

export function SvgImage({ xml, width, height, label, testID }: SvgImageProps) {
  return (
    <SvgXml xml={xml} width={width} height={height} accessibilityLabel={label} testID={testID} />
  )
}
