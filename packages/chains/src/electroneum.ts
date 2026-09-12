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
  /** BOLT — the boost/governance-style token (§8.18). */
  bolt: string | null
  /** FeeOnTransferDetectorV2 — measures a token's transfer tax, and says when it could not (§8.6). */
  feeOnTransferDetector: string | null
  /** EsLimitOrderManagerV1 (§8.6). */
  limitOrders: string | null
  /** Warp assets (Hyperlane). */
  usdc: string
  usdt: string
  /** Seaport 1.5 conduit for `seaportConduitKey` (§8.10). */
  seaportConduit: string
  /** Marketplace fee receiver — on mainnet the Electric Legends dividend distributor (§8.10). */
  nftFeeReceiver: string
  electricLegends: string
  dividendDistributor: string
  /** EsMinterV2 (§8.10 mint). */
  nftMinter: string
  launchpadManager: string
  launchpadAffiliate: string
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
    bolt: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1',
    feeOnTransferDetector: '0x0704B84d3D20E5dF67169649f216C368185EE841',
    limitOrders: '0x5911BE1AE831248883F84891fe798b52940a8721',
    usdc: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e',
    usdt: '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7',
    seaportConduit: '0x2941Cba4DD14B2C67b0802107f23144c70ED680F',
    nftFeeReceiver: '0xc4065B310d64a02Ac4BF43CFd35C5Fe1A42811ea',
    electricLegends: '0x31cbb613D14cc85Cf3A8889007562E4B5cE9518b',
    dividendDistributor: '0xc4065B310d64a02Ac4BF43CFd35C5Fe1A42811ea',
    nftMinter: '0x41B8c31e35317124a7a4895ea034538C213c060f',
    launchpadManager: '0x08DbA509E323BCEf07752D1EccF880756e205669',
    launchpadAffiliate: '0xA29BAdAee7086e65277497AC6Af65579C7cf0101',
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
    bolt: null,
    feeOnTransferDetector: '0xB1554103215F90f80873A5713F776C4369480dC1',
    limitOrders: '0x960d1cfD7582C2031939d228eBD61cF060cd21Dc',
    usdc: '0x9a110A3Ecc8704e93Bd4FA1bA44D5CF93327202B',
    usdt: '0x02FeC8c559fB598762df8D033bD7A3Df9b374771',
    seaportConduit: '0xf14B3f11CEabC2A2FD0A7b06708549D10091d237',
    nftFeeReceiver: '0x084BA4Db2EBbf3BB3b2b6D5C988eac8aB593a384',
    electricLegends: '0xac3497017c8Af03005185Fc7760041A4bCFe19cd',
    dividendDistributor: '0x084BA4Db2EBbf3BB3b2b6D5C988eac8aB593a384',
    nftMinter: '0x23150bC4D7a6a4d83c952ef635D856d6FDe5a578',
    launchpadManager: '0x55FFDd292F530a7211b0A55d492b3e429e78ED93',
    launchpadAffiliate: '0xbabA97bddEB19C8021522451B50b2316b8762423',
  },
}

/*
  The fee sink and schedule contracts are gone from the wallet's path — the fee
  recipient and the holder ladder are configuration now (`fees.json`, read
  through `./fees.ts`). Their Solidity has been deleted from this repo too; the
  deployed instances are still owned, and git history keeps the source. Nothing
  here reads them. See fees.ts for why.
*/

export const GRAPHQL_URL = 'https://electroswap.io/graphql'
export const TOKEN_LIST_URL = 'https://static.electroswap.io/tokens/tokenlist.json'
export const INTERFACE_URL = 'https://app.electroswap.io'

/** Sent as X-BoltVault-Key — Chrome extensions can't set a trusted Referer. */
export const GRAPHQL_KEY_HEADER = 'X-BoltVault-Key' as const
