/**
 * Design tokens (T8.1) — the "face contract", ported from the extension's
 * tokens.css. The design doc mandates one product across popup/tab/iPhone/
 * Android, so the mobile app MUST use these exact values. This is the single
 * source of truth in TypeScript (the CSS custom properties in the extension are
 * the same values); the RN app consumes this object directly.
 *
 * "one brain, two bodies, one face" — this file IS the face.
 */

/** The 8 named BoltVault colors (6 palette + ink + mute). */
export const COLOR = {
  void: '#05060c',
  glass: '#0c1424',
  arc: '#5ce1ff',
  plasma: '#b794ff',
  ember: '#e8c36a',
  burn: '#ff6b4a',
  ink: '#d7e0f0',
  mute: '#8b9bb4',
} as const

export type ColorName = keyof typeof COLOR

/** Fonts (Sora primary, Oxanium for numerals/display, IBM Plex Mono for hex). */
export const FONT = {
  sora: 'Sora',
  oxanium: 'Oxanium',
  mono: 'IBM Plex Mono',
} as const

/** Metrics (px). The bus bar + hit target are the instrument's signature. */
export const METRIC = {
  inset: 24,
  filament: 2,
  busBarHeight: 44,
  hit: 44,
  blockTimeMs: 5000,
} as const

/** The full token set, shaped for direct consumption by the RN app. */
export const TOKENS = { color: COLOR, font: FONT, metric: METRIC } as const

/** The exact set of named colors — used to verify a port didn't drop one. */
export const COLOR_NAMES: readonly ColorName[] = Object.keys(COLOR) as ColorName[]
