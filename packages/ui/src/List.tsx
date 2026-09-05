/**
 * List — the one list primitive packages/wallet may use (master plan §2.2
 * item 5). Today it is react-native's FlatList (virtualised on native, DOM on
 * web through react-native-web); FlashList can replace the native side later
 * without touching a screen.
 */
export { FlatList as List, type FlatListProps as ListProps, type ListRenderItemInfo } from 'react-native'
export { Pressable, ScrollView, type ScrollViewProps, useWindowDimensions } from 'react-native'
