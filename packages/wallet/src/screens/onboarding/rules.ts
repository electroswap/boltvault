/**
 * Onboarding's decisions, with no React in them.
 *
 * Everything here answers a question the screen asks — is this password good
 * enough, is this a plausible recovery phrase, what does this engine error mean
 * in English, how far through is the user. Kept apart from the screen so it can
 * be unit-tested: `packages/wallet/tests/*` run under plain vitest, so this
 * module must not reach `@boltvault/ui` (react-native) even indirectly.
 */
import { MIN_PASSWORD_LENGTH, passwordProblem } from '@boltvault/core'
import { t } from '../../i18n'

export type OnboardingPath = 'create' | 'import' | 'watch'
export type Step = 'intro' | 'blocked' | 'welcome' | 'words' | 'quiz' | 'password' | 'import' | 'preview' | 'watch' | 'passkey'

/*
  The refusals themselves now live in `@boltvault/core` so the engine enforces
  the same line on every path that sets a password (ES-BV-010) — including
  "Move a vault here", which had no policy at all. What stays here is the
  wording and the shades above the line, which are a screen's business.
*/
export const MIN_PASSWORD = MIN_PASSWORD_LENGTH

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  const problem = passwordProblem(pw)
  if (problem === 'short') return { score: 0, label: t({ id: 'pw.short', message: 'At least {n} characters', values: { n: MIN_PASSWORD } }) }
  if (problem === 'repetitive') return { score: 0, label: t({ id: 'pw.repetitive', message: 'Too few different characters' }) }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(pw)).length
  const words = pw.trim().split(/\s+/).length
  if (pw.length >= 20 || words >= 4) return { score: 3, label: t({ id: 'pw.strong', message: 'Strong' }) }
  if (classes >= 3 && pw.length >= 14) return { score: 2, label: t({ id: 'pw.good', message: 'Good' }) }
  return { score: 1, label: t({ id: 'pw.ok', message: 'Usable — a longer phrase is stronger' }) }
}

/**
 * The word counts BIP-39 actually defines.
 *
 * The import button used to open at "twelve or more", so 13, 16 and 20 words
 * passed it and failed in the engine with a raw `invalid_mnemonic` — the user
 * had typed a phrase the screen said was fine.
 */
export const BIP39_LENGTHS = new Set([12, 15, 18, 21, 24])

export function mnemonicWords(phrase: string): string[] {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function mnemonicLengthOk(phrase: string): boolean {
  return BIP39_LENGTHS.has(mnemonicWords(phrase).length)
}

/** What to say under the phrase field while it is being typed or pasted. */
export function mnemonicHint(phrase: string): string | null {
  const n = mnemonicWords(phrase).length
  if (n === 0) return null
  if (BIP39_LENGTHS.has(n)) return t({ id: 'ob.import.count.ok', message: '{n} words', values: { n } })
  return t({ id: 'ob.import.count.bad', message: '{n} words — a phrase is 12, 15, 18, 21 or 24', values: { n } })
}

/**
 * An engine error as something a person can act on.
 *
 * `run()` used to put `err.message` on screen, so a mistyped word produced the
 * string "that is not a valid recovery phrase" if you were lucky and a bare
 * error code if you were not. The engine's wording is for the engine's callers.
 */
export function engineErrorCopy(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/invalid_mnemonic|not a valid recovery phrase/i.test(raw)) {
    return t({ id: 'ob.err.mnemonic', message: 'That is not a valid recovery phrase. Check the spelling and the order of the words.' })
  }
  if (/already exists/i.test(raw)) {
    return t({ id: 'ob.err.exists', message: 'This device already has a vault. Unlock it instead, or add another account from Accounts.' })
  }
  if (/prf-unsupported/i.test(raw)) {
    return t({ id: 'ob.passkey.noprf', message: 'This browser created a passkey without the PRF feature, so it cannot unlock the vault on its own. Use your password.' })
  }
  if (/no such seed|not_found/i.test(raw)) {
    return t({ id: 'ob.err.notfound', message: 'That step expired. Start again from the beginning.' })
  }
  if (/quota|storage/i.test(raw)) {
    return t({ id: 'ob.err.storage', message: 'This device would not save the vault. Free some space and try again.' })
  }
  return t({ id: 'ob.err.generic', message: 'Something went wrong: {m}', values: { m: raw } })
}

/**
 * Which steps a URL may drop somebody on.
 *
 * `tab.html?screen=onboarding` takes params, so a crafted or stale link can
 * name a step. The ones excluded here need state that only the previous step
 * produces — landing on `words` from a URL would render an empty word grid,
 * which looks exactly like a broken wallet.
 */
const ENTRY_STEPS = new Set<Step>(['intro', 'welcome', 'password', 'import', 'watch'])

export function clampEntryStep(step: string | undefined): Step | null {
  return step !== undefined && ENTRY_STEPS.has(step as Step) ? (step as Step) : null
}

/**
 * Where this step sits in its path, for the progress indicator.
 *
 * Path-aware because the paths are different lengths, and a progress bar that
 * lies is worse than none: creating is three steps, importing three, watching
 * two. The intro is not counted — it is not part of the work, and neither was
 * the "this is Electroneum" page that used to close every path: the bar filled
 * on a screen whose only control dismissed it.
 */
const PATH_STEPS: Record<OnboardingPath, Step[]> = {
  create: ['words', 'quiz', 'password'],
  import: ['import', 'preview', 'password'],
  watch: ['watch', 'password'],
}

export function progressFor(path: OnboardingPath, step: Step): { now: number; max: number } | null {
  const steps = PATH_STEPS[path]
  // `passkey` is an offer, not a step of the path, and it is skipped entirely on
  // a device with neither factor — counting it would make the bar jump.
  const at = steps.indexOf(step)
  if (at < 0) return null
  return { now: at + 1, max: steps.length }
}
