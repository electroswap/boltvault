/**
 * Interface-first primitives (master plan §2.6, docs/design/style-bible.md).
 * `packages/wallet` composes only these; it never imports react-native.
 * Every primitive is a Tamagui styled component today; the DOM fallback
 * would implement the same props with plain React, selected by the
 * extension's Vite resolver.
 */
import { styled, Text as TText, View as TView } from '@tamagui/core'
import { Children, Fragment, type ComponentProps, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { PlateFill } from './PlateFill'
import { Rim } from './Rim'
import { current, glow, radius } from './tokens'
import { amountRuns, ZERO_RUN_MIN } from './zeroRun'

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

/**
 * What the two pressable roles look like at rest.
 *
 * `card` and `tile` carry a `pressStyle`, and Tamagui compiles that to an
 * `:active` rule with `!important` — which the browser fires on any element
 * under the mouse, handler or not. So the eight static plates on these roles
 * dimmed when pressed and told the reader something had happened. Restating the
 * resting values wins over the base rule, the same way the disabled key does it.
 */
const RESTING_PRESS: Partial<Record<PlateRole, object>> = { card: { opacity: 1 }, tile: { backgroundColor: '$glassRaised' } }

const RIM_BY_ROLE: Record<PlateRole, number> = { recessed: 0, raised: 0.45, console: 0.7, card: 0.3, tile: 0.45, well: 0 }
const RADIUS_BY_ROLE: Record<PlateRole, number> = { recessed: radius.recessed, raised: radius.raised, console: radius.console, card: radius.recessed, tile: radius.raised, well: radius.well }

export function Plate({ role = 'recessed', rim, children, ...rest }: PlateProps) {
  const lit = rim ?? RIM_BY_ROLE[role]
  // A plate nobody can press must not react to being pressed. Spread before
  // `rest`, so a caller that wants its own press treatment still gets it.
  const pressable = rest.onPress !== undefined || rest.onPressIn !== undefined || rest.onLongPress !== undefined
  const resting = pressable ? undefined : RESTING_PRESS[role]
  /*
    The gradient goes UNDER the children and over the frame's flat colour, which
    stays as the fallback for the frame it is painted on before layout lands.
    See `PlateFill` for why the bible treats this as a material and not a
    flourish.
  */
  return (
    <PlateFrame role={role} {...(resting ? { pressStyle: resting } : {})} {...rest}>
      <PlateFill role={role} radius={RADIUS_BY_ROLE[role]} />
      {children}
      {lit > 0 ? <Rim radius={RADIUS_BY_ROLE[role]} opacity={lit} /> : null}
    </PlateFrame>
  )
}

/**
 * The zero-run notation (./zeroRun), painted.
 *
 * It lands in the text faces rather than at the call sites because almost
 * every amount in the app reaches its row through an interpolated sentence —
 * `'{a} {s} → at least {b} {u}'` — where there is no element to wrap. A face
 * is the last point that still holds the whole string *and* knows how big it
 * is drawing it, which is exactly what the small run needs.
 *
 * Three fifths of the parent's size and a sixth of it below the line: small
 * enough that nobody reads "0.0171" as a number, low enough to say "these are
 * the zeros I am standing in for". Owner, on the first cut at two thirds:
 * "make the subscript just a little smaller". The floor is what keeps it
 * legible on the caption face, where three fifths of 13 px would be seven.
 */
const RUN_TRIGGER = `0.${'0'.repeat(ZERO_RUN_MIN)}`
const SUB_SCALE = 0.6
const SUB_FLOOR = 8
const SUB_DROP = 0.16

function carriesRun(children: ReactNode): boolean {
  if (typeof children === 'string') return children.includes(RUN_TRIGGER)
  if (Array.isArray(children)) return children.some(carriesRun)
  return false
}

/**
 * `children` with every compressible zero run replaced by `sub`'s rendering of
 * its count. Returns `children` untouched — no walk, no allocation — for the
 * overwhelming majority of strings, which hold no such run.
 */
function notate(children: ReactNode, sub: (count: number, key: number) => ReactNode): ReactNode {
  if (!carriesRun(children)) return children
  return Children.map(children, (child) => {
    if (typeof child !== 'string') return child
    const runs = amountRuns(child)
    if (!runs) return child
    return <>{runs.map((run, i) => (typeof run === 'string' ? run : <Fragment key={i}>{sub(run, i)}</Fragment>))}</>
  })
}

/**
 * Where the small run sits.
 *
 * On the web a nested text node is an inline box, so `top` drops it under the
 * baseline and the notation is a true subscript. React Native has no inline
 * baseline shift at all — a nested `Text` carries text attributes and nothing
 * else, and the only way round it, an inline `View` with a transform, misbehaves
 * under the `numberOfLines` that most of these rows set. So the offset is
 * declared only where it does something: on a phone the run is three fifths
 * the size, sitting on the line, which still reads as a count and never as a
 * digit of the number. If a phone ever needs the true drop, this function is
 * the whole of what changes.
 */
export function subRun(base: number): { readonly fontSize: number; readonly position?: 'relative'; readonly top?: number } {
  const fontSize = Math.max(SUB_FLOOR, Math.round(base * SUB_SCALE))
  return Platform.OS === 'web' ? { fontSize, position: 'relative', top: Math.round(base * SUB_DROP) } : { fontSize }
}

/** Body text — Sora, sentence case. */
const BodyText = styled(TText, {
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

export type BodyProps = ComponentProps<typeof BodyText>

/** The Sora sizes behind the `size` variant, for the small run to scale from. */
const BODY_PX = { caption: 13, body: 15, title: 17 } as const

export function Body({ children, ...rest }: BodyProps) {
  const base = typeof rest.fontSize === 'number' ? rest.fontSize : BODY_PX[rest.size ?? 'body']
  // The run borrows the face's colour, so a muted line stays muted.
  const inherit = { ...(rest.tone === undefined ? {} : { tone: rest.tone }), ...(rest.color === undefined ? {} : { color: rest.color }) }
  return (
    <BodyText {...rest}>
      {notate(children, (count, key) => (
        <BodyText key={key} {...inherit} {...subRun(base)}>
          {count}
        </BodyText>
      ))}
    </BodyText>
  )
}

/**
 * A readout — Oxanium ≥ 24 px, tabular numerals. The hero carries a faint
 * glow; `stat` (20 px) is the one readout size below 24 px, used only inside
 * a stat strip.
 */
const ReadoutText = styled(TText, {
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

export type ReadoutProps = ComponentProps<typeof ReadoutText>

export function Readout({ children, ...rest }: ReadoutProps) {
  const base = typeof rest.fontSize === 'number' ? rest.fontSize : rest.hero ? 40 : rest.stat ? 20 : 28
  const inherit = rest.color === undefined ? {} : { color: rest.color }
  return (
    <ReadoutText {...rest}>
      {notate(children, (count, key) => (
        <ReadoutText key={key} {...inherit} {...subRun(base)} letterSpacing={0}>
          {count}
        </ReadoutText>
      ))}
    </ReadoutText>
  )
}

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
      /*
        The press treatment has to be cancelled here, not merely unhandled.

        `pressStyle` below compiles to an `:active` rule with `!important`, and
        `:active` does not ask whether anything is listening — so a disabled key
        brightened from 0.45 to 0.88 and shrank under the mouse while doing
        nothing at all. Owner, on the signing sheet with no Ledger attached:
        pressing Sign looked like it had worked. Restating both properties at
        their resting values is what beats the base rule.
      */
      true: { opacity: 0.45, cursor: 'default', pressStyle: { opacity: 0.45, scale: 1 } },
    },
  } as const,
  defaultVariants: { kind: 'primary', size: 'regular' },
  pressStyle: { opacity: 0.88, scale: 0.985 },
})

const KeyLabelText = styled(TText, {
  name: 'KeyLabel',
  fontFamily: '$body',
  fontSize: '$3',
  fontWeight: '600',
  color: '$ink',
  variants: {
    onDark: { true: { color: '$ink' } },
  } as const,
})

export type KeyLabelProps = ComponentProps<typeof KeyLabelText>

/** A verb, occasionally a verb with an amount in it — so it notates too. */
export function KeyLabel({ children, ...rest }: KeyLabelProps) {
  const base = typeof rest.fontSize === 'number' ? rest.fontSize : BODY_PX.body
  const inherit = rest.color === undefined ? {} : { color: rest.color }
  return (
    <KeyLabelText {...rest}>
      {notate(children, (count, key) => (
        <KeyLabelText key={key} {...inherit} {...subRun(base)}>
          {count}
        </KeyLabelText>
      ))}
    </KeyLabelText>
  )
}

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
