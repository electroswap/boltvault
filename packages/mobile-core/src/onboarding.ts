/**
 * Onboarding (T8.2 parity) — the mobile onboarding must be parity with the
 * extension's (T1 reuse). We model the canonical onboarding step sequence as
 * data, and a parity check asserts the mobile flow covers every step the
 * extension requires (and in the same order). "Reuse packages/* via RN" means
 * the steps are the SAME logical steps — only the transport differs.
 */

/** A canonical onboarding step (order matters). */
export type OnboardingStep =
  | 'welcome'
  | 'choose-creation' // create vault | import mnemonic
  | 'create-vault'
  | 'import-mnemonic'
  | 'set-password'
  | 'hardware-pair' // ledger / trezor (optional)
  | 'add-account'
  | 'chain-select'
  | 'done'

/**
 * The canonical onboarding sequence. This is the contract both bodies must
 * satisfy. (create-vault / import-mnemonic are alternatives after
 * choose-creation; hardware-pair is optional.)
 */
export const CANONICAL_ONBOARDING: readonly OnboardingStep[] = [
  'welcome',
  'choose-creation',
  'set-password',
  'add-account',
  'chain-select',
  'done',
]

export interface OnboardingFlow {
  readonly label: string
  readonly steps: readonly OnboardingStep[]
}

/**
 * True when `flow.steps` is a parity superset of `CANONICAL_ONBOARDING`: every
 * canonical step appears, in the same relative order. (The flow MAY include
 * optional steps like 'hardware-pair' or the create/import branch.)
 */
export function isParitySuperset(flow: OnboardingFlow): boolean {
  let ci = 0
  for (const step of flow.steps) {
    if (step === CANONICAL_ONBOARDING[ci]) {
      ci++
      if (ci >= CANONICAL_ONBOARDING.length) return true
    }
  }
  return false
}

/** The optional steps a flow may add without breaking parity. */
export const OPTIONAL_STEPS: readonly OnboardingStep[] = [
  'create-vault',
  'import-mnemonic',
  'hardware-pair',
]

/**
 * Build the concrete step list for a given onboarding path (which creation
 * branch + whether hardware pairing is used). This is what the mobile shell
 * renders, and it must pass {@link isParitySuperset}.
 */
export function buildFlow(opts: {
  readonly label: string
  readonly creation: 'create' | 'import'
  readonly withHardware: boolean
}): OnboardingFlow {
  const steps: OnboardingStep[] = ['welcome', 'choose-creation']
  if (opts.creation === 'create') steps.push('create-vault')
  else steps.push('import-mnemonic')
  if (opts.withHardware) steps.push('hardware-pair')
  steps.push('set-password', 'add-account', 'chain-select', 'done')
  return { label: opts.label, steps }
}
