# BoltVault contracts

Two small, view-heavy contracts from the master plan (§8.18, §9.7). Both are
owned by the ops multisig (two-step ownership). Deployment is an ops action —
the wallet ships the addresses as build constants (`BOLTVAULT_FEE_SINK`,
`BOLTVAULT_FEE_SCHEDULE` in `packages/chains/src/electroneum.ts`) and refuses
to swap in-wallet when the encoded fee does not match them.

| Contract | Purpose |
|---|---|
| `BoltVaultFeeSink` | Receives the `PAY_PORTION` of every in-wallet swap. `sweep(token,to,amount)`, `sweepETN`, `receive()`. |
| `BoltVaultFeeSchedule` | `feeBipsFor(account) → (bips, tier, score)` and `schedule()`. Score = BOLT balance + farm-deposited BOLT (when counted) + DYNO / `dynoWeight`. Base 50 bips (0.5 %), tiers ascending by score, no tier above the base, a 0-bips tier is explicit (the wallet omits `PAY_PORTION`). |

```
forge test                                     # unit tests (forge-std vendored under lib/)
OWNER=0x… BOLT=0x… DYNO=0x… FARM=0x… \
forge script script/Deploy.s.sol --rpc-url electroneum_testnet --broadcast
```

After a deploy: put the addresses in `packages/chains/src/electroneum.ts`,
run the fork test (`SKIP_LIVE` off) that asserts the sink receives exactly the
tier's bips ± 1 wei, and mirror the base bips into the signed
`wallet/fees.json` (§9.4) as the fail-safe.
