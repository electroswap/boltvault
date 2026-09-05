# BoltVault contracts

Two small, view-heavy contracts from the master plan (§8.18, §9.7). Both are
owned by the ops multisig (two-step ownership). Deployment is an ops action —
the wallet ships the addresses as build constants (`BOLTVAULT_FEE_SINK`,
`BOLTVAULT_FEE_SCHEDULE` in `packages/chains/src/electroneum.ts`) and refuses
to swap in-wallet when the encoded fee does not match them.

| Contract | Purpose |
|---|---|
| `BoltVaultFeeSink` | Receives the `PAY_PORTION` of every in-wallet swap. `sweep(token,to,amount)`, `sweepETN`, `receive()`. |
| `BoltVaultFeeSchedule` | `feeBipsFor(account) → (bips, tier, score)` and `schedule()`. Score = BOLT balance + farm-deposited BOLT (when counted) + DYNO × `dynoWeight` / 1e18 (`dynoWeight` is BOLT-eq per DYNO, 18-decimal). Base 50 bips (0.5 %), tiers ascending by score, no tier above the base, a 0-bips tier is explicit (the wallet omits `PAY_PORTION`). |

```
forge test                                     # unit tests (forge-std vendored under lib/)
OWNER=0x… BOLT=0x… DYNO=0x… FARM=0x… \
forge script script/Deploy.s.sol --rpc-url electroneum_testnet --broadcast
```

The deploy script sets the owner's defaults (decided 2026-09-05 on USD prices, 1 BOLT = $0.00185 and
1 DYNO = $1.62): tiers at 13,600 / 136,000 / 680,000 / 1,360,000 BOLT-eq (≈ $25 / $250 / $1,250 / $2,500 of
BOLT + DYNO combined) for 0.40 / 0.30 / 0.20 / 0.10 %, base 0.50 %, and 1 DYNO = 875.68 BOLT-eq. Prices move;
the owner re-tunes with `setTiers` / `setDynoWeight` — no wallet release.

After a deploy: put the addresses in `packages/chains/src/electroneum.ts`,
run the fork test (`SKIP_LIVE` off) that asserts the sink receives exactly the
tier's bips ± 1 wei, and mirror the base bips into the signed
`wallet/fees.json` (§9.4) as the fail-safe.
