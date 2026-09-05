import type { LinguiConfig } from '@lingui/conf'

/** Master plan §7.14 — Lingui from M1; `en` is the source locale. */
const config: LinguiConfig = {
  locales: ['en', 'pt-BR', 'tr', 'hi', 'es'],
  sourceLocale: 'en',
  catalogs: [{ path: '<rootDir>/packages/wallet/locales/{locale}/messages', include: ['<rootDir>/packages/wallet/src'] }],
  format: 'po',
}

export default config
