/**
 * @boltvault/ui tokens — the design contract (docs/design/style-bible.md).
 *
 * Two palettes: PAINT (chrome, text, controls) and LIGHT (only ever rendered
 * by the scene). One current — electric blue flowing into violet — is the
 * brand: the primary key, the lit rims, the filament, the share bars. This
 * file is consumed by the Tamagui config, the scene renderer and (if the
 * face gate fails) the DOM fallback — it is the one source of truth.
 */

export const paint = {
  /** Base: a deep navy night, never black. Always under the Grid. */
  void: '#070A1F',
  /** Sheet and menu base; the bottom of the page gradient. */
  deep: '#0B1030',
  /** Recessed plate — smoked navy glass: the Grid shows through it. */
  glass: 'rgba(13, 18, 52, 0.66)',
  /** Raised plate, console, sheet. */
  glassRaised: 'rgba(22, 30, 78, 0.72)',
  /** Inputs and the terminals inside a console: darker than their plate. */
  well: 'rgba(6, 9, 30, 0.72)',
  /** Opaque plate colours for contexts that must not blend (menus, chips over images). */
  glassSolid: '#0D1234',
  glassRaisedSolid: '#161E4E',
  /** The sheet panel is opaque at every frame (a paused slide never shows the screen beneath). */
  sheet: '#10173F',
  /** Body text and numerals. */
  ink: '#F1F4FF',
  /** Labels, captions, unpriced rows. */
  mute: '#8F99C4',
  /** The live mark: filament, selected, links, the active tab. */
  arc: '#4FC3FF',
  /** A chosen chip's fill and edge (style bible › selected): a tint of the arc, never a lit rim. */
  arcSoft: 'rgba(79, 195, 255, 0.14)',
  arcEdge: 'rgba(79, 195, 255, 0.45)',
  /** The far mark: rims fade into it. Never a flat fill on its own. */
  plasma: '#8B5CF6',
  /** Gains, confirmed, "to collect". */
  surge: '#3EE6A5',
  /** Tier marks, offers, warnings that are not danger. */
  ember: '#F5C66B',
  /** Losses, danger, revoke. */
  burn: '#FF5C7A',
} as const

export const light = {
  /** Node cores and the hero numeral's glow. */
  core: '#EAF6FF',
  arc: '#4FC3FF',
  plasma: '#8B5CF6',
  auroraViolet: '#5B2BD9',
  auroraBlue: '#1E4DFF',
  /** Heat: the tier's warmth pulls the blue aurora toward it. */
  flare: '#FF8A5B',
} as const

/** The current: electric blue into violet, left to right (top-left to bottom-right on rims). */
export const current = { from: '#37A6FF', to: '#8A4DFF' } as const

/** Recessed plate edges. */
export const edge = 'rgba(122, 140, 255, 0.16)'
/** Focus. */
export const edgeStrong = 'rgba(140, 170, 255, 0.34)'
/** The lit rim on raised plates, consoles, sheets, pills and secondary keys (an SVG gradient stroke). */
export const rim = { from: 'rgba(79, 195, 255, 0.9)', to: 'rgba(139, 92, 246, 0.9)' } as const

export const glow = {
  plate: 'rgba(60, 100, 255, 0.22)',
  /** Raised plates: one hero per screen, softer than a console. */
  plateSoft: 'rgba(60, 100, 255, 0.14)',
  key: 'rgba(70, 120, 255, 0.32)',
  text: 'rgba(79, 195, 255, 0.35)',
  tab: 'rgba(79, 195, 255, 0.6)',
} as const

export const metrics = {
  /** Popup inset; mobile/tab use insetWide. */
  inset: 20,
  insetWide: 24,
  /** Minimum hit target. A PR that shrinks one fails CI. */
  hit: 44,
  busBar: 52,
  key: 56,
  /** Compact keys, icon buttons, headers: a 44 px frame (the hit target) with a smaller visual inside. */
  keyCompact: 44,
  header: 44,
  tabBar: 52,
  filament: 2,
  /** Rabby-wide: 400 × 600 gives every row room to breathe. */
  popup: { width: 400, height: 600 },
} as const

/** Radii by plate role — one radius on everything is the template tell. */
export const radius = {
  recessed: 14,
  raised: 16,
  console: 20,
  key: 16,
  seat: 999,
  chip: 999,
  well: 12,
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

/**
 * Families carry a real fallback stack. Declaring a bare 'Oxanium' meant that
 * for the first frames of every load — before the woff2 was applied — the
 * browser fell back to its *default* family, which is a serif. That is the
 * serif "BoltVault" the owner filmed. A stack cannot happen to be a serif.
 */
export const fonts = {
  /** Readouts ≥ 24 px: Oxanium 600, tabular numerals, tracking −0.03em. */
  readout: "'Oxanium', 'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  /** Everything a human reads — addresses and hashes included, tabular: Sora 400/600, 13–17 px, sentence case. */
  text: "'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const

export const type = {
  readoutHero: { size: 40, weight: '600', tracking: -1.3 },
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
  /** A view arriving after navigation. */
  screen: 180,
  /** A fill, an indicator, a tint answering a press or a choice. */
  micro: 160,
  /** The highlight that sweeps a primary key once per press. */
  charge: 260,
} as const

export type PaintToken = keyof typeof paint
export type LightToken = keyof typeof light
