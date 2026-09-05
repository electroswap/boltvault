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
    files: ['packages/wallet/**/*.ts', 'packages/wallet/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['react-native', 'expo', 'expo-*'], message: 'packages/wallet composes @boltvault/ui primitives only (master plan §2.6).' }] }],
    },
  },
  {
    files: ['**/tests/**', '**/*.test.ts', '**/*.test.tsx', 'tools/**', 'packages/testing/**'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
)
