/** Layering rules from master plan §2.3. Run: pnpm depcruise */
const PURE = '^packages/(core|chains|engine|electroswap|security|protocol|provider-protocol|tokens|token-catalog|market-data|portfolio|send|token-info|approvals|activity|settings|history|other-chain|swap|farm|launchpad|nft|adapters|hardware|ledger|trezor|passkey|connect|wc)/'

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'pure-packages-no-host-apis',
      comment: 'Only apps/* and platform adapters touch chrome/expo/react-native (§2.3).',
      severity: 'error',
      from: { path: PURE },
      to: { path: '^node_modules/(expo|expo-[^/]+|react-native|react-native-[^/]+|@react-native|webextension-polyfill|wxt)(/|$)' },
    },
    {
      name: 'wallet-uses-ui-not-react-native',
      comment: 'packages/wallet composes @boltvault/ui primitives so the DOM fallback stays possible (§2.6).',
      severity: 'error',
      from: { path: '^packages/wallet/' },
      to: { path: '^node_modules/(react-native|expo|expo-[^/]+)(/|$)' },
    },
    {
      name: 'ui-consumers-not-engine-internals',
      comment: 'packages/wallet reaches the engine only through the WalletEngine contract (§2.3).',
      severity: 'error',
      from: { path: '^packages/wallet/' },
      to: { path: '^packages/engine/src/(namespaces|create|host|approvals|settingsStore)' },
    },
    {
      name: 'electroswap-only-for-etn',
      comment: 'Nothing outside the ElectroSwap package constructs GraphQL clients (§2.7 S11).',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/(electroswap|engine)/' },
      to: { path: '^node_modules/graphql-request(/|$)' },
    },
    {
      name: 'no-buffer-in-packages',
      comment: 'Uint8Array only in packages; Buffer polyfill lives in apps/* (§2.7 S10).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^node_modules/buffer(/|$)' },
    },
    {
      name: 'no-orphans',
      comment: 'A module nobody imports is the rev 7 failure mode. Entry points and configs are exempt.',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.(test|spec)\\.(ts|tsx)$', '(^|/)index\\.ts$', '(^|/)(vitest|wxt|metro|babel|app)\\.config\\.(ts|js|mjs|cjs)$', '^apps/', '^tools/', '\\.d\\.ts$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|\\.output|\\.wxt|\\.expo|coverage|screenshots|fixtures)(/|$)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'default', 'types'], extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
