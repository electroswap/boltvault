/**
 * The scene behind a ceremony screen: the circuit, darkened at the top.
 *
 * Unlock, Onboarding and Backup each drew the `Field` with `quiet`, which is a
 * flat 15 % opacity over the whole frame. That is not the gradient the owner
 * asked for — "darker on the top, more transparent toward the bottom" — it is
 * the same darkness everywhere, and on a phone it left the screen looking like
 * a plain navy page with a rumour of a circuit on it: "the circuit is not
 * showing enough in the bottom of the unlock page."
 *
 * The grid screens got that gradient in `TabShell` — the scene at full strength
 * with a top-edge `Scrim` over it — and these three were the screens it was
 * copied *from*, so they should not be the ones without it. Same composition
 * here: the scene at a little over half, and the scrim taking the top down to
 * near-plain, so the frame reads dark where the type is and alive at the foot.
 *
 * Still, not quiet. `quiet` also pins the pulse and the touch point, which a
 * ceremony wants; it gets that for free by simply never passing a pulse and
 * never being touched, so the flag is not needed for the behaviour — only for
 * the dimming, which is the part being replaced.
 */
import { Column } from './primitives'
import { Field } from './scene/Field'
import { Scrim } from './Scrim'
import type { FieldProps } from './scene/Field.types'

export interface BackdropProps {
  readonly scene: FieldProps['scene']
  readonly width: number
  readonly height: number
  readonly reducedMotion?: boolean
  /** A seed for the scene; the ceremonies share one, having no account yet. */
  readonly address?: string
  readonly testID?: string
}

/** The ceremonies have no account to seed from, so they share a constant. */
const NO_ACCOUNT = '0x0000000000000000000000000000000000000e7n'

export function Backdrop({ scene, width, height, reducedMotion = false, address = NO_ACCOUNT, testID = 'field' }: BackdropProps) {
  return (
    <>
      <Field scene={scene} address={address} intensity={0.58} width={width} height={height} reducedMotion={reducedMotion} testID={testID} />
      <Column position="absolute" left={0} top={0} zIndex={0} pointerEvents="none">
        <Scrim width={width} height={height} edge="top" strength={0.86} testID="field-fade" />
      </Column>
    </>
  )
}
