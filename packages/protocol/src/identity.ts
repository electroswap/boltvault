/**
 * The provider's public identity (master plan §4.4). The EIP-6963 uuid is
 * pinned forever — dApps and wallet pickers key on it; changing it would make
 * BoltVault look like a different wallet. One source for the extension's
 * MAIN-world script and the phone's injected one.
 */
export const BOLTVAULT_PROVIDER_UUID = '2f7c9a1e-6d3b-4c58-9e0a-7b1d4f8c2a65'
export const BOLTVAULT_RDNS = 'io.electroswap.boltvault'
export const BOLTVAULT_NAME = 'BoltVault'

const ICON_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='#060913'/><path d='M18 3 8 18h7l-1 11 10-15h-7z' fill='#5FD8FF'/></svg>"

/** A data: URI (EIP-6963 requires one — no remote image). */
export const BOLTVAULT_ICON = `data:image/svg+xml;base64,${btoa(ICON_SVG)}`
