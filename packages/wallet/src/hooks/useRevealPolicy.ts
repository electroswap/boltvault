/**
 * Who may open a recovery phrase, answered before the button is drawn.
 *
 * The engine has always decided this — `vault.reveal` refuses a non-password
 * factor while `revealNeedsPassword` is on, and that setting defaults to on.
 * The two screens that reveal a phrase never asked. So Backup and the Accounts
 * reveal sheet drew "Show with passkey" and "Show with biometrics" for anyone
 * with a factor enrolled, and by default both were dead: tap, wait for the
 * prompt, authenticate, and collect `unauthorized` from the namespace gate.
 *
 * Android was worse in the other direction. There the reveal is password-only
 * whatever the setting says (ES-BV-005 — Security locks the toggle on), and the
 * screens handled it by rendering nothing at all. A tester who unlocks the
 * wallet with a fingerprint every day came to back up a phrase, found no
 * fingerprint anywhere on the screen, and reported it as a fault: "When backing
 * up recovery phrase the biometrics (fingerprint) did not work." Nothing had
 * failed. Nothing had been offered, and nothing said so.
 *
 * One answer, read once, used by both screens: may a device factor do this, and
 * if not, the sentence that explains why. A withheld button with a reason is a
 * policy; a withheld button without one is a bug report.
 */
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'

export interface RevealPolicy {
  /** A passkey or the device key may open a phrase. False until the setting is known. */
  readonly factorsAllowed: boolean
  /** Why they may not, in plain language; null once they may. */
  readonly reason: string | null
}

export function useRevealPolicy(): RevealPolicy {
  const engine = useEngine()
  const host = useHost()
  const androidOnly = host.body === 'mobile' && host.isAndroid === true
  /*
    Undefined until the engine answers, and that matters: assuming "allowed"
    would flash the buttons and then withdraw them, and assuming "refused"
    would hide them from the people entitled to use them. Neither branch is
    drawn while the answer is unknown.
  */
  const [needsPassword, setNeedsPassword] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (androidOnly) return
    let alive = true
    engine.settings.get().then(
      (s) => alive && setNeedsPassword(s.revealNeedsPassword),
      () => alive && setNeedsPassword(true),
    )
    return () => {
      alive = false
    }
  }, [engine, androidOnly])

  if (androidOnly)
    return {
      factorsAllowed: false,
      reason: t({
        id: 'reveal.policy.android',
        message:
          'Your password is required to show a recovery phrase on Android: the device keystore there can be released by the screen-lock PIN, so a fingerprint is not enough for this one secret.',
      }),
    }
  if (needsPassword === undefined) return { factorsAllowed: false, reason: null }
  if (needsPassword)
    return {
      factorsAllowed: false,
      reason: t({
        id: 'reveal.policy.password',
        message:
          'Your password is required to show a recovery phrase. Your face or fingerprint unlocks this device; the phrase opens the wallet on any device, for ever. Change that in Settings › Security.',
      }),
    }
  return { factorsAllowed: true, reason: null }
}
