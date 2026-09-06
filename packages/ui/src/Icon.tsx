/**
 * The icon set — one stroke language (1.75 px, round joins, 24-unit grid),
 * drawn with react-native-svg so the same file renders on native and web.
 * Icons are marks, never decoration; each exists because a surface needs it.
 */
import Svg, { Circle, Path } from 'react-native-svg'
import { paint } from './tokens'

const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  swap: 'M7 4v13M7 4 3.5 7.5M7 4l3.5 3.5M17 20V7m0 13 3.5-3.5M17 20l-3.5-3.5',
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z',
  activity: 'M3 12h4l2.5-6 4 12L16 12h5',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  send: 'M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z',
  receive: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 17v3h-3',
  bridge: 'M2 17c2-6 6-9 10-9s8 3 10 9M6 17v-4M12 17V8M18 17v-4M2 17h20',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  back: 'M20 12H4m0 0 6-6m-6 6 6 6',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  check: 'm5 12.5 4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6 6 18',
  warn: 'M12 9v4m0 4h.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zm2 0V7a4 4 0 1 1 8 0v4',
  unlock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zm2 0V7a4 4 0 0 1 7.5-2',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.7 8.6 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  arrowUpRight: 'M7 17 17 7m0 0H9m8 0v8',
  arrowDownLeft: 'M17 7 7 17m0 0h8m-8 0V9',
  bolt: 'M13 2 4.5 13.5H11L10 22l8.5-11.5H13z',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5-5',
  star: 'm12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.3L12 17.5l-5.6 2.9 1.1-6.3L3 9.7l6.2-.9z',
  bell: 'M6 8a6 6 0 1 1 12 0v5l2 3H4l2-3zM10 20a2 2 0 0 0 4 0',
  farm: 'M12 21v-9M12 12c0-4 3-7 8-7 0 4-3 7-8 7zM12 15c0-3-2.5-5-6-5 0 3 2.5 5 6 5zM5 21h14',
  launch: 'M12 15c-3-3-3-8 2-12 5 4 5 9 2 12zM12 15v6M9 13H6l2-4M15 13h3l-2-4M12 8h.01',
  nft: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 16l4-4 4 4 3-3 5 5M15 9h.01',
  approvals: 'M9 11h6M9 15h4M5 5h14a1 1 0 0 1 1 1v14l-3-2-3 2-3-2-3 2-3-2-3 2V6a1 1 0 0 1 1-1z',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  hardware: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm5 14h.01M9 7h6',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  refresh: 'M20 12a8 8 0 0 1-14.6 4.5M4 12a8 8 0 0 1 14.6-4.5M18 4v4h-4M6 20v-4h4',
  expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronUp: 'm6 15 6-6 6 6',
  pin: 'M12 16v5M8 4h8l-1 5 3 3H6l3-3z',
  chart: 'M3 17l5-6 4 3 5-7 4 4',
  coins: 'M8 8a6 2.5 0 1 0 12 0 6 2.5 0 1 0-12 0zM8 8v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V8M4 12a6 2.5 0 0 0 0 5M4 12v4c0 1.4 2.7 2.5 6 2.5 1 0 2-.1 2.8-.3',
  tune: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5v4M7 15v4',
  link: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-9v5m0-9h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M4 20h4L18 10l-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  sort: 'M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M4 6h16M4 12h16M4 18h16',
  share: 'M12 3v12m0-12L8 7m4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  key: 'M15 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM10.5 12.5 3 20l2 2 2-2-1-1 2-2-1-1 2.5-2.5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  x: 'M5 4l14 16M19 4 5 20',
  telegram: 'M21 4 3 11l6 2 2 6 3-4 5 3z',
  discord: 'M8 5c1.3-.5 2.6-.8 4-.8s2.7.3 4 .8l3 8-3 5-2-2H10l-2 2-3-5zM9.5 12h.01M14.5 12h.01',
} as const

export type IconName = keyof typeof PATHS

export interface IconProps {
  readonly name: IconName
  readonly size?: number
  readonly color?: string
  /** 1.75 by default; a tile's glyph reads better at 2. */
  readonly strokeWidth?: number
  readonly testID?: string
}

export function Icon({ name, size = 22, color = paint.ink, strokeWidth = 1.75, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Path d={PATHS[name]} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** A filled dot, for status marks (live, pending, danger). */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8">
      <Circle cx={4} cy={4} r={4} fill={color} />
    </Svg>
  )
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[]
