/**
 * The Legends vessel's fill rule (master plan §7.12, §8.10).
 *
 * Its own module, and not part of Vessel.tsx, for one reason: this is the
 * whole of the moment's acceptance criterion — "the vessel never animates when
 * nothing has changed" — and a rule that load-bearing has to be unit-tested.
 * The unit suites run in plain node, where importing a component pulls in
 * Reanimated and dies, so the rule lives where a test can reach it.
 */

/** The glass wall, top and bottom, that the liquid sits inside. */
export const VESSEL_WALL = 2

/**
 * The shortest liquid that still reads as liquid. Below this a non-zero
 * balance would paint as an empty vessel, which is the one thing the plate
 * must never say — "marketplace fees are paying me" has to survive the first
 * fee, not only the hundredth.
 */
export const VESSEL_MIN_FILL = 3

/**
 * The liquid's height in whole pixels.
 *
 * Whole pixels are the point. Dividends accrue continuously, so a status poll
 * thirty seconds after the last one returns a level a hair above it; animating
 * every one of those would be an idle loop wearing a data costume. Rounding to
 * the pixel means the level has to have actually moved — visibly — before the
 * eye is asked to look, and a render that carries the same level writes the
 * same height, which is a transition with nothing to transition.
 */
export function vesselFill(level: number, height: number): number {
  const usable = Math.max(0, Math.round(height) - VESSEL_WALL * 2)
  const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))
  if (clamped <= 0 || usable === 0) return 0
  const floor = Math.min(VESSEL_MIN_FILL, usable)
  return Math.min(usable, Math.max(floor, Math.round(clamped * usable)))
}
