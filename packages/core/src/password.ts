/**
 * What counts as a password this wallet will seal a vault under (ES-BV-010).
 *
 * The policy lived in the onboarding screen, so it applied exactly where the
 * onboarding screen ran. The engine's schema accepted `z.string().min(1)`, and
 * Devices › "Move a vault here" checked only that the field was non-empty —
 * so the one path that imports somebody's whole vault onto a new device was
 * also the one path with no policy at all. A vault file is the thing an
 * attacker takes away and guesses against offline; Argon2id buys time, and a
 * one-character password spends all of it.
 *
 * It lives here, with no i18n and no React, so the engine can enforce it and
 * the screens can explain it. The screens keep their own wording: this answers
 * whether, not how to say so.
 */

/** Below this a password is refused outright. */
export const MIN_PASSWORD_LENGTH = 12

/**
 * How many different characters a password must use.
 *
 * Length alone let "aaaaaaaaaaaa" pass: twelve characters, one bit of
 * imagination. Counting distinct characters catches the whole family — a
 * repeated letter, a two-character cycle, a mashed row — without shipping an
 * entropy estimator.
 */
export const MIN_PASSWORD_DISTINCT = 5

export type PasswordProblem = 'short' | 'repetitive'

/** The reason this password is refused, or null when it is acceptable. */
export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'short'
  if (new Set(password).size < MIN_PASSWORD_DISTINCT) return 'repetitive'
  return null
}

export function passwordAcceptable(password: string): boolean {
  return passwordProblem(password) === null
}

/** Plain English for a refusal, for callers with no translator to hand. */
export function passwordProblemText(problem: PasswordProblem): string {
  return problem === 'short'
    ? `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`
    : `A password needs at least ${MIN_PASSWORD_DISTINCT} different characters.`
}
