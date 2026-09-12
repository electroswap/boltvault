import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'wxt'
import type { Plugin } from 'vite'
import { buildPageProvider } from '../../tools/build-page-provider.mjs'

/**
 * Prebuilt dependencies (the Keystone UR registry, Trezor Connect) carry
 * webpack's global getter `new Function("return this")()` inside a try/catch.
 * Under our CSP it would throw and fall back anyway; rewriting it to
 * `globalThis` keeps the output free of `new Function` (the M1 gate) instead
 * of merely never calling it.
 */
function noFunctionGlobal(): Plugin {
  return {
    name: 'boltvault-no-function-global',
    enforce: 'post',
    transform(code, id) {
      if (!id.includes('node_modules') || !code.includes('Function("return this")')) return null
      return { code: code.replaceAll('new Function("return this")()', 'globalThis').replaceAll('Function("return this")()', 'globalThis'), map: null }
    },
  }
}

// Resolve react-native-web once, from this app, so workspace packages that
// import `react-native` (packages/ui) get the web implementation regardless
// of pnpm's per-package node_modules.
const require = createRequire(import.meta.url)
const RNW_DIR = dirname(require.resolve('react-native-web/package.json'))

/**
 * WXT MV3 shell (master plan §2.1, §3.5).
 *
 * - Pages: popup (360×600), tab (full theater), sign (approval window, M3).
 * - CSP: exactly `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`.
 *   No offscreen document, no remote code, no externally_connectable.
 * - The extension ID is pinned through `manifest.key`. The fork's ID is NOT
 *   reused (owner decision §13.2 #5); this key derives to a fresh identity
 *   that the ElectroSwap API allow-lists alongside the wallet key (§9.1).
 * - react-native-web + Tamagui render the shared screens; `react-native` is
 *   aliased to `react-native-web` for the whole bundle.
 */
/*
  A release build says so or does not build (ES-BV-044).

  `__DEV__`, `NODE_ENV` and `__API_ORIGIN__` all come from the ambient
  environment, and `.env.example` names a cleartext localhost origin as the
  template value — so a store package built from a developer's shell could
  carry a development React build pointed at a local API, and nothing said so.
  `BOLTVAULT_HARNESS=0` is what `pnpm build:release` sets, and it is taken here
  to mean "this one is going to a store".
*/
function assertReleaseSane(): void {
  if (process.env['BOLTVAULT_HARNESS'] !== '0') return
  const origin = (process.env['WXT_BOLTVAULT_API'] ?? 'https://electroswap.io').replace(/\/+$/, '')
  if (!origin.startsWith('https://'))
    throw new Error(`A release build needs an https API origin; WXT_BOLTVAULT_API is "${origin}".`)
  if ((process.env['NODE_ENV'] ?? 'production') !== 'production')
    throw new Error(`A release build needs NODE_ENV=production; it is "${process.env['NODE_ENV'] ?? ''}".`)
  if (process.env['BOLTVAULT_HARNESS_BUILD'] === '1')
    throw new Error('BOLTVAULT_HARNESS_BUILD=1 and BOLTVAULT_HARNESS=0 are contradictory.')
}
assertReleaseSane()

export default defineConfig({
  srcDir: '.',
  /*
    The screenshot harness is a development surface, and it was shipping.

    `harness.html` and its chunk are 45 KB gzipped — the fixture engine, every
    screen's fixture data and the scenario switcher — and they were in the
    release manifest as a web-accessible resource, gated by nothing. No user can
    reach anything useful through it (the fixtures are an offline engine holding
    the public `abandon…about` test vector), but it is 45 KB nobody downloads for
    a reason, and one more page in the attack surface than the product needs.

    Excluded from a release build only. `pnpm build` still produces it, because
    `e2e/screens.spec.ts`, `e2e/sizing.spec.ts`, `e2e/shot.spec.ts`,
    `e2e/radii.spec.ts`, `e2e/coldstart.spec.ts` and `e2e/landing-shots.mjs` all
    navigate to `harness.html` — taking it out of the default build would break
    the screenshot loop rather than the release.
  */
  filterEntrypoints: process.env['BOLTVAULT_HARNESS'] === '0' ? ['background', 'content-isolated', 'content-main', 'popup', 'sign', 'tab'] : undefined,
  /*
    CI has to hold both properties at once: the artifact that ships carries no
    harness page, and the visual-regression specs still have one to point a
    browser at. One build cannot do both, so CI makes two — and they must not
    overwrite each other.

    `.output/chrome-mv3` stays the release artifact, because tools/zip-store.mjs,
    tools/build-manifest.mjs, the reproducible-build hash and every product spec
    already name it. `BOLTVAULT_HARNESS_BUILD=1` (see `pnpm build:harness`) puts
    the harness build in a suffixed sibling, `.output/chrome-mv3-harness`
    instead. WXT clears only the directory it is about to write, so the two
    builds never touch each other's output, and the sibling is still under the
    already-ignored `.output`.
  */
  outDirTemplate: process.env['BOLTVAULT_HARNESS_BUILD'] === '1' ? '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}-harness' : undefined,
  // Firefox 128+ is MV3 too: an event page instead of a worker, the same CSP (§4.7).
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'BoltVault',
    description: 'The Electroneum wallet and ElectroSwap uber-app.',
    version: '0.1.0',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAszcj6eWrS7qV2fSKdV8Z23VNTrdvhUfuwu/MFh2l5JunYWDMm0JIw2Ez0E55ueD6uYiv3nev0s9JqpgW2MGpiw+vlAxg4+zAuJt287yUwOM+IrgJlmgGw1+wgcl128PUiXLyBWANFOnyfV7h/xerqPjr8eZSy8WBNBAPLqdO8/pY0iNrDakDsbHx/3RYdbzoXsTY9LuHfQjhFoT8PI2a++o24nWqPTeu8eV+Sm6Xi6FJnHoFw9+ExssWZ9s2eMXOZuM0hmEf3ykl0uML5r9M8UVWQvocU3XPBPuuVUD2uKekwYS6uIzMtNRgPl4vGd5Z64XUoaHmvHGXiJXbrAuJhQIDAQAB',
    minimum_chrome_version: '117',
    // `scripting` is not used by our own code — but it is not unused. Bundled
    // @trezor/connect-webextension calls chrome.permissions.getAll() and only
    // injects its content script into the connect.trezor.io popup when
    // `scripting` is present; without it, it silently takes a no-op branch and
    // Trezor pairing breaks with no error. The MAIN-world provider is injected
    // by the manifest (`world: 'MAIN'`), never by chrome.scripting.
    permissions: ['storage', 'alarms', 'scripting', 'notifications', 'activeTab'],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    action: { default_title: 'BoltVault' },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: { gecko: { id: 'boltvault@electroswap.io', strict_min_version: '128.0' } },
          /*
            The AMO fallback's provider script (§4.7), and the one crack in
            §3.5's "web_accessible_resources empty".

            The trade, stated plainly: a web-accessible resource is reachable
            from any page that knows the extension's origin, so on a page where
            the fallback fires, `moz-extension://<uuid>/page-provider.js` shows
            up as a subresource and the per-install UUID becomes learnable by
            that page. That is a fingerprinting surface the Chrome build does
            not have — which is exactly why this key exists only on the Firefox
            manifest, where the fallback is the difference between a wallet and
            no wallet. Chrome ≥ 117 honours `world: 'MAIN'` in the manifest
            unconditionally, so its build keeps the property intact and ships no
            web-accessible resource at all.

            Scoped as tightly as Gecko allows: one file, and only to http(s)
            pages — the same set the content scripts already match, and the only
            set that can ever need it. Chrome's `use_dynamic_url` (a per-session
            resource URL) would narrow it further but is not implemented in
            Firefox; Firefox's own per-install random `moz-extension://<uuid>`
            origin is the equivalent defence, and it is why the leak above is an
            install-scoped identifier rather than a constant that identifies
            BoltVault users to everyone.
          */
          web_accessible_resources: [{ resources: ['page-provider.js'], matches: ['http://*/*', 'https://*/*'] }],
        }
      : {}),
  }),
  hooks: {
    /*
      `page-provider.js`, the self-contained IIFE the isolated bridge injects
      when a browser rejects the manifest's MAIN-world content script (§4.7).
      Built by the same tool and from the same `packages/protocol` source as the
      phone's copy, so the three bodies cannot drift; the tool holds the 25 KB
      budget and the no-eval gate (§4.2).

      Emitted only where it is declared web-accessible. A file nobody can load
      is dead weight in the Chrome artifact and one more thing in the
      reproducible-build hash.
    */
    'build:publicAssets': async (wxt, files) => {
      if (wxt.config.browser !== 'firefox') return
      files.push({ relativeDest: 'page-provider.js', contents: await buildPageProvider('extension') })
    },
  },
  vite: () => ({
    plugins: [react(), noFunctionGlobal()],
    resolve: {
      alias: [
        { find: /^react-native$/, replacement: RNW_DIR },
        { find: /^react-native\/(.*)$/, replacement: `${RNW_DIR}/$1` },
      ],
      extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
      mainFields: ['browser', 'module', 'main'],
    },
    define: {
      global: 'globalThis',
      __DEV__: JSON.stringify(process.env['NODE_ENV'] !== 'production'),
      'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] ?? 'production'),
      'process.env.TAMAGUI_TARGET': JSON.stringify('web'),
      __BUILD_HASH__: JSON.stringify(process.env['BUILD_HASH'] ?? ''),
      // Development builds: point the API at a local services/api, turn optional surfaces on.
      __API_ORIGIN__: JSON.stringify((process.env['WXT_BOLTVAULT_API'] ?? 'https://electroswap.io').replace(/\/+$/, '')),
      __LIMIT_ORDERS__: JSON.stringify(process.env['WXT_BOLTVAULT_LIMIT_ORDERS'] === '1'),
      /*
        The routing service (§8.6). Empty means "derive it from the API origin",
        which is right for every release — ElectroSwap mounts the quoter at
        `/routing/quote` on the same host. A local quoter serves the same handler
        at `http://localhost:3007/api/quote`, which is not a path the origin
        implies, so a dev build has to name it outright.
      */
      __QUOTER_URL__: JSON.stringify(process.env['WXT_QUOTER_URL'] ?? ''),
      /*
        The wallet key (§9.1). A client identifier, not a secret — every
        install ships the same one — so it buys access, not trust, and every
        bound that matters is applied by the API regardless of it. Empty means
        "no key": the engine then talks to the public price feed directly
        instead of our proxy, which is the documented fallback.
      */
      __WALLET_KEY__: JSON.stringify(process.env['WXT_BOLTVAULT_KEY'] ?? ''),
    },
    optimizeDeps: {
      esbuildOptions: { loader: { '.js': 'jsx' }, resolveExtensions: ['.web.js', '.js', '.ts', '.tsx'] },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  }),
})
