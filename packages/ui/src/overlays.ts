/**
 * What the hardware back button should dismiss before it navigates.
 *
 * Android's back press has to mean "undo the last thing that appeared". A
 * sheet is the last thing that appeared far more often than a route is, so the
 * shell needs to know one is open without every screen reporting it.
 *
 * `Sheet` registers itself here while it is open, which covers every sheet in
 * the product from one place. Newest closes first, and unmounting always
 * deregisters, so a sheet that goes away cannot leave back swallowing presses.
 */
type Close = () => void

const open: Array<{ readonly id: number; readonly close: Close }> = []
let nextId = 1

/** Registers an open overlay; call the returned function when it closes. */
export function registerOverlay(close: Close): () => void {
  const id = nextId++
  open.push({ id, close })
  return () => {
    const at = open.findIndex((o) => o.id === id)
    if (at !== -1) open.splice(at, 1)
  }
}

/** Closes the newest overlay. False when there was none to close. */
export function closeTopOverlay(): boolean {
  const top = open[open.length - 1]
  if (top === undefined) return false
  top.close()
  return true
}

/** Whether anything is currently over the screen. */
export function hasOverlay(): boolean {
  return open.length > 0
}
