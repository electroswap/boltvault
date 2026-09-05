/**
 * EIP-6963 wallet-announce helpers — pure logic (no DOM, node-runnable).
 */
export const RDNS = 'io.electroswap.boltvault'
export const PROVIDER_NAME = 'BoltVault'

/**
 * Tiny placeholder icon: a 16x16 SVG, base64-encoded data URI.
 * Real build replaces this with the shipped BoltVault logo.
 */
export const ICON_DATA_URI =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48Y2lyY2xlIGN4PSI4IiBjeT0iOCIgcj0iOCIgZmlsbD0iIzFlMjlkNCIvPjwvc3ZnPg=='

export interface Eip6963Info {
  uuid: string
  name: string
  rdns: string
  icon: string
}

export interface Eip6963ProviderDetail {
  info: Eip6963Info
  provider: unknown
}

/**
 * Build an EIP-6963 `eip6963:providerDetail` payload for this wallet.
 * The shape matches the spec: `{ info: { uuid, name, rdns, icon }, provider }`.
 */
export function buildAnnouncement(
  uuid: string,
  provider: unknown,
): Eip6963ProviderDetail {
  return {
    info: {
      uuid,
      name: PROVIDER_NAME,
      rdns: RDNS,
      icon: ICON_DATA_URI,
    },
    provider,
  }
}

/**
 * True if `uuid` has the shape of a (UUIDv4-ish) stable identifier:
 * 8-4-4-4-12 lowercase hex groups. Not a full RFC 4122 variant check —
 * just the stable-UUID shape we expect for EIP-6963 announcement ids.
 */
export function isStableUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
}
