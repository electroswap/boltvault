/**
 * Shared elements (master plan §7.7) — the contract both renderers implement,
 * and the one rule that turns an app identity into a transition name.
 *
 * The plan names exactly three moments: bus bar → token dossier header, NFT
 * thumb → piece, campaign cell → campaign page. All three are the same thing
 * seen closer, which is the only reason to carry a pixel between two screens;
 * anything else is decoration and the plan's motion budget forbids it.
 *
 * The two halves are genuinely different mechanisms, not one abstraction with
 * a switch: the web names a box and lets the browser tween the two snapshots
 * (`SharedElement.tsx`), the phone hands a tag to Reanimated and lets the
 * navigator do it (`SharedElement.native.tsx`). What they share is this file:
 * the props, and `sharedElementTag`, so an id spelled once on the origin
 * screen and once on the destination always produces the same name.
 *
 * Neither half is ever load-bearing. With no view transitions (Firefox,
 * Chrome < 111) and with Reanimated's shared transitions unavailable on
 * Fabric, both fall back to the plain push that was always the baseline.
 */
import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

export interface SharedElementProps {
  /**
   * What this element *is*, spelled the same way on both screens — e.g.
   * `token:52014:0x138d…`. Sanitised into a legal transition name here, so
   * callers write the identity they mean rather than a CSS ident.
   */
  readonly id: string
  /**
   * False leaves the element out of the transition entirely. A list only
   * wants this off when it is long enough that naming every row would cost
   * the browser a snapshot per row; the three named moments leave it on.
   */
  readonly active?: boolean
  /**
   * The wrapper is a real box in the layout, so a caller that was relying on
   * `flexShrink` or `flex` on the child has to say it here too.
   */
  readonly style?: StyleProp<ViewStyle>
  readonly children: ReactNode
  readonly testID?: string
}

/**
 * An identity as a transition name.
 *
 * `view-transition-name` takes a CSS custom-ident: no colons, no dots, no
 * leading digit. Addresses and chain ids have all three, so everything that
 * is not a letter or a digit collapses to a dash and the whole thing carries
 * a `bv-` prefix — which also keeps our names out of any other page's.
 * Lower-cased because a token address arrives checksummed from one screen and
 * plain from the next, and a name that disagrees pairs with nothing.
 */
export function sharedElementTag(id: string): string {
  const body = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return body === '' ? 'bv-shared' : `bv-${body}`
}
