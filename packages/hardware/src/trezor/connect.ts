/**
 * Trezor Connect, reduced to the five calls the wallet makes (master plan
 * §2.7 S7): the real `@trezor/connect-webextension` runs its core in the
 * service worker and opens Trezor's hosted popup at connect.trezor.io — the
 * one documented exception to "no remote code", in Trezor's origin, launched
 * only from tab.html. The engine sees this interface; tests see a fake.
 */
import { z } from 'zod'

export const TREZOR_CONNECT_SRC = 'https://connect.trezor.io/9/'

const Failure = z.object({ success: z.literal(false), payload: z.object({ error: z.string(), code: z.string().optional() }) })
const ok = <T extends z.ZodTypeAny>(payload: T) => z.union([z.object({ success: z.literal(true), payload }), Failure])

export const TrezorAddressResult = ok(z.object({ address: z.string(), path: z.array(z.number()).optional(), serializedPath: z.string().optional() }))
export const TrezorAddressBundleResult = ok(z.array(z.object({ address: z.string(), serializedPath: z.string().optional() })))
export const TrezorSignatureResult = ok(z.object({ v: z.union([z.string(), z.number()]), r: z.string(), s: z.string() }))
export const TrezorMessageResult = ok(z.object({ address: z.string(), signature: z.string() }))
export const TrezorFeaturesResult = ok(z.object({ model: z.string().optional(), internal_model: z.string().optional(), label: z.string().nullable().optional(), major_version: z.number().optional(), minor_version: z.number().optional(), patch_version: z.number().optional(), initialized: z.boolean().optional() }))

export type TrezorResult<T> = { success: true; payload: T } | { success: false; payload: { error: string; code?: string } }

export interface TrezorFeatures {
  readonly model?: string
  readonly internal_model?: string
  readonly label?: string | null
  readonly major_version?: number
  readonly minor_version?: number
  readonly patch_version?: number
  readonly initialized?: boolean
}

export interface TrezorTransactionInput {
  readonly to: string
  readonly value: string
  readonly gasLimit: string
  readonly nonce: string
  readonly chainId: number
  readonly data?: string
  readonly gasPrice?: string
  readonly maxFeePerGas?: string
  readonly maxPriorityFeePerGas?: string
}

/** The subset of TrezorConnect the wallet drives, with results as plain data. */
export interface TrezorConnectLike {
  init(input: { manifest: { email: string; appUrl: string }; connectSrc?: string }): Promise<void>
  getFeatures(): Promise<TrezorResult<TrezorFeatures>>
  ethereumGetAddress(input: { path: string; showOnTrezor?: boolean }): Promise<TrezorResult<{ address: string; serializedPath?: string }>>
  ethereumGetAddressBundle(input: { bundle: Array<{ path: string; showOnTrezor: false }> }): Promise<TrezorResult<Array<{ address: string; serializedPath?: string }>>>
  ethereumSignTransaction(input: { path: string; transaction: TrezorTransactionInput }): Promise<TrezorResult<{ v: string | number; r: string; s: string }>>
  ethereumSignMessage(input: { path: string; message: string; hex: boolean }): Promise<TrezorResult<{ address: string; signature: string }>>
  ethereumSignTypedData(input: { path: string; data: unknown; metamask_v4_compat: boolean; domain_separator_hash?: string; message_hash?: string }): Promise<TrezorResult<{ address: string; signature: string }>>
  dispose(): void
}

export class TrezorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TrezorError'
  }
}

/** Trezor's user-facing error codes, in the wallet's voice. */
export function trezorErrorMessage(payload: { error: string; code?: string }): string {
  const code = payload.code ?? ''
  if (code === 'Failure_ActionCancelled' || /cancel/i.test(payload.error)) return 'Cancelled on the Trezor.'
  if (code === 'Method_PermissionsNotGranted' || /permission/i.test(payload.error)) return 'Trezor Connect needs your permission in its window.'
  if (/device disconnected|no device/i.test(payload.error)) return 'No Trezor is connected. Plug it in and unlock it.'
  if (/popup closed/i.test(payload.error)) return 'The Trezor window was closed before it finished.'
  return payload.error
}

export function unwrap<T>(r: TrezorResult<T>): T {
  if (r.success) return r.payload
  throw new TrezorError(r.payload.code ?? 'Failure', trezorErrorMessage(r.payload))
}

/**
 * Trezor's `v` (§2.7 S3): for EIP-155 legacy transactions `chainId*2+35+parity`,
 * for typed transactions and messages 27/28, and sometimes the bare parity.
 */
export function yParityFromTrezorV(v: string | number): 0 | 1 {
  const n = typeof v === 'number' ? v : v.startsWith('0x') ? Number.parseInt(v, 16) : Number.parseInt(v, 10)
  if (!Number.isFinite(n) || n < 0) throw new TrezorError('Failure_DataError', 'The Trezor returned a signature the wallet cannot read.')
  if (n >= 35) return ((n - 35) % 2) as 0 | 1
  if (n >= 27) return ((n - 27) % 2) as 0 | 1
  return (n % 2) as 0 | 1
}
