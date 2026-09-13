# BoltVault security policy

BoltVault is ElectroSwap's self-custodial wallet for Electroneum and the major EVM chains, shipped as a browser extension (Chrome, Firefox) and a phone app (Android, iOS) from one codebase. This page is what we promise, what we defend against, and how to reach us.

## Reporting a vulnerability

Email **security@electroswap.io** (ask for the key in your first message; it is not published yet). Please include a proof of concept and the version (Settings › About). We acknowledge within 2 business days, triage within 7, and publish a fix and a credit with your consent. Do not test against other people's accounts or the production API beyond what a proof of concept needs.

**Bug bounty.** In scope: key or seed extraction, signing without the user's decision, bypassing the transaction firewall's `block` class, origin spoofing between sites, sync-channel plaintext exposure, the injected provider reaching the extension's privileged context, and remote code execution in any body. Out of scope: social engineering, issues in third-party services (Trezor Connect's hosted page, WalletConnect's relay), denial of service, and findings that need a compromised device or browser. Rewards scale with impact; critical findings on custody start at 5,000 USDC.

## What we defend against (short form of master plan §3.1)

| Threat | Controls |
|---|---|
| Malicious dApp gets a signature the user did not understand | decode → simulate → assess → explain on every signature, every body, every origin; `block` classes cannot be signed by any UI; per-origin sessions; permit-family rules with drainer fixtures |
| A web page reaching the privileged context | MV3 CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; sender validation on every Port; frozen provider; per-load channel nonce; no `externally_connectable`; approval windows with delayed enable |
| Someone with your disk, a backup, or a stolen laptop | everything naming an account, an address, a balance, a holding or an approval is sealed under the vault key in per-family encrypted blobs — the identifier is absent from the key names too, not just the values; see "What a stolen disk reveals" below |
| Key extraction | keys never cross the UI channel (a runtime assertion refuses raw bytes on it); the DEK lives in the engine process only; the vault is Argon2id + XChaCha20-Poly1305 (`VaultFileV2`); seeds render only in the full tab / on the phone with screenshots blocked |
| Supply chain | no remote code in our origin (the one exception is Trezor's hosted `connect.trezor.io` page, in Trezor's origin, pinned); pinned exact dependencies, a 7-day minimum release age, build scripts disabled except esbuild; a CycloneDX SBOM per release; a reproducible extension build with a published hash; Renovate with grouped weekly updates and OSV alerts |
| Address poisoning, clipboard hijack, lookalike names | first-seen registry, 4+4 lookalike block, paste-vs-copied mismatch alert, `.etn`/`.eth` forward verification, never a name for a contract |
| Phishing origins | a signed scam-origin list (ed25519, key baked in), typosquat scoring against the protected set, "first time on this site" step |
| Stale or lying data | RPC is the only quantity source; ElectroSwap's API and price feeds are display only; divergence drops fiat, never the balance |
| Fee-sink redirection | sink and schedule addresses pinned in the binary; the decoder refuses a swap whose `PAY_PORTION` is not the pinned sink at the schedule's bips |

## What a stolen disk reveals

With the wallet **locked**, someone holding the storage files gets ciphertext and
a small, deliberate remainder. This is stated exactly, because a 2026-09 audit
found the previous answer was "most of your financial life in plaintext JSON".

**Sealed** (XChaCha20-Poly1305 under a key derived from the vault key, so it
needs your password): the recovery phrase and private keys, transaction history,
address book, portfolio totals and per-token quantities, token approvals, farm,
launchpad and NFT positions, the price and chart data you looked at, your
watchlist and notification inbox, the seated account, the account id and
addresses shown to each connected dApp, and this device's sync signing key with
the channel key of every device paired to it.

**Readable, and why it has to be:**

| Left in the clear | Why |
|---|---|
| Wallet settings | the injected provider reads them when a page starts loading, long before you could unlock |
| Vault KDF parameters | needed to turn your password into the key that unlocks everything else |
| Signed flag and scam-origin lists | public, ed25519-signed, and read at startup |
| Network endpoints and the public token catalogue | public reference data, identical for every user |
| A few display preferences (last tab, chart range) | no account, address or amount in them |
| The list of dApp origins you connected, and which chain each uses | answered on every request from a page, including while locked. The **addresses and account** behind each one are sealed. Origins are not hashed: dApp origins are a small, well-known set, so hashing them would be undone by hashing the same public list, while putting cryptography in the request path |

**Unlocked is a different question.** While the wallet is unlocked its key is in
memory so the wallet can work. Anything running as the wallet itself — a
compromised extension page, or someone at your unlocked machine with developer
tools — can reach it. That is the standard browser-extension boundary (§3.1 T3)
and it is why auto-lock is short by default. Locking is the protection.

## Kill-switches

`https://static.electroswap.io/wallet/flags.json` (+ `.sig`) can switch off in-wallet swaps, limit orders, the bridge or one corridor, the launchpad, the marketplace or farms, and can require a minimum version. Flags are ed25519-signed, refused when unsigned or older than the file already held, and can only *disable* — nothing remote can turn a feature on or change behaviour.

## What a website can ask the wallet

A page you have **not** connected to gets discovery only: the chain id, the
client version, and an empty account list. It cannot read balances, call
contracts, read logs or broadcast a transaction through the wallet.

Once you **connect**, that origin sees the address you chose and can read
balances and chain state for it without asking again — the EIP-1193 model every
wallet follows. It still cannot sign anything without your approval. Disconnect
from Settings › Connected sites.

## Cryptography

secp256k1 (`@noble/curves`), SHA-256/Keccak/HKDF (`@noble/hashes`), XChaCha20-Poly1305 (`@noble/ciphers`), Argon2id (`hash-wasm` in the extension worker, libsodium on the phone — byte-identical vectors in CI), ed25519/X25519 for device pairing and signed statics, BIP-32/39 (`@scure`). No `node:crypto`, no `Math.random` anywhere near a secret (lint-enforced).

## Audits

The external audit (extension + engine + mobile secret module) is scheduled from M8 (master plan §11); reports are published at `https://electroswap.io/docs/boltvault/security` with the SBOM and the build hash of each release.
