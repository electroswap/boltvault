# External audit scope (master plan §3.7, §11 M10)

Scheduled from M8 so it does not gate 1.0; findings feed M10. This is the brief.

## In scope

| Area | Where | What to attack |
|---|---|---|
| Vault v2 and keyring | `packages/core/src/{vault2,hd,accounts}.ts` | KDF parameters, envelope AAD, wrap rotation, zeroisation, seed/passphrase handling, `mnemonicFromSeedHex` |
| Engine boundary | `packages/engine/src/{host,transport,wire}.ts`, `apps/extension/src/{port-channel,sender}.ts`, `entrypoints/background.ts` | sender classification, UI vs content ports, the no-raw-bytes assertion, approval id echo, decision replay, worker restart re-attachment |
| Provider and injection | `packages/protocol/src/{page-provider,bridge,rpc-flow,sessions}.ts`, `entrypoints/content-*.ts` | nonce handoff ordering, frozen provider, message spoofing from the page, per-origin session leakage, `document.hidden` queueing, MetaMask coexistence |
| Transaction firewall | `packages/security/src/*` | rule completeness vs the drainer corpus, severity monotonicity (simulation only adds), the UR/Permit2/Seaport decoders, fee-sink assertion (`FEE_SINK_MISMATCH`, `FEE_TIER_MISMATCH`), `device:` and `internal:` origins |
| Hardware signers | `packages/hardware/src/*` | APDU framing, `v` normalisation on every path, blind-signing coaching, Keystone request-id binding, Trezor result validation |
| Sync and remote sign | `packages/core/src/pairing.ts`, `packages/engine/src/namespaces/{sync,remote}.ts` | pairing MITM (SAS), record provenance and trust, replay, sign-only path never broadcasting, requester-side validation |
| Signed statics | `packages/core/src/statics.ts`, `packages/engine/src/namespaces/statics.ts` | signature verification, anti-rollback, "flags only disable", scam-list handling |
| Mobile secrets | `apps/mobile/src/platform.ts`, `device-key.ts` | Keychain/Keystore attributes, biometric gating, `allowBackup`, screenshot blocking, the App Group snapshot's contents |
| External transports | `packages/engine/src/namespaces/{dapps,connect}.ts`, `packages/connect/*`, `packages/wallet/src/screens/Browser.tsx` | origin from the committed URL only, Verify handling, chain alignment, WebView settings |
| Build and supply chain | `wxt.config.ts`, `tools/{build-manifest,sbom}.mjs`, `pnpm-workspace.yaml`, CI | CSP exactness, no eval, reproducibility, dependency policy |

## Out of scope

The ElectroSwap API and indexer (separate engagement), the Hyperlane and Seaport contracts, Trezor's hosted Connect page, WalletConnect's relay, the UI's visual design.

## Deliverables

Findings with severity and a reproduction; a re-test after fixes; a public summary for `https://wallet.electroswap.io/security`.

## Test fixtures the auditor gets

`packages/testing` (mock RPC, fixture dApp), the fakes for every device (`FakeLedgerDevice`, `FakeTrezorConnect`, `FakeKeystone`, `FakeWalletKit`), the drainer calldata fixtures under `packages/security/tests`, and the Playwright harness.
