/**
 * Interface-first primitives (master plan §2.6). `packages/wallet` composes
 * only these; it never imports react-native. Every primitive is a Tamagui
 * styled component today; the DOM fallback would implement the same props
 * with plain React, selected by the extension's Vite resolver.
 *
 * M0 ships the handful the Hello screen needs. M1 grows this into the ~30
 * primitives the surfaces use (bus bar, seat, plate roles, keys, sheets…).
 */
import { styled, Text as TText, View as TView } from '@tamagui/core'

/** Full-bleed screen background. The Field renders behind it (M1). */
export const Screen = styled(TView, {
  name: 'Screen',
  flex: 1,
  backgroundColor: '$void',
})

/** Vertical stack. */
export const Column = styled(TView, {
  name: 'Column',
  flexDirection: 'column',
})

/** Horizontal stack. */
export const Row = styled(TView, {
  name: 'Row',
  flexDirection: 'row',
  alignItems: 'center',
})

/** A recessed or raised glass plate. Role decides radius and elevation. */
export const Plate = styled(TView, {
  name: 'Plate',
  backgroundColor: '$glass',
  borderRadius: '$recessed',
  borderWidth: 1,
  borderColor: '$edge',
  padding: '$4',
  variants: {
    role: {
      recessed: { backgroundColor: '$glass', borderRadius: '$recessed' },
      raised: { backgroundColor: '$glassRaised', borderRadius: '$raised' },
    },
  } as const,
  defaultVariants: { role: 'recessed' },
})

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

/** A readout — Oxanium ≥ 24 px, tabular numerals. Digits roll only on change (M1). */
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
      true: { fontSize: '$3', lineHeight: '$3', letterSpacing: -1.0 },
    },
  } as const,
})

/** An address — tabular, ≥ 14 px, never Oxanium. */
export const Address = styled(TText, {
  name: 'Address',
  fontFamily: '$mono',
  fontSize: '$1',
  lineHeight: '$1',
  color: '$mute',
})

/** A key: the primary/secondary action control. 56 px tall, 44 px minimum hit. */
export const KeyFrame = styled(TView, {
  name: 'Key',
  height: 56,
  minHeight: 44,
  paddingHorizontal: '$6',
  borderRadius: '$key',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  variants: {
    kind: {
      primary: { backgroundColor: '$arc' },
      secondary: { backgroundColor: '$glassRaised', borderWidth: 1, borderColor: '$edge' },
      danger: { backgroundColor: '$burn' },
    },
    disabled: {
      true: { opacity: 0.45, cursor: 'default' },
    },
  } as const,
  defaultVariants: { kind: 'primary' },
  pressStyle: { opacity: 0.85 },
})

export const KeyLabel = styled(TText, {
  name: 'KeyLabel',
  fontFamily: '$body',
  fontSize: '$3',
  fontWeight: '600',
  color: '$void',
  variants: {
    onDark: { true: { color: '$ink' } },
  } as const,
})

/** A small stamped mark (Custom, Verified, Hyperlane…). */
export const Chip = styled(TView, {
  name: 'Chip',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  borderRadius: '$chip',
  backgroundColor: '$glassRaised',
  borderWidth: 1,
  borderColor: '$edge',
})

/** The 2 px filament under the readout; motion arrives in M1. */
export const Filament = styled(TView, {
  name: 'Filament',
  height: 2,
  backgroundColor: '$arc',
  borderRadius: 1,
  variants: {
    stalled: { true: { backgroundColor: '$mute' } },
  } as const,
})
