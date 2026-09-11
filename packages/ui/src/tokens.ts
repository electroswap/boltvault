/**
 * @boltvault/ui tokens — the design contract (docs/design/style-bible.md).
 *
 * Two palettes: PAINT (chrome, text, controls) and LIGHT (only ever rendered
 * by the scene). One current — electric blue flowing into violet — is the
 * brand: the primary key, the lit rims, the filament, the share bars. This
 * file is consumed by the Tamagui config, the scene renderer and (if the
 * face gate fails) the DOM fallback — it is the one source of truth.
 */

import { Platform } from 'react-native'

/**
 * The web bodies and the phone want different numbers, and one of the two
 * differences is not cosmetic.
 *
 * FAMILIES. The browser needs a full fallback stack: a bare `font-family:
 * Sora` falls back to the UA default, which is a serif, and that put a serif
 * "BoltVault" on screen twice. React Native needs the opposite — `fontFamily`
 * takes ONE registered family name, and a comma-separated CSS stack matches
 * nothing, so Android silently drew everything in Roboto. Both rules are
 * right; they just are not the same rule.
 *
 * SCALE. `type` and `metrics` were calibrated for the 400 x 600 popup and then
 * used verbatim on a 448 dp phone, which is why the owner reported everything
 * feeling "a tad too small". The bible already asks for a phone scale (line 52
 * puts the hero at 48, line 85 the inset at 24); only the inset was ever
 * implemented. These finish that rule.
 */
const native = Platform.OS !== 'web'

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
  /*
    The page's side margin. A third narrower than it was (20/24), because a
    phone screen is mostly margin at those numbers — owner: "reduce the
    left/right margins a bit (by 33% on each side)". Everything is laid out
    from these two, so the whole product moves together.
  */
  /** Popup inset; mobile/tab use insetWide. */
  inset: 13,
  insetWide: 16,
  /**
   * How wide a page may get in the full tab.
   *
   * A wallet in a browser tab is still a wallet: a column of plates and rows,
   * read top to bottom. Letting it span a 32-inch monitor does not show more,
   * it just moves the balance a foot away from the token it belongs to. Home,
   * Portfolio, the Rack and Collection already stopped here by hand; this is
   * that number, once, so every screen stops at the same place.
   */
  page: 680,
  /** Minimum hit target. A PR that shrinks one fails CI. Thumbs are not cursors, so the phone asks for more. */
  hit: native ? 48 : 44,
  busBar: native ? 58 : 52,
  key: native ? 60 : 56,
  /** Compact keys, icon buttons, headers: a hit-target frame with a smaller visual inside — it tracks `hit`. */
  keyCompact: native ? 48 : 44,
  header: native ? 48 : 44,
  /**
   * The glass disc inside an `IconButton`, and the signature in the account
   * seat. One number, because the two circles meet.
   *
   * They were set independently — 34 in `IconButton`, 40 in `Seat` — and they
   * occupy the same place on the same line: Home's header opens with the
   * account circle, a pushed screen's header opens with the round Back, and
   * navigating swapped one for a visibly smaller other. Owner: the back/home
   * control and the account circle should be identical. Two literals could not
   * hold that, so neither of them is a literal any more.
   *
   * It stays below `hit` on purpose: the pressable frame around the disc is
   * still 44 (48 on the phone), so matching the seat never shrinks a target.
   */
  disc: 40,
  tabBar: native ? 56 : 52,
  /** Home's action cells. A popup is tight; a phone has the height to spare. */
  actionCell: native ? 94 : 72,
  actionCellRow: native ? 76 : 64,
  filament: 2,
  /** Rabby-wide: 400 × 600 gives every row room to breathe. */
  popup: { width: 400, height: 600 },
} as const

/**
 * Concentric corners: a shape inside a rounded shape takes the parent's radius
 * minus the gap between them. Equal radii make the inner corner look too round
 * and the pair look glued; an unrelated radius reads as two designs. Owner:
 * "within some of those cards we have other cards that have square edges,
 * which does not feel like a harmonious design."
 *
 * A child that sits flush inside a clipping parent should use `none` and let
 * the parent's clip shape it — two radii on one corner draw it twice.
 */
export function innerRadius(outer: number, inset: number): number {
  return Math.max(0, Math.round(outer - inset))
}

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
 * On the web a full stack, because a bare family falls back to the UA serif.
 * On native the bare name, because that is what `ReactFontManager.addCustomFont`
 * registered in MainApplication.kt — `Sora` and `Oxanium`, nothing else.
 */
export const fonts = {
  /** Readouts ≥ 24 px: Oxanium 600, tabular numerals, tracking −0.03em. */
  readout: native ? 'Oxanium' : "'Oxanium', 'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  /** Everything a human reads — addresses and hashes included, tabular: Sora 400/600, 13–17 px, sentence case. */
  text: native ? 'Sora' : "'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const

export const type = {
  readoutHero: { size: native ? 48 : 40, weight: '600', tracking: -1.3 },
  readout: { size: native ? 28 : 24, weight: '600', tracking: -0.7 },
  title: { size: native ? 18 : 17, weight: '600' },
  body: { size: native ? 16 : 15, weight: '400' },
  caption: { size: native ? 14 : 13, weight: '400' },
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
  /**
   * A shared element travelling between two screens (§7.7): the bus bar into
   * the token dossier's header, the thumb into the piece, the cell into the
   * campaign. Longer than a plain screen enter because the eye is following
   * one object rather than accepting a new plate, and a hair under the
   * browser's own 250 ms default so the pair lands before the cross-fade of
   * everything around it ends.
   */
  shared: 240,
} as const

export type PaintToken = keyof typeof paint
export type LightToken = keyof typeof light
