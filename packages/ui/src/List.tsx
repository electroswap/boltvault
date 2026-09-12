/**
 * List — the one list primitive packages/wallet may use (master plan §2.2
 * item 5). Today it is react-native's FlatList (virtualised on native, DOM on
 * web through react-native-web); FlashList can replace the native side later
 * without touching a screen.
 *
 * Taps on a Back control (or any other pressable) must reach the child even
 * when the keyboard is up. Without `keyboardShouldPersistTaps`, the first
 * tap only dismisses the keyboard and the user has to press again.
 */
import { forwardRef } from 'react'
import { ScrollView as RNScrollView, type ScrollViewProps } from 'react-native'

export { FlatList as List, type FlatListProps as ListProps, type ListRenderItemInfo } from 'react-native'
export { Pressable, useWindowDimensions } from 'react-native'
export type { ScrollViewProps } from 'react-native'

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(function ScrollView(
  { keyboardShouldPersistTaps = 'handled', ...rest },
  ref,
) {
  return <RNScrollView ref={ref} keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...rest} />
})
