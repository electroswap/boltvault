// @boltvault/design — the SVG line icon set.
//
// Why inline SVG (not an icon font / image files): MV3 CSP + the self-host
// rule mean no external icon requests, and `stroke:currentColor` lets every
// icon inherit ink/arc/burn from its parent text color. Uniform signature:
// every icon is `(p: IconProps) => JSX` over the shared <Svg> wrapper, so any
// icon is swappable. 24x24 viewBox, 2px stroke, round caps/joins (Feather-style).
import type { ReactNode, SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconHome = (p: IconProps) => (
  <Svg {...p}><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /></Svg>
)
export const IconSwap = (p: IconProps) => (
  <Svg {...p}><path d="M7 4v13" /><path d="m4 8 3-4 3 4" /><path d="M17 20V7" /><path d="m14 16 3 4 3-4" /></Svg>
)
export const IconActivity = (p: IconProps) => (
  <Svg {...p}><path d="M3 12h4l3 8 4-16 3 8h4" /></Svg>
)
export const IconSettings = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></Svg>
)
export const IconSend = (p: IconProps) => (
  <Svg {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></Svg>
)
export const IconReceive = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M20 20v.01" /></Svg>
)
export const IconScan = (p: IconProps) => <IconReceive {...p} />
export const IconToken = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h4M9.5 14.5h4" /></Svg>
)
export const IconChevronDown = (p: IconProps) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
export const IconChevronRight = (p: IconProps) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>
export const IconArrowRight = (p: IconProps) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
export const IconArrowLeft = (p: IconProps) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
export const IconBolt = (p: IconProps) => (
  <Svg {...p}><path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor" stroke="none" /></Svg>
)
export const IconPlus = (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
export const IconMinus = (p: IconProps) => <Svg {...p}><path d="M5 12h14" /></Svg>
export const IconX = (p: IconProps) => <Svg {...p}><path d="M6 6 18 18M18 6 6 18" /></Svg>
export const IconWallet = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M16 12h.01M3 10h18" /></Svg>
)
export const IconShield = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6z" /></Svg>
)
export const IconClock = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
)
export const IconLayers = (p: IconProps) => (
  <Svg {...p}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></Svg>
)
export const IconFlask = (p: IconProps) => (
  <Svg {...p}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /></Svg>
)
export const IconRocket = (p: IconProps) => (
  <Svg {...p}><path d="M5 15c-1 3-1 4-1 4s1 0 4-1" /><path d="M9 12a9 9 0 0 1 8-7c2 0 3 1 3 3a9 9 0 0 1-7 8" /><circle cx="14" cy="10" r="1.5" /></Svg>
)
export const IconCable = (p: IconProps) => (
  <Svg {...p}><path d="M6 8a4 4 0 0 1 4 4v4a4 4 0 0 0 4 4M18 16a4 4 0 0 1-4-4V8a4 4 0 0 0-4-4" /><circle cx="6" cy="8" r="1" /><circle cx="18" cy="16" r="1" /></Svg>
)
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m5 13 4 4L19 7" /></Svg>
export const IconAlert = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></Svg>
)
export const IconEye = (p: IconProps) => (
  <Svg {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>
)
export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A9.5 9.5 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.1A17 17 0 0 0 2 12s4 7 10 7" /></Svg>
)
export const IconKey = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12 20 3M17 6l3 3M14 9l2 2" /></Svg>
)
export const IconPlug = (p: IconProps) => (
  <Svg {...p}><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6" /></Svg>
)
export const IconBook = (p: IconProps) => (
  <Svg {...p}><path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z" /><path d="M4 18h12" /></Svg>
)
export const IconNetwork = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></Svg>
)
export const IconPalette = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="8" cy="9" r="1" /><circle cx="15" cy="9" r="1" /><circle cx="15" cy="15" r="1" /></Svg>
)
export const IconInfo = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>
)
export const IconHeart = (p: IconProps) => (
  <Svg {...p}><path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20z" /></Svg>
)
export const IconRefresh = (p: IconProps) => (
  <Svg {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></Svg>
)
export const IconCopy = (p: IconProps) => (
  <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg>
)
export const IconQr = (p: IconProps) => <IconReceive {...p} />

/** The full set (useful for exhaustiveness checks and the icon test). */
export const allIcons = {
  IconHome, IconSwap, IconActivity, IconSettings, IconSend, IconReceive, IconScan,
  IconToken, IconChevronDown, IconChevronRight, IconArrowRight, IconArrowLeft,
  IconBolt, IconPlus, IconMinus, IconX, IconWallet, IconShield, IconClock,
  IconLayers, IconFlask, IconRocket, IconCable, IconCheck, IconAlert, IconEye,
  IconEyeOff, IconKey, IconPlug, IconBook, IconNetwork, IconPalette, IconInfo,
  IconHeart, IconRefresh, IconCopy, IconQr,
} as const
