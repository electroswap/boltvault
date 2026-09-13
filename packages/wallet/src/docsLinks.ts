/**
 * Every documentation URL the wallet sends people to, in one place.
 *
 * They used to be three unrelated strings — a file-local constant in About, an
 * inline ternary in UpdateRequired — all pointing at `wallet.electroswap.io`,
 * a host that has never existed. Nothing failed loudly: a dead link opens a
 * browser tab and an error page, so the only way to notice was to tap one. The
 * Chrome Web Store listing quoted the same URL as its support link, which is
 * the one a reviewer clicks first.
 *
 * The docs live on the documentation site, at `electroswap.io/docs/boltvault`.
 * The pages are `unlisted` there until the wallet ships — out of the sidebar,
 * out of search, out of the sitemap, but answering at their URLs, which is
 * what these links need.
 *
 * Two of these carry a fragment, and the fragment is load-bearing: the pages
 * set those heading ids explicitly (`{#sbom}`, and Install's `## Extension`)
 * precisely because a shipped build already asks for them. Renaming a heading
 * there breaks a button here, so `docs-links.test.ts` pins all four.
 *
 * These are first-party constants, so they open through `host.openUrl` rather
 * than `useSafeOpen`: that gate exists for strings the API supplies (ES-BV-035),
 * and running a hardcoded URL past a scam-list check buys nothing.
 */
const DOCS = 'https://electroswap.io/docs/boltvault'

export const docsLinks = {
  /** Settings › About → "Security policy & audits". */
  security: `${DOCS}/security`,
  /** Settings › About → "Software bill of materials". */
  sbom: `${DOCS}/security#sbom`,
  /** The forced-update interstitial, on a phone. */
  install: `${DOCS}/install`,
  /** The same interstitial in the extension, which needs the browser section. */
  installExtension: `${DOCS}/install#extension`,
} as const

/** Settings › About → "Report a problem". Not documentation, but the third button beside them. */
export const ISSUES_URL = 'https://github.com/ElectroSwap/boltvault/issues'
