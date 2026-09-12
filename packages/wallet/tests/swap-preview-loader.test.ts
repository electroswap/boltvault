/**
 * The ES overlay on Swap: from the key to the signing preview, no gap.
 *
 * Clicking a collection row covers the destination until it is painted
 * (`useScreenBusy` + TabShell's `PageLoader overlay`). Swap used to clear
 * `busy` the moment `execute` resolved, so the overlay lifted onto the
 * "Swapping…" panel for the beat before the signing sheet existed. What is
 * pinned:
 *
 *  1. Swap reports busy from the click and keeps it on a successful start.
 *  2. The signing sheet reports busy until it has a request to show.
 *  3. The shell keeps the overlay up during the screen-enter fade — hiding
 *     it for those 150 ms was a flash of the half-built sheet.
 *
 * Read as text: screens pull in the whole UI and these suites run in plain
 * node where Reanimated cannot load.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8')

const SWAP = read('screens/Swap.tsx')
const APPROVAL = read('screens/Approval.tsx')
const SHELL = read('navigation/TabShell.tsx')
const BUSY = read('state/useScreenBusy.ts')

describe('Swap covers the wait with the ES overlay', () => {
  it('reports busy from the click and does not clear it on a successful start', () => {
    expect(SWAP).toContain("useScreenBusy('swap', busy)")
    expect(SWAP).toContain('if (!r.requestId) setBusy(false)')
    expect(SWAP).toContain('setBusy(false)')
    // Success must not take the finally-clear path — that was the flash.
    expect(SWAP).not.toMatch(/finally\s*\{\s*setBusy\(false\)/)
  })

  it('the signing sheet holds the overlay until the preview can paint', () => {
    expect(APPROVAL).toContain("useScreenBusy('sign'")
    expect(APPROVAL).toContain('Boolean(requestId) && (!loaded || !request || !payload)')
    expect(APPROVAL).toContain('testID="approval"')
  })

  it('the shell keeps the overlay up during the screen-enter fade', () => {
    expect(SHELL).toContain('{busy && !takeover ? <PageLoader overlay reducedMotion={reducedMotion} testID="page-loading" /> : null}')
    expect(SHELL).not.toContain('!fading')
  })

  it('registers during render so a replacing screen never drops the overlay', () => {
    expect(BUSY).toContain('if (isBusy) busy.add(id)')
    expect(BUSY).toContain('useLayoutEffect')
  })
})
