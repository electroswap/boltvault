# BoltVault

Electroneum wallet + ElectroSwap uber-app. **One brain, two bodies, one face.**

- **Brain** — `packages/*` (TypeScript: vault, chains, catalog, electroswap, core, history)
- **Bodies** — `apps/extension` (WXT MV3) + `apps/mobile` (Expo RN)
- **Face** — `packages/design` (Chamber tokens + primitives)

## Layout

```
apps/
  extension/          # WXT MV3 (Chrome/Firefox)
  mobile/             # Expo RN (iOS/Android) — parity last
packages/
  core/               # types: vault, accounts, sites, history, settings
  chains/             # chain registry, viem clients, multicall3, gas
  token-catalog/      # per-chain token lists, custom tokens, logo pipeline
  electroswap/        # GraphQL + ETN tokenlist + swap/NFT/farm/launchpad/hyperlane
  history/            # encrypted local log
  design/             # Chamber design tokens + primitives
```

## Dev

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm ci            # typecheck + test + extension build
```
