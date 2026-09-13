/**
 * Input's decisions, with no JSX in them.
 *
 * Kept in a plain `.ts` module so `packages/ui/tests/*` can reach it: those
 * run under bare vitest with no JSX transform and no react-native resolution,
 * which is why every test in that directory imports a `.ts` file.
 */

/**
 * The Android keyboard type a `sensitive` field asks for — and, decisively, the
 * one it must never ask for.
 *
 * `visible-password` is `TYPE_TEXT_VARIATION_VISIBLE_PASSWORD`: "a password,
 * shown in clear". React Native's own text-input manager comments that setting
 * it "will supersede secureTextEntry", and the flag arithmetic bears that out —
 * the keyboard-type setter clears only the class mask `0x0F`, so the PASSWORD
 * variation `0x80` survives and VISIBLE `0x90` is ORed on top, while
 * `checkPasswordType` arbitrates the numeric case only. Whichever prop is
 * applied last wins, and this one was applied last: every password field that
 * also asked to be `sensitive` — onboarding, unlock, and every reveal and
 * export gate — rendered in plain glyphs on Android. A beta tester saw their
 * own and asked, very mildly, whether it could be hidden.
 *
 * So it is asked for only where the text is meant to be legible while it is
 * typed — a recovery-phrase word, a quiz answer, an export code — and never on
 * a field that has already said `secure`. The anti-autofill half of `sensitive`
 * is unaffected: `autoComplete`, `importantForAutofill`, `autoCorrect` and
 * `spellCheck` carry it, and none of them touch the masking.
 *
 * Exported for the test that pins it. This is a regression that is invisible on
 * every body except a real Android device.
 */
export function sensitiveKeyboardType(field: {
  readonly sensitive?: boolean | 'code'
  readonly secure?: boolean
  readonly multiline?: boolean
}): 'visible-password' | undefined {
  if (!field.sensitive) return undefined
  // A masked field, or a phrase box where it would fight the return key.
  if (field.secure === true || field.multiline === true) return undefined
  return 'visible-password'
}
