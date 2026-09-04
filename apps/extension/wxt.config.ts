import { defineConfig } from 'wxt'

/**
 * WXT MV3 shell (T3.1).
 *
 * The extension ID is pinned via a private key so dApp allowlists + the
 * ElectroSwap GraphQL `X-BoltVault-Key` origin checks stay stable across builds.
 * Design C4: reuse the fork's ID `lfhdjnfgkkkljmpdeicibgfdpjfmfndd` *if ops
 * keeps the fork's key*; until ops hands over that private key, we pin a fresh
 * identity below (documented as an open question in the design). The ID this
 * key derives to is `ggmabmmmdnkckkpolkbbblbeoaoonpgf`.
 *
 * To swap in the fork's identity later, replace `manifest.key` with the fork's
 * base64 key — the ID will become `lfhdjnfgkkkljmpdeicibgfdpjfmfndd` and no
 * other code changes.
 */
export default defineConfig({
  manifest: {
    name: 'BoltVault',
    description:
      'One brain, two bodies, one face — Electroneum wallet + ElectroSwap uber-app.',
    version: '0.1.0',
    // Pinned identity → stable extension ID (see comment above).
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAszcj6eWrS7qV2fSKdV8Z23VNTrdvhUfuwu/MFh2l5JunYWDMm0JIw2Ez0E55ueD6uYiv3nev0s9JqpgW2MGpiw+vlAxg4+zAuJt287yUwOM+IrgJlmgGw1+wgcl128PUiXLyBWANFOnyfV7h/xerqPjr8eZSy8WBNBAPLqdO8/pY0iNrDakDsbHx/3RYdbzoXsTY9LuHfQjhFoT8PI2a++o24nWqPTeu8eV+Sm6Xi6FJnHoFw9+ExssWZ9s2eMXOZuM0hmEf3ykl0uML5r9M8UVWQvocU3XPBPuuVUD2uKekwYS6uIzMtNRgPl4vGd5Z64XUoaHmvHGXiJXbrAuJhQIDAQAB',
    // T3.4 needs to inject page-provider on every page + do cross-origin fetches.
    host_permissions: ['<all_urls>'],
    permissions: ['storage', 'contextMenus', 'offscreen', 'scripting'],
  },
})
