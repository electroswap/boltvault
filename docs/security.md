# BoltVault security policy

BoltVault is ElectroSwap's self-custodial wallet for Electroneum and the major EVM chains, shipped as a browser extension (Chrome, Firefox) and a phone app (Android, iOS) from one codebase. This page is what we promise, what we defend against, and how to reach us.

## Reporting a vulnerability

Email **security@electroswap.io** (PGP key published at `https://wallet.electroswap.io/security/pgp.txt`). Please include a proof of concept and the version (Settings › About). We acknowledge within 2 business days, triage within 7, and publish a fix and a credit with your consent. Do not test against other people's accounts or the production API beyond what a proof of concept needs.

**Bug bounty.** In scope: key or seed extraction, signing without the user's decision, bypassing the transaction firewall's `block` class, origin spoofing between sites, sync-channel plaintext exposure, the injected provider reaching the extension's privileged context, and remote code execution in any body. Out of scope: social engineering, issues in third-party services (Trezor Connect's hosted page, WalletConnect's relay), denial of service, and findings that need a compromised device or browser. Rewards scale with impact; critical findings on custody start at 5,000 USDC.

## What we defend against (short form of master plan §3.1)

| Threat | Controls |
|---|---|
| Malicious dApp gets a signature the user did not understand | decode → simulate → assess → explain on every signature, every body, every origin; `block` classes cannot be signed by any UI; per-origin sessions; permit-family rules with drainer fixtures |
| A web page reaching the privileged context | MV3 CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; sender validation on every Port; frozen provider; per-load channel nonce; no `externally_connectable`; approval windows with delayed enable |
| Key extraction | keys never cross the UI channel (a runtime assertion refuses raw bytes on it); the DEK lives in the engine process only; the vault is Argon2id + XChaCha20-Poly1305 (`VaultFileV2`); seeds render only in the full tab / on the phone with screenshots blocked |
| Supply chain | no remote code in our origin (the one exception is Trezor's hosted `connect.trezor.io` page, in Trezor's origin, pinned); pinned exact dependencies, a 7-day minimum release age, build scripts disabled except esbuild; a CycloneDX SBOM per release; a reproducible extension build with a published hash; Renovate with grouped weekly updates and OSV alerts |
| Address poisoning, clipboard hijack, lookalike names | first-seen registry, 4+4 lookalike block, paste-vs-copied mismatch alert, `.etn`/`.eth` forward verification, never a name for a contract |
| Phishing origins | a signed scam-origin list (ed25519, key baked in), typosquat scoring against the protected set, "first time on this site" step |
| Stale or lying data | RPC is the only quantity source; ElectroSwap's API and price feeds are display only; divergence drops fiat, never the balance |
| Fee-sink redirection | sink and schedule addresses pinned in the binary; the decoder refuses a swap whose `PAY_PORTION` is not the pinned sink at the schedule's bips |

## Kill-switches

`https://static.electroswap.io/wallet/flags.json` (+ `.sig`) can switch off in-wallet swaps, limit orders, the bridge or one corridor, the launchpad, the marketplace or farms, and can require a minimum version. Flags are ed25519-signed, refused when unsigned or older than the file already held, and can only *disable* — nothing remote can turn a feature on or change behaviour.

## Cryptography

secp256k1 (`@noble/curves`), SHA-256/Keccak/HKDF (`@noble/hashes`), XChaCha20-Poly1305 (`@noble/ciphers`), Argon2id (`hash-wasm` in the extension worker, libsodium on the phone — byte-identical vectors in CI), ed25519/X25519 for device pairing and signed statics, BIP-32/39 (`@scure`). No `node:crypto`, no `Math.random` anywhere near a secret (lint-enforced).

## Audits

The external audit (extension + engine + mobile secret module) is scheduled from M8 (master plan §11); reports are published at `https://wallet.electroswap.io/security` with the SBOM and the build hash of each release.
