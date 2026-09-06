import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { defineConfig } from 'wxt'
import type { Plugin } from 'vite'

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
export default defineConfig({
  srcDir: '.',
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
    ...(browser === 'firefox' ? { browser_specific_settings: { gecko: { id: 'boltvault@electroswap.io', strict_min_version: '128.0' } } } : {}),
  }),
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
