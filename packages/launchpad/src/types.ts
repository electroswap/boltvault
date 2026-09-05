/**
 * The 6-state launchpool status table.
 *
 * - `not-started`            — startBlock > nowBlock; pool exists but contributing is not yet open.
 * - `live`                   — accepting contributions (msg.value between min and max).
 * - `ended-not-finalized`    — ended but not yet finalized; awaiting the finalization window.
 * - `launched-claim`         — launched; contributors may claim tokens (or after finalize).
 * - `failed-refund`          — pool failed (didn't reach target); contributors may refund.
 * - `cancelled`              — pool was cancelled by the organizer.
 */
export type LaunchpadStatus =
  | 'not-started'
  | 'live'
  | 'ended-not-finalized'
  | 'launched-claim'
  | 'failed-refund'
  | 'cancelled'

export interface Campaign {
  /** Launchpool pool contract address. */
  pool: string
  status: LaunchpadStatus
  /** Minimum contribution (native ETN, wei). */
  min: bigint
  /** Maximum contribution (native ETN, wei). */
  max: bigint
  /** Total raised so far (wei). */
  raised: bigint
  /** User's fill/contribution amount (wei). */
  yourFill: bigint
  /** Referrer address, or undefined (no referrer). */
  referrer?: string
  /** Launched token address, if set. */
  token?: string
  name?: string
  /** Original raw row, preserved for debugging. */
  raw?: any
}
