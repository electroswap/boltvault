/**
 * The four URLs the wallet sends people to, pinned.
 *
 * They pointed at `wallet.electroswap.io` — a host that has never existed — for
 * the life of the product, and nothing caught it, because a dead link opens a
 * browser tab and an error page rather than failing a build. The store listing
 * quoted the same URL as its support link, which is the one a reviewer clicks.
 *
 * A test is the only thing that notices. These four strings are a contract with
 * a *different repository*: the pages live in `electroswap/docs` under
 * `docs/boltvault/`, and two of the four depend on a heading id there
 * (`{#sbom}`, and Install's `## Extension`). A renamed heading over there is a
 * button that scrolls nowhere over here, and neither build would say a word.
 *
 * So: if you change one of these, change the page, and if you change a page's
 * heading, change this. That is the whole point of the test.
 */
import { describe, expect, it } from 'vitest'
import { docsLinks, ISSUES_URL } from '../src/docsLinks'

const BASE = 'https://electroswap.io/docs/boltvault'

describe('the documentation links the wallet opens', () => {
  it('are the pages that exist, on the site that exists', () => {
    expect(docsLinks).toEqual({
      security: `${BASE}/security`,
      sbom: `${BASE}/security#sbom`,
      install: `${BASE}/install`,
      installExtension: `${BASE}/install#extension`,
    })
  })

  it('names no host that has to be stood up first', () => {
    for (const url of Object.values(docsLinks)) {
      expect(new URL(url).host).toBe('electroswap.io')
      // The dead host, by name, so a revert is loud.
      expect(url).not.toContain('wallet.electroswap.io')
    }
  })

  /*
    The fragments are the fragile half. A URL with no fragment lands at the top
    of the right page and nobody notices it was meant to land lower; a fragment
    naming a heading that has been renamed does the same thing silently.
  */
  it('asks for the two anchors the docs set explicitly', () => {
    expect(new URL(docsLinks.sbom).hash).toBe('#sbom')
    expect(new URL(docsLinks.installExtension).hash).toBe('#extension')
    // Each fragment hangs off the page that defines it, not a neighbour.
    expect(docsLinks.sbom.startsWith(`${docsLinks.security}#`)).toBe(true)
    expect(docsLinks.installExtension.startsWith(`${docsLinks.install}#`)).toBe(true)
  })

  it('opens the issue tracker for a problem report, not an email client', () => {
    expect(ISSUES_URL).toBe('https://github.com/ElectroSwap/boltvault/issues')
  })

  /* Every one of them passes the gate that a link from the API would have to. */
  it('would survive the outbound-link check even though it does not run one', () => {
    for (const url of [...Object.values(docsLinks), ISSUES_URL]) {
      const parsed = new URL(url)
      expect(parsed.protocol).toBe('https:')
      expect(parsed.username).toBe('')
      expect(parsed.password).toBe('')
    }
  })
})
