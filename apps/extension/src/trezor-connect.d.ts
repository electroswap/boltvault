/**
 * The slice of `@trezor/connect-webextension` the wallet calls. The package
 * ships a prebuilt script without types for this entry; results are
 * validated with zod in `trezor.ts`, so `unknown` is the honest type here.
 */
declare module '@trezor/connect-webextension' {
  export interface TrezorConnectInit {
    readonly manifest: { readonly email: string; readonly appUrl: string }
    readonly connectSrc?: string
    readonly lazyLoad?: boolean
    readonly transports?: readonly string[]
  }
  export interface TrezorConnectApi {
    init(init: TrezorConnectInit): Promise<void>
    getFeatures(): Promise<unknown>
    ethereumGetAddress(
      params:
        | { path: string; showOnTrezor?: boolean }
        | { bundle: ReadonlyArray<{ path: string; showOnTrezor: boolean }> },
    ): Promise<unknown>
    ethereumSignTransaction(params: {
      path: string
      transaction: Record<string, unknown>
    }): Promise<unknown>
    ethereumSignMessage(params: { path: string; message: string; hex: boolean }): Promise<unknown>
    ethereumSignTypedData(params: {
      path: string
      data: unknown
      metamask_v4_compat: boolean
      domain_separator_hash?: string
      message_hash?: string
    }): Promise<unknown>
    dispose(): void
  }
  const TrezorConnect: TrezorConnectApi
  export default TrezorConnect
}
