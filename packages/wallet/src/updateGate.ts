/**
 * Which screens a stale build stands in front of (ES-BV-007).
 *
 * Kept out of the component so it can be read on its own: the plate imports
 * `@boltvault/ui`, which imports React Native, and the wallet's unit tests run
 * in plain Node. A policy nothing can test is a policy that drifts.
 *
 * Everything on this set talks to the chain, a dApp or the routing service on
 * the user's behalf — the paths where old code can be wrong about money.
 * Settings, Security, Backup, Reveal, Export, Devices, Accounts and Activity
 * are deliberately absent: reading what you already have, and getting your own
 * key out, is exactly what a wallet must keep doing when a remote flag says
 * its version is old.
 */
import type { ScreenId, TabId } from './navigation/registry'

const BLOCKED: ReadonlySet<string> = new Set<string>([
  'home',
  'swap',
  'send',
  'bridge',
  'browser',
  'token',
  'nft',
  'rack',
  'farm',
  'launchpad',
  'campaign',
  'limit',
  'explore',
  'collection',
  'piece',
  'offers',
  'approval',
])

export function isBlockedByUpdate(screen: ScreenId | TabId | string | null | undefined): boolean {
  return typeof screen === 'string' && BLOCKED.has(screen)
}
