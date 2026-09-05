import type { DecodedAction } from './decode'

/** Risk chips surfaced on the confirm screen for a DecodedAction. */
export type RiskChip = 'poison' | 'infinite-approve' | 'unknown-to' | 'burn'

/**
 * Pure mapping from (decoded action, detected flags) → chips to display.
 * Flags are computed upstream (e.g. poisonCheck, allowance inspection); this
 * function only decides which chips apply, in display order.
 */
export function riskChips(
  d: DecodedAction,
  opts: { poison: boolean; infiniteApprove: boolean; unknownTo: boolean },
): RiskChip[] {
  const chips: RiskChip[] = []
  if (opts.poison) chips.push('poison')
  if (opts.infiniteApprove && d.category === 'APPROVAL') chips.push('infinite-approve')
  if (opts.unknownTo && d.category !== 'UNKNOWN') chips.push('unknown-to')
  // 'burn' is reserved for value transfers to the burn address (0x0);
  // upstream sets unknownTo=false for the burn address, so model burn as
  // SEND to 0x0:
  if (d.category === 'SEND' && d.to.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    chips.push('burn')
  }
  return chips
}
