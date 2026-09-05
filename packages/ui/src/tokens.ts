/**
 * @boltvault/ui tokens — the design contract (master plan §7.3–§7.5).
 *
 * Two palettes: PAINT (chrome, text, controls) and LIGHT (only ever rendered
 * by the scene and by gradients inside `ui/scene`). Light never becomes a flat
 * fill. This file is consumed by the Tamagui config, the scene renderer and
 * (if the face gate fails) the DOM fallback — it is the one source of truth.
 */

export const paint = {
  /** Base. Always under a Field frame; flat only in reduced-motion. */
  void: '#060913',
  /** Recessed plate — smoked glass: the Field shows through it. */
  glass: 'rgba(14, 22, 40, 0.78)',
  /** Raised plate / sheet. */
  glassRaised: 'rgba(21, 34, 58, 0.88)',
  /** Opaque plate colours for contexts that must not blend (menus, chips over images). */
  glassSolid: '#0E1628',
  glassRaisedSolid: '#152238',
  /** Body text. */
  ink: '#DCE5F5',
  /** Secondary text, unpriced rows. */
  mute: '#8593AD',
  /** The one loud paint: primary action, selected, live marks. */
  arc: '#5FD8FF',
  /** Value, gains, gold of a charge held. */
  ember: '#F0C56B',
  /** Danger, revoke, blocked. Copper-hot. */
  burn: '#FF6B4A',
} as const

export const light = {
  /** Arc core; hero numeral highlight inside the scene. */
  core: '#EEF8FF',
  arc: '#5FD8FF',
  /** Violet fringe of the arc — never paint (§7.3). */
  plasma: '#A78BFF',
  /** Heat fringe; ties to ElectroSwap's warm brand without adopting its pink. */
  flare: '#FF8A5B',
} as const

/** Plate edges are `arc` at 12% alpha, never grey. */
export const edge = 'rgba(95, 216, 255, 0.12)'
export const edgeStrong = 'rgba(95, 216, 255, 0.28)'

export const metrics = {
  /** Popup inset; mobile/tab use insetWide. */
  inset: 20,
  insetWide: 24,
  /** Minimum hit target. A PR that shrinks one fails CI. */
  hit: 44,
  busBar: 52,
  key: 56,
  filament: 2,
  popup: { width: 360, height: 600 },
} as const

/** Radii by plate role — one radius on everything is the template tell. */
export const radius = {
  recessed: 12,
  raised: 16,
  key: 18,
  seat: 999,
  chip: 8,
  none: 0,
} as const

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const

export const fonts = {
  /** Readouts ≥ 24 px: Oxanium 600, tabular numerals, tracking −0.03em. */
  readout: 'Oxanium',
  /** Everything a human reads: Sora 400/600, 13–17 px, sentence case. */
  text: 'Sora',
  /** Addresses ≥ 14 px, tabular. */
  mono: 'IBM Plex Mono',
} as const

export const type = {
  readoutHero: { size: 34, weight: '600', tracking: -1.0 },
  readout: { size: 24, weight: '600', tracking: -0.7 },
  title: { size: 17, weight: '600' },
  body: { size: 15, weight: '400' },
  caption: { size: 13, weight: '400' },
  address: { size: 14, weight: '400' },
} as const

export const motion = {
  /** The one orchestrated enter: ignition on unlock. */
  ignition: 400,
  discharge: 250,
  roll: 300,
  sheet: 220,
  press: 90,
} as const

export type PaintToken = keyof typeof paint
export type LightToken = keyof typeof light
