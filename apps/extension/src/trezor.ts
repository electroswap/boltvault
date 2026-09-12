/**
 * Trezor Connect in the service worker (master plan §2.7 S7): the package's
 * core runs here and opens Trezor's hosted popup at connect.trezor.io — the
 * one documented exception to "no remote code", in Trezor's origin, launched
 * from a user gesture in tab.html. Loaded lazily so the worker stays small
 * until the first Trezor account; every answer is validated before the
 * engine sees it.
 */
import { TREZOR_CONNECT_SRC, TrezorAddressBundleResult, TrezorAddressResult, TrezorFeaturesResult, TrezorMessageResult, TrezorSignatureResult, type TrezorConnectLike, type TrezorResult } from '@boltvault/hardware'
import type { TrezorConnectApi } from '@trezor/connect-webextension'

let core: Promise<TrezorConnectApi> | null = null

async function load(): Promise<TrezorConnectApi> {
  core ??= import('@trezor/connect-webextension').then((m) => m.default)
  return core
}

const unreadable: TrezorResult<never> = { success: false, payload: { error: 'Trezor Connect answered with something the wallet cannot read.', code: 'Failure_DataError' } }

function parsed<T>(schema: { safeParse(v: unknown): { success: true; data: TrezorResult<T> } | { success: false } }, value: unknown): TrezorResult<T> {
  const r = schema.safeParse(value)
  return r.success ? r.data : unreadable
}

export function createTrezorConnect(): TrezorConnectLike {
  let initialised = false
  return {
    async init(input) {
      const c = await load()
      if (initialised) return
      await c.init({ manifest: input.manifest, connectSrc: input.connectSrc ?? TREZOR_CONNECT_SRC, lazyLoad: true, transports: ['WebUsbTransport', 'BridgeTransport'] })
      initialised = true
    },
    async getFeatures() {
      return parsed(TrezorFeaturesResult, await (await load()).getFeatures())
    },
    async ethereumGetAddress(input) {
      return parsed(TrezorAddressResult, await (await load()).ethereumGetAddress({ path: input.path, showOnTrezor: input.showOnTrezor ?? false }))
    },
    async ethereumGetAddressBundle(input) {
      return parsed(TrezorAddressBundleResult, await (await load()).ethereumGetAddress({ bundle: input.bundle }))
    },
    async ethereumSignTransaction(input) {
      return parsed(TrezorSignatureResult, await (await load()).ethereumSignTransaction({ path: input.path, transaction: { ...input.transaction } }))
    },
    async ethereumSignMessage(input) {
      return parsed(TrezorMessageResult, await (await load()).ethereumSignMessage({ path: input.path, message: input.message, hex: input.hex }))
    },
    async ethereumSignTypedData(input) {
      const c = await load()
      const r = input.domain_separator_hash && input.message_hash ? await c.ethereumSignTypedData({ path: input.path, data: input.data, metamask_v4_compat: input.metamask_v4_compat, domain_separator_hash: input.domain_separator_hash, message_hash: input.message_hash }) : await c.ethereumSignTypedData({ path: input.path, data: input.data, metamask_v4_compat: input.metamask_v4_compat })
      return parsed(TrezorMessageResult, r)
    },
    dispose() {
      if (core) void core.then((c) => c.dispose())
      core = null
      initialised = false
    },
  }
}
