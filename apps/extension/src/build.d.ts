/** Injected at build time (`BUILD_HASH`, the commit); empty in dev. */
declare const __BUILD_HASH__: string
/** The ElectroSwap API origin this build talks to (`WXT_BOLTVAULT_API`; default https://electroswap.io). */
declare const __API_ORIGIN__: string
/** The wallet API key baked in at build time; '' when this build has none. */
declare const __WALLET_KEY__: string
/** Limit orders on the Swap screen (`WXT_BOLTVAULT_LIMIT_ORDERS=1`); off by default. */
declare const __LIMIT_ORDERS__: boolean
/** Routing service URL (`WXT_QUOTER_URL`); '' derives it from `__API_ORIGIN__`. */
declare const __QUOTER_URL__: string
