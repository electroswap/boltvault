# BoltVault

Electroneum wallet + ElectroSwap uber-app. **One brain, one face, three bodies.**

## Layout

```
apps/
  extension/      WXT MV3 (Chrome, Firefox) — react-native-web + Tamagui render the shared screens
  mobile/         Expo (iOS, Android) — the same screens, in-process engine
packages/
  engine/         THE BRAIN — WalletEngine API, host, transports, approvals, versioned storage
  platform/       OS capability interface + memory/extension implementations
  ui/             design tokens (§7.3), Tamagui config, interface-first primitives
  wallet/         feature screens, hooks, engine provider — shared by both apps
  core/           vault, HD derivation, accounts (kept from the prototype)
  chains/         chain registry, RPC failover clients, simulation (kept)
  testing/        mock JSON-RPC server, fixture dApp, fixture server
  …               remaining prototype packages, consolidated lazily (see tools/lint-debt.json)
tools/            registry-verify, abi-sync, no-any gate, lint-debt ledger
docs/             project documentation
```

## Commands

```bash
pnpm install
pnpm check                   # typecheck · lint · no-any · depcruise · unit tests · extension build
pnpm --filter @boltvault/extension build && pnpm --filter @boltvault/extension e2e   # Playwright popup smoke
pnpm --filter @boltvault/mobile bundle                                                # Metro export (Android)
pnpm --filter @boltvault/mobile start                                                 # Expo dev server
pnpm --filter @boltvault/mobile build:ios                                             # EAS builds the iOS .ipa (no Mac here)
pnpm registry:verify         # every RPC answers eth_chainId; multicall3 has code
pnpm abi:sync                # copy ABIs from ../../apps/interface/src/abis with a hashed manifest
```

Live tests (RPC, tokenlist, GraphQL) are skipped with `SKIP_LIVE=1`; CI always sets it.

## Rules enforced in CI

- No `any` (`pnpm no-any`, plus ESLint). Narrow `unknown` with zod at every boundary.
- Pure packages never import `chrome`, `browser`, `expo-*`, `react-native*` (ESLint + dependency-cruiser).
- `packages/wallet` composes `@boltvault/ui` primitives only, never `react-native` directly (keeps the DOM fallback possible).
- Code scheduled for rewrite is listed in `tools/lint-debt.json` with the milestone that retires it; an entry whose path no longer exists fails the build.

