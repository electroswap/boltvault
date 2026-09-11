/**
 * Interface-first primitives (master plan §2.6, docs/design/style-bible.md).
 * `packages/wallet` composes only these; it never imports react-native.
 * Every primitive is a Tamagui styled component today; the DOM fallback
 * would implement the same props with plain React, selected by the
 * extension's Vite resolver.
 */
import { styled, Text as TText, View as TView } from '@tamagui/core'
import type { ComponentProps, ReactNode } from 'react'
import { PlateFill } from './PlateFill'
import { Rim } from './Rim'
import { current, glow, radius } from './tokens'

/** Full-bleed screen background. The Grid renders behind it. */
export const Screen = styled(TView, {
  name: 'Screen',
  flex: 1,
  backgroundColor: '$void',
})

/** Vertical stack. */
export const Column = styled(TView, {
  name: 'Column',
  flexDirection: 'column',
  position: 'relative',
})

/** Horizontal stack. */
export const Row = styled(TView, {
  name: 'Row',
  flexDirection: 'row',
  alignItems: 'center',
  position: 'relative',
})

/**
 * A glass plate. The role decides the material (style bible › materials):
 * console (a screen's one main panel: brighter rim, deeper glow), raised
 * (at most one hero plate per screen: lit rim, soft glow), card (anything
 * rendered in a list that opens something: quiet rim, no glow — so a column
 * of cards never bleeds together), tile (the Home action grid: raised fill,
 * no glow), recessed (static information: a quiet edge), well (an input or
 * a terminal inside a console: darker than its plate).
 */
const PlateFrame = styled(TView, {
  name: 'Plate',
  position: 'relative',
  /*
    A stacking context, so `PlateFill` can sit at `zIndex: -1` — above this
    frame's own flat background, below everything in it. Without one, the
    negative layer would fall through to the nearest ancestor that has a
    stacking context and paint behind that instead.
  */
  zIndex: 0,
  backgroundColor: '$glass',
  borderRadius: '$recessed',
  borderWidth: 1,
  borderColor: '$edge',
  padding: '$4',
  variants: {
    role: {
      recessed: { backgroundColor: '$glass', borderRadius: '$recessed', borderWidth: 1, borderColor: '$edge' },
      raised: { backgroundColor: '$glassRaised', borderRadius: '$raised', borderWidth: 0, shadowColor: glow.plateSoft, shadowRadius: 16, shadowOpacity: 1, shadowOffset: { width: 0, height: 4 } },
      console: { backgroundColor: '$glassRaised', borderRadius: '$console', borderWidth: 0, shadowColor: glow.plate, shadowRadius: 32, shadowOpacity: 1, shadowOffset: { width: 0, height: 10 } },
      card: { backgroundColor: '$glass', borderRadius: '$recessed', borderWidth: 0, hoverStyle: { backgroundColor: '$glassRaised' }, pressStyle: { opacity: 0.9 } },
      tile: { backgroundColor: '$glassRaised', borderRadius: '$raised', borderWidth: 0, pressStyle: { backgroundColor: '$glassRaisedSolid' } },
      // `borderRadius: radius.well`, not `'$well'`. `well` is the one name that
      // is both a colour token (paint.well) and a radius token, and the string
      // form resolved to the colour — an invalid radius, so it computed to 0.
      // That is why every amount well drew hard corners inside its rounded
      // console while every other plate nested correctly. Measured, not read:
      // e2e/radii.spec.ts.
      well: { backgroundColor: '$well', borderRadius: radius.well, borderWidth: 1, borderColor: '$edge' },
    },
  } as const,
  defaultVariants: { role: 'recessed' },
})

export type PlateRole = 'recessed' | 'raised' | 'console' | 'card' | 'tile' | 'well'
export type PlateProps = Omit<ComponentProps<typeof PlateFrame>, 'role'> & {
  readonly role?: PlateRole
  /**
   * Override the role's lit rim, 0..1.
   *
   * A recessed plate carries none, which is right for the fifth panel down a
   * settings page and wrong for a card that has to hold its own beside a
   * console. Owner, of the swap's details card: "give the details section
   * header a bit more contrast ... even just giving it the same border as the
   * swap container right above it would make it clearer." That border is the
   * console's rim, and this is how a plate borrows it.
   */
  readonly rim?: number
  readonly children?: ReactNode
}

const RIM_BY_ROLE: Record<PlateRole, number> = { recessed: 0, raised: 0.45, console: 0.7, card: 0.3, tile: 0.45, well: 0 }
const RADIUS_BY_ROLE: Record<PlateRole, number> = { recessed: radius.recessed, raised: radius.raised, console: radius.console, card: radius.recessed, tile: radius.raised, well: radius.well }

export function Plate({ role = 'recessed', rim, children, ...rest }: PlateProps) {
  const lit = rim ?? RIM_BY_ROLE[role]
  /*
    The gradient goes UNDER the children and over the frame's flat colour, which
    stays as the fallback for the frame it is painted on before layout lands.
    See `PlateFill` for why the bible treats this as a material and not a
    flourish.
  */
  return (
    <PlateFrame role={role} {...rest}>
      <PlateFill role={role} radius={RADIUS_BY_ROLE[role]} />
      {children}
      {lit > 0 ? <Rim radius={RADIUS_BY_ROLE[role]} opacity={lit} /> : null}
    </PlateFrame>
  )
}

/** Body text — Sora, sentence case. */
export const Body = styled(TText, {
  name: 'Body',
  fontFamily: '$body',
  fontSize: '$3',
  lineHeight: '$3',
  color: '$ink',
  variants: {
    tone: {
      ink: { color: '$ink' },
      mute: { color: '$mute' },
      arc: { color: '$arc' },
      plasma: { color: '$plasma' },
      surge: { color: '$surge' },
      ember: { color: '$ember' },
      burn: { color: '$burn' },
    },
    size: {
      caption: { fontSize: '$2', lineHeight: '$2' },
      body: { fontSize: '$3', lineHeight: '$3' },
      title: { fontSize: '$4', lineHeight: '$4', fontWeight: '600' },
    },
  } as const,
  defaultVariants: { tone: 'ink', size: 'body' },
})

/**
 * A readout — Oxanium ≥ 24 px, tabular numerals. The hero carries a faint
 * glow; `stat` (20 px) is the one readout size below 24 px, used only inside
 * a stat strip.
 */
export const Readout = styled(TText, {
  name: 'Readout',
  fontFamily: '$readout',
  fontSize: '$2',
  lineHeight: '$2',
  fontWeight: '600',
  letterSpacing: -0.85,
  color: '$ink',
  variants: {
    hero: {
      true: { fontSize: '$4', lineHeight: '$4', letterSpacing: -1.3, textShadowColor: glow.text, textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
    },
    stat: {
      true: { fontSize: 20, lineHeight: 24, letterSpacing: -0.5 },
    },
  } as const,
})

/** An address — the body face with tabular numerals, never Oxanium, never a monospace. */
export const Address = styled(TText, {
  name: 'Address',
  fontFamily: '$body',
  fontSize: '$2',
  lineHeight: '$2',
  fontVariant: ['tabular-nums'],
  color: '$mute',
})

/**
 * A key: the primary/secondary action control. `regular` is 56 px and is
 * reserved for a screen's primary verb; `compact` is a 44 px frame (the hit
 * target) for everything else — Back, Copy, Save, Cancel, Close, options.
 * The primary is painted by `Key` with the current; the frame itself is
 * transparent so the gradient shows through.
 */
export const KeyFrame = styled(TView, {
  name: 'Key',
  position: 'relative',
  height: 56,
  minHeight: 44,
  paddingHorizontal: '$6',
  borderRadius: '$key',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  overflow: 'hidden',
  variants: {
    kind: {
      // The gradient measures its box before it can paint (see Rim.tsx), so the
      // frame carries the current's first stop underneath it. Without that a
      // primary key would show one transparent frame on mount.
      primary: { backgroundColor: current.from, shadowColor: glow.key, shadowRadius: 14, shadowOpacity: 1, shadowOffset: { width: 0, height: 5 } },
      secondary: { backgroundColor: '$glassRaised', borderWidth: 0 },
      danger: { backgroundColor: '$burn' },
    },
    size: {
      regular: { height: 56, paddingHorizontal: '$6', borderRadius: '$key' },
      compact: { height: 44, paddingHorizontal: '$4', borderRadius: 12 },
    },
    disabled: {
      true: { opacity: 0.45, cursor: 'default' },
    },
  } as const,
  defaultVariants: { kind: 'primary', size: 'regular' },
  pressStyle: { opacity: 0.88, scale: 0.985 },
})

export const KeyLabel = styled(TText, {
  name: 'KeyLabel',
  fontFamily: '$body',
  fontSize: '$3',
  fontWeight: '600',
  color: '$ink',
  variants: {
    onDark: { true: { color: '$ink' } },
  } as const,
})

/** A pill frame: a token, a duration, a scope, a small stamped mark (Custom, Verified, Hyperlane…). `Pill` wraps it as a control. */
export const Chip = styled(TView, {
  name: 'Chip',
  position: 'relative',
  overflow: 'hidden',
  paddingHorizontal: '$3',
  paddingVertical: '$1',
  borderRadius: '$chip',
  backgroundColor: '$glassRaised',
  borderWidth: 1,
  borderColor: '$edge',
})

/** The 2 px filament under the readout (static form; LiveFilament moves). */
export const Filament = styled(TView, {
  name: 'Filament',
  height: 2,
  backgroundColor: '$arc',
  borderRadius: 1,
  variants: {
    stalled: { true: { backgroundColor: '$mute' } },
  } as const,
})
