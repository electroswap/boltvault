/**
 * Electroneum contract addresses — mirrored from `services/api/config/constants.ts`
 * and `apps/bolt-wallet/src/bolt/constants.ts` (verified 2026-09-04).
 *
 * These are the addresses the wallet talks to directly on-chain; the API's
 * indexer values were cross-checked against these.
 */

export interface ElectroSwapAddresses {
  wetn: string
  universalRouter: string
  v2Router02: string
  swapRouter02: string
  v2Factory: string
  v3Factory: string
  quoterV2: string
  mixedRouteQuoter: string | null
  permit2: string
  multicall3: string
  seaport15: string
  seaportConduitKey: string
  yieldFarm: string
  dyno: string
  /** Warp assets (Hyperlane). */
  usdc: string
  usdt: string
}

export const ELECTRONEUM_ADDRESSES: Record<52014 | 5201420, ElectroSwapAddresses> = {
  52014: {
    wetn: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77',
    universalRouter: '0x2c12c8F15637b7A182DEc202816148A5E767DCEC',
    v2Router02: '0x072D4706f9A383D5608BD14B09b41683cb95fFd7',
    swapRouter02: '0x5A3AB7e9f405250B36e7e0a4654c1052EADC1F07',
    v2Factory: '0x203D550ed6fA9dAB8A4190720CF9F65138abd15B',
    v3Factory: '0xbF6Bcbe2be545135391777F3B4698be92E2EB8cA',
    quoterV2: '0xba3CAfCc197E71b9d114E515E75c037dA09A6312',
    mixedRouteQuoter: '0x591c0d1d5f256aC963a824625B378cDb9c16F304',
    permit2: '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617',
    multicall3: '0xf6bd2414715713f52C74fce8341DA12221ac7446',
    seaport15: '0x678748317e7fD5B7699D07e666087608B401cbFd',
    seaportConduitKey:
      '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0000000000000000000000000',
    yieldFarm: '0xe653aC16B732876F58a1722d24801230fA96bc82',
    dyno: '0xEe432C220273e4F949007B4c1946562826Efa055',
    usdc: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e',
    usdt: '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7',
  },
  5201420: {
    wetn: '0x154c9fD7F006b92b6afa746098d8081A831DC1FC',
    universalRouter: '0xF52321EB9eAd6D57887F203Df9036baf2f3765A9',
    v2Router02: '0x5410F10a5E214AF03EA601Ca8C76b665A786BCe1',
    swapRouter02: '0x515C90Bf6a4f46d0E89d94628D0A17a637a4E8f4',
    v2Factory: '0x8359Fd7219181cbE5282b5d69e836Ac525f29a33',
    v3Factory: '0xB941538D8AC5607972ECa75675F90Ce602Dc0D76',
    quoterV2: '0x945ec22FFc3f88aeD031C1C4d051B82282736B41',
    mixedRouteQuoter: null,
    permit2: '0xDD07Fe6922d1Aab4fe98C6533fa19037159500E7',
    multicall3: '0x3F86b2983d92268Ba5601e4424d252795e7ED165',
    seaport15: '0xc76D47dc6E2f79FF2570f9B4145Af90E673b4F24',
    seaportConduitKey:
      '0x888031006C1b2D7A8F66b4E4Af52d8711C557B65000000000000000000000000',
    yieldFarm: '0x4025ed69ce7DCdc147418e0e730E7575F9b14b78',
    dyno: '0x162D5a58096b63D89D83e0C66b4731A6CC8b10aF',
    usdc: '0x9a110A3Ecc8704e93Bd4FA1bA44D5CF93327202B',
    usdt: '0x02FeC8c559fB598762df8D033bD7A3Df9b374771',
  },
}

/**
 * The in-wallet swap fee sink. NOT YET DEPLOYED (PR-ES-5) — until ops deploys
 * `BoltVaultFeeSink` and gives us the address, in-wallet swaps run against
 * testnet with a dev sink. Mismatch between this constant and the configured
 * sink at runtime must disable in-wallet swap ("do not swap"), per design.
 */
export const BOLTVAULT_FEE_SINK: Record<52014 | 5201420, string | null> = {
  52014: null, // mainnet sink pending PR-ES-5
  5201420: null, // testnet sink pending PR-ES-5 (dev builds use 0x… pending)
}

export const GRAPHQL_URL = 'https://electroswap.io/graphql'
export const TOKEN_LIST_URL = 'https://static.electroswap.io/tokens/tokenlist.json'
export const INTERFACE_URL = 'https://app.electroswap.io'

/** Sent as X-BoltVault-Key — Chrome extensions can't set a trusted Referer. */
export const GRAPHQL_KEY_HEADER = 'X-BoltVault-Key' as const
