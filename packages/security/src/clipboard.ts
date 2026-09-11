/**
 * Clipboard-hijack detection (master plan §3.6).
 *
 * Malware that watches the clipboard swaps a copied address for its own
 * between the copy and the paste, and the paste looks exactly like what the
 * user meant to do. The only witness is the wallet's own memory of what it
 * put on the clipboard, so that record — not the clipboard, which is already
 * lying — is what a recipient is compared against.
 *
 * Pure, like poison.ts: the engine keeps the record, this decides.
 */
import type { Hex } from './types'
import { sameAddress } from './poison'

/** What the wallet itself copied, and when (epoch ms). */
export interface CopiedAddress {
  readonly address: Hex
  readonly at: number
}

/**
 * §3.6's window: "mismatch after a copy within 60 s".
 *
 * Long enough to cover copy → switch app → paste, short enough that a
 * deliberate send to a different address a few minutes after some unrelated
 * copy is not second-guessed.
 */
export const CLIPBOARD_WINDOW_MS = 60_000

export interface ClipboardCheck {
  readonly mismatch: boolean
  /** The address the wallet copied, when the record is still live; null otherwise. */
  readonly copied: Hex | null
}

/**
 * True when the wallet copied an address within the window and the recipient
 * is a different one.
 */
export function clipboardCheck(
  recipient: string,
  copied: CopiedAddress | null | undefined,
  now: number,
  windowMs: number = CLIPBOARD_WINDOW_MS,
): ClipboardCheck {
  if (!copied) return { mismatch: false, copied: null }
  const age = now - copied.at
  // A record from the future is a clock that moved, not evidence; ignore it.
  if (age < 0 || age > windowMs) return { mismatch: false, copied: null }
  return { mismatch: !sameAddress(recipient, copied.address), copied: copied.address }
}
