/**
 * Ignition is the *one* orchestrated enter (master plan §7.7): on unlock, the
 * plates arrive in sequence over 400 ms.
 *
 * It was running on every mount of Home instead. Home is a tab, and the shell
 * remounts a screen on every navigation, so the balance console, the action
 * grid and the status strip faded in one after another — at 0, 70, 140 and
 * 210 ms — every single time the popup opened or you came back to the tab.
 * That is the owner's "Some components also just appear out of no-where":
 * they were not appearing when their data arrived, they were being animated in
 * on a stagger, on top of whatever the data was doing.
 *
 * A ceremony that happens every time is not a ceremony. This hands out the
 * ignition exactly once per unlock; every later mount paints at once.
 */
let spent = false

/**
 * True the first time it is asked after an unlock, false after that. Locking
 * (or a still-unknown vault) rearms it.
 */
export function takeIgnition(unlocked: boolean): boolean {
  if (!unlocked) {
    spent = false
    return false
  }
  if (spent) return false
  spent = true
  return true
}

/** Tests and the harness: forget that the ignition was spent. */
export function rearmIgnition(): void {
  spent = false
}
