// ESLint — the layering and typing rules from master plan §2.3, enforced.
//
// - `any` is an error everywhere (owner rule).
// - Pure packages may not import host APIs (chrome/browser globals, expo-*,
//   react-native*, wxt). Only apps/* and the platform adapters may.
// - packages/wallet composes @boltvault/ui primitives and never imports
//   react-native directly, so the DOM fallback (§2.6) stays possible.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { existsSync, readFileSync } from 'node:fs'

const HOST_IMPORTS = ['expo', 'expo-*', 'react-native', 'react-native-*', '@react-native/*', 'webextension-polyfill', 'wxt', 'wxt/*', '#imports']

// Prototype code scheduled for rewrite (tools/lint-debt.json). Each entry names
// the milestone that retires it; a listed path that no longer exists fails the
// config load so the entry cannot outlive the rewrite.
const debt = JSON.parse(readFileSync(new URL('./tools/lint-debt.json', import.meta.url), 'utf8'))
for (const e of debt.entries) {
  if (!existsSync(new URL(`./${e.path}`, import.meta.url))) throw new Error(`lint-debt entry no longer exists — remove it: ${e.path}`)
}
const DEBT_GLOBS = debt.entries.map((e) => `${e.path}/**`)

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/screenshots/**',
      '**/fixtures/**',
      'docs/**',
      '**/*.d.ts',
      ...DEBT_GLOBS,
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2022 } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Use platform.random(); Math.random is never acceptable for anything security-adjacent.' },
      ],
    },
  },
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    ignores: ['packages/platform/src/extension.ts', 'packages/ui/**', 'packages/wallet/**', 'packages/testing/**', '**/tests/**'],
    rules: {
      'no-restricted-globals': ['error', 'chrome', 'browser'],
      'no-restricted-imports': ['error', { patterns: [{ group: HOST_IMPORTS, message: 'Only apps/* and platform adapters may touch host APIs (master plan §2.3).' }] }],
    },
  },
  {
    /*
      The session DEK is one `chrome.storage.session` read away from any code
      running in a trusted extension page (ES-BV-051).

      The restriction above exempts `packages/wallet` and `packages/ui` — they
      are shared with the phone and have no business touching a host API — but
      it did not cover the extension's own page entrypoints, which run in the
      same trusted origin as the popup and can read the key straight out of
      session storage. No page code does today. This is the rule that keeps it
      that way: pages talk to the worker over the port, and only the worker and
      the platform adapter touch storage.
    */
    files: ['apps/extension/entrypoints/**/*.ts', 'apps/extension/entrypoints/**/*.tsx', 'apps/extension/src/**/*.ts', 'apps/extension/src/**/*.tsx'],
    ignores: ['apps/extension/entrypoints/background.ts', 'apps/extension/entrypoints/*.content.ts', 'apps/extension/src/platform.ts', 'apps/extension/src/port-channel.ts', 'apps/extension/src/ui-host.ts', 'apps/extension/src/sender.ts', 'apps/extension/src/crash.ts', 'apps/extension/src/trezor.ts', '**/tests/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name=/^(chrome|browser)$/][object.property.name='storage']",
          message: 'A page does not read extension storage: the session DEK lives there (ES-BV-051). Ask the worker over the port.',
        },
      ],
    },
  },
  {
    /*
      A content script is not a page, and `storage.local` is not the DEK.

      The rule above bans every storage namespace outright, which is right for
      the trusted pages it covers — they share an origin with the popup, so
      `storage.session` is one call away from them, and "ask the worker" costs
      nothing. Applied to `content-isolated.content.ts` it banned something
      else: the `bv:local:settings` read that tells the injected provider
      whether `metaMaskCompat` and `defaultWallet` are on. That read is
      deliberate and has already been fixed once (it looked up the bare key
      instead of the prefixed one and therefore never fired), and moving it to
      the port would mean opening a port at `document_start` on every page in
      the browser to fetch two booleans.

      Neither half of the rule's reasoning reaches it. A content script runs in
      an isolated world in the page's process, not the extension's trusted
      origin; and `chrome.storage.session` defaults to TRUSTED_CONTEXTS, so a
      content script cannot read the DEK's home even if it asks. What is left
      worth banning is exactly that — `storage.session` — and it stays banned
      here, so a later `setAccessLevel` change cannot quietly make this the
      hole the original rule was written to prevent.
    */
    files: ['apps/extension/entrypoints/*.content.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name=/^(chrome|browser)$/][object.property.name='storage'][property.name='session']",
          message: 'A content script never touches session storage: the DEK lives there (ES-BV-051). storage.local is fine.',
        },
      ],
    },
  },
  {
    files: ['packages/wallet/**/*.ts', 'packages/wallet/**/*.tsx'],
    rules: {
      // `react-native-*` matters as much as `react-native` itself: the whole
      // point of the seam is that a native module reaches the screens through
      // a `@boltvault/ui` primitive with a web half, and `react-native-webview`
      // imported here would compile into the extension.
      'no-restricted-imports': ['error', { patterns: [{ group: ['react-native', 'react-native-*', '@react-native/*', 'expo', 'expo-*'], message: 'packages/wallet composes @boltvault/ui primitives only (master plan §2.6).' }] }],
    },
  },
  {
    /*
      The extension is already a browser; it must never bundle one.

      dependency-cruiser carries the same rule, but it can only see an import
      it can resolve — and `react-native-webview` is not a dependency of this
      workspace, so the import it is meant to catch resolves to nothing and
      passes. ESLint matches the specifier as written, which is what the
      mistake actually looks like: someone reaches for the WebView in the
      extension's own code and finds out here rather than at review.
    */
    files: ['apps/extension/**/*.ts', 'apps/extension/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['react-native', 'react-native-*', '@react-native/*'], message: 'apps/extension runs inside a browser and never bundles one — the WebView is the phone’s (master plan §5.3).' }] }],
    },
  },
  {
    files: ['**/tests/**', '**/e2e/**', '**/*.test.ts', '**/*.test.tsx', 'tools/**', 'packages/testing/**'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    // Metro/Babel configs are CommonJS by contract with their loaders.
    files: ['**/metro.config.js', '**/babel.config.js', '**/*.config.cjs', '.dependency-cruiser.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
