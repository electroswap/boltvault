# Store listings

## Name and tagline

**BoltVault** — The Electroneum wallet and ElectroSwap uber-app.

## Short description (132 chars)

Your Electroneum wallet: swap, farm, launch, collect and bridge on ElectroSwap, with Rabby-grade safety and a face people show off.

## Description

BoltVault is ElectroSwap's official self-custodial wallet for Electroneum Smart Chain and the major EVM chains.

- **Everything ElectroSwap, in the wallet.** Swap on ElectroSwap's AMM (with a fee that drops as you hold BOLT or DYNO), place limit orders, manage yield-farm positions, join launchpad campaigns, buy, sell and offer on the NFT marketplace, claim Electric Legends dividends, and bridge USDC/USDT over Hyperlane — without opening the web app.
- **A firewall on every signature.** Every transaction and message is decoded, simulated where the chain allows, assessed against the drainer playbook (unlimited approvals, permits to unknown spenders, "free mint" listings, lookalike addresses, typosquat sites) and explained in plain words before you sign. Blocked classes cannot be signed at all.
- **Your keys, your device.** Seeds live in an Argon2id + XChaCha20-Poly1305 vault; nothing leaves your device. Ledger (USB and Bluetooth), Trezor and Keystone accounts; pair your phone and browser to sign on the device that holds the key.
- **Nine more chains.** Ethereum, BNB, Base, Arbitrum, Optimism, Polygon, Avalanche, Linea, Unichain through public RPCs — balances, send, receive, activity, approvals.
- **Alive.** The Field behind the glass beats with Electroneum's five-second blocks; your account has a signature nobody else has.

No analytics. No remote code. Open source.

## Permissions justification (Chrome Web Store / AMO)

- **`<all_urls>` host permission** — to inject the EIP-1193 provider (`window.ethereum`, EIP-6963) into web pages at `document_start` so decentralised apps can find the wallet. The content script only relays messages the page addresses to the wallet; it never reads page content, never fetches remote code, and every request the page makes ends in the wallet's own approval window. On Firefox the permission is optional and the wallet asks for it on first open.
- **`storage`** — the encrypted vault and settings. **`alarms`** — auto-lock and background checks (watchlist, signed flags). **`scripting`** — the MAIN-world provider on browsers without manifest `world` support. **`notifications`** — watchlist alerts. **`activeTab`** — the connected-site title and favicon.
- **Not requested:** `tabs` (unless the favicon fetch proves to need it), `webRequest`, `history`, `cookies`, `offscreen`, `externally_connectable`.

## Privacy answers

- Data collected: none. No analytics SDK. Crash reports are opt-in, scrubbed of addresses, secrets and URLs, and sent only to ElectroSwap.
- Data shared with third parties: the account address reaches ElectroSwap's API (portfolio, activity, push when opted in) and the chain RPCs. Prices for other chains are fetched by token address only. Trezor's hosted Connect page runs in Trezor's origin during a Trezor operation.
- Single purpose: a cryptocurrency wallet.

## Screenshots

From the screenshot harness (`apps/extension/e2e/baselines`): Home (funded), Swap with the fee stack, the signing sheet with a blocked drainer, Explore, the Rack, the Coil, the Bridge, Settings › Networks. Phone shots at 390×844 from the same baselines.

## Support

support@electroswap.io · https://wallet.electroswap.io/security · https://github.com/ElectroSwap/boltvault
