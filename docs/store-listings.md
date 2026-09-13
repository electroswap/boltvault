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
- **`storage`** — the encrypted vault and settings. **`alarms`** — auto-lock and background checks (watchlist, signed flags). **`scripting`** — required by the bundled Trezor Connect, which injects its own content script into the `connect.trezor.io` popup during hardware pairing. (The MAIN-world provider is injected by the manifest's `world: "MAIN"`, not by `chrome.scripting`.) **`notifications`** — watchlist alerts. **`activeTab`** — the connected-site title and favicon.
- **Not requested:** `tabs` (unless the favicon fetch proves to need it), `webRequest`, `history`, `cookies`, `offscreen`, `externally_connectable`.

## Privacy answers

- Data collected: none. No analytics SDK. Crash reports are opt-in, scrubbed of addresses, secrets and URLs, and sent only to ElectroSwap.
- Data shared with third parties: the account address reaches ElectroSwap's API (portfolio, activity, push when opted in) and the chain RPCs. Prices for other chains are fetched by token address only. Trezor's hosted Connect page runs in Trezor's origin during a Trezor operation.
- Single purpose: a cryptocurrency wallet.

## Screenshots

**The baselines cannot be uploaded as they stand.** The Chrome Web Store takes
at most five screenshots and each must be exactly 1280×800 or 640×400; the
harness renders 400×600 (popup), 1100×760 (tab) and 390×844 (phone), so the
console rejects every one of them. Firefox AMO has no fixed size and will take
the baselines directly.

So the baselines are the *subject* of a tile rather than the tile. Five of them,
composed on the brand's ground with the hero's own phone, in
`apps/docs/static/img/store/` (the docs repository, where the brand furniture
lives) — and the order is the argument:

| # | Tile | Shows |
|---|---|---|
| 1 | The whole app, in a wallet. | the tab, portfolio — so the first thumbnail is the product |
| 2 | Every signature, explained. | the signing popup with an unlimited-approval warning and an unknown spender |
| 3 | Every ElectroSwap market, built in. | swap (priced), explore and Legends, fanned |
| 4 | Your keys, your device. | accounts: a backed-up seed, a Ledger, a watch-only |
| 5 | One wallet, phone and browser. | the popup beside the landing page's 3D phone |

To rebuild them, in two steps and two repositories:

```
# 1. this repo — the screens, driven before the shutter (a priced swap, not an empty one)
pnpm build:harness
cd apps/extension
node e2e/landing-shots.mjs --out /tmp/store --body popup --only swap,sign,explore,legends,accounts,home
node e2e/landing-shots.mjs --out /tmp/store --body tab --only home
cp /tmp/store/*.png ../../../docs/static/img/boltvault/store/

# 2. the docs repo — the tiles
STORE_ROUTE=1 yarn docusaurus start --no-open --port 3100
yarn store:shots            # -> static/img/store/boltvault-<n>-<id>.png
```

`--body` is why this is one script rather than two: the phone on the landing
page and the popup in the store are the same screens, prepared the same way, so
the swap in the shop window is the swap on the site.

## The icon and the promo tiles

The console takes three more images, each at one exact size, and they come out
of the same route and the same command:

| Asset | Size | What it is |
|---|---|---|
| Store icon | 128×128 | the bolt over the brand plate with the **wordmark** under it — not `apps/extension/public/icon/128.png`, which is the browser's toolbar icon and carries no name |
| Small promo tile | 440×280 | mark, name, five words. It is seen at roughly half this in a category row, so nothing else fits |
| Marquee promo tile | 1400×560 | the featured banner: the headline, the popup and the phone |

The mark on all three is `BoltGlyph` in the docs repository — the wallet's own
polygon, and the one place it is allowed a real `feGaussianBlur`. The app cannot
use one (`packages/ui/src/BoltMark.tsx` records that filters silently do nothing
under react-native-svg on Android, so the glow is fifty-six radial discs along
the outline, and `tools/make-icons.mjs` recomputes the same falloff from a
distance field). These are rasterised once in headless Chrome, so they can have
the thing the other two are imitating.

**The bloom is framed, not cropped.** Sizing a frame to the bolt is what put "a
cropped plate of light" on the splash and cost it its glow — see the comment on
`splash-mark.png` in `tools/make-icons.mjs`. `BoltGlyph` sizes the frame to the
*light*: 0.55 bolt-units of padding on every side, because the widest fall has a
0.16 standard deviation and a Gaussian needs about three of those to finish, and
a radial mask takes the aura to zero before the edge regardless.

Only the store icon carries the wordmark. Nine characters across a hundred
pixels is the constraint, so the bolt takes the upper two thirds and the name
gets the bottom band to itself.

## Support

support@electroswap.io · https://electroswap.io/docs/boltvault/security · https://github.com/ElectroSwap/boltvault
