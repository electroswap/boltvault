/**
 * Tamagui configuration built from ./tokens. Both bodies load this: Metro on
 * mobile, Vite (react-native-web) in the extension.
 */
import { createFont, createTamagui, createTokens } from '@tamagui/core'
import { edge, edgeStrong, fonts as fontFamilies, light, paint, radius, space } from './tokens'

const sizeScale = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  11: 44,
  12: 48,
  13: 52,
  14: 56,
  true: 44,
} as const

export const tokens = createTokens({
  color: {
    ...paint,
    lightCore: light.core,
    lightArc: light.arc,
    lightPlasma: light.plasma,
    lightFlare: light.flare,
    lightAuroraViolet: light.auroraViolet,
    lightAuroraBlue: light.auroraBlue,
    edge,
    edgeStrong,
  },
  space: { ...space, true: space[4] },
  size: sizeScale,
  radius: { ...radius, true: radius.recessed },
  zIndex: { 0: 0, 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 },
})

const sora = createFont({
  family: fontFamilies.text,
  size: { 1: 12, 2: 13, 3: 15, 4: 17, 5: 20, true: 15 },
  lineHeight: { 1: 16, 2: 18, 3: 21, 4: 24, 5: 28, true: 21 },
  weight: { 1: '400', 4: '600', true: '400' },
  letterSpacing: { 1: 0, true: 0 },
})

const oxanium = createFont({
  family: fontFamilies.readout,
  size: { 1: 24, 2: 28, 3: 34, 4: 40, 5: 48, true: 28 },
  lineHeight: { 1: 28, 2: 32, 3: 38, 4: 46, 5: 54, true: 32 },
  weight: { 1: '600', true: '600' },
  letterSpacing: { 1: -0.7, 2: -0.85, 3: -1.0, 4: -1.3, 5: -1.5, true: -0.85 },
})

const mono = createFont({
  family: fontFamilies.mono,
  size: { 1: 14, true: 14 },
  lineHeight: { 1: 20, true: 20 },
  weight: { 1: '400', true: '400' },
  letterSpacing: { 1: 0, true: 0 },
})

/** v1 is forced dark; "daylight glass" is a later named instrument (§7.3). */
const dark = {
  background: paint.void,
  backgroundHover: paint.glass,
  backgroundPress: paint.glassRaised,
  backgroundFocus: paint.glass,
  color: paint.ink,
  colorHover: paint.ink,
  colorPress: paint.ink,
  colorFocus: paint.ink,
  borderColor: edge,
  borderColorHover: edgeStrong,
  borderColorPress: edgeStrong,
  borderColorFocus: edgeStrong,
  shadowColor: 'rgba(0,0,0,0.6)',
  shadowColorHover: 'rgba(0,0,0,0.6)',
  shadowColorPress: 'rgba(0,0,0,0.6)',
  shadowColorFocus: 'rgba(0,0,0,0.6)',
  placeholderColor: paint.mute,
  outlineColor: paint.arc,
}

export const tamaguiConfig = createTamagui({
  tokens,
  themes: { dark, light: dark },
  fonts: { body: sora, heading: sora, readout: oxanium, mono },
  defaultFont: 'body',
  shorthands: {
    p: 'padding',
    px: 'paddingHorizontal',
    py: 'paddingVertical',
    m: 'margin',
    mt: 'marginTop',
    mb: 'marginBottom',
    bg: 'backgroundColor',
    br: 'borderRadius',
    ai: 'alignItems',
    jc: 'justifyContent',
    fd: 'flexDirection',
    gap: 'gap',
    f: 'flex',
    w: 'width',
    h: 'height',
  } as const,
  settings: {
    allowedStyleValues: 'somewhat-strict-web',
    defaultFont: 'body',
    fastSchemeChange: false,
  },
})

export type TamaguiAppConfig = typeof tamaguiConfig

declare module '@tamagui/core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends TamaguiAppConfig {}
}
