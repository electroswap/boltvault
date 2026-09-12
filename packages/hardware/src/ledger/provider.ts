/**
 * One seam for every Ledger transport (master plan §2.7 S7): WebHID from the
 * service worker today, BLE (`@ledgerhq/react-native-hw-transport-ble`) and
 * USB-OTG on the phone through the same two calls. The engine only ever
 * lists devices and opens an APDU exchange; framing stays with the transport.
 */
import type { ApduTransport } from './eth'
import { LEDGER_VENDOR_ID, LedgerHidTransport, ledgerModelName, type HidDeviceLike } from './hid'

export interface LedgerDeviceInfo {
  readonly id: string
  readonly model: string
}

export interface LedgerTransportProvider {
  readonly kind: 'hid' | 'ble' | 'usb'
  list(): Promise<LedgerDeviceInfo[]>
  /** Open (or reuse) the exchange for a device; the transport owns the handle. */
  open(id: string): Promise<ApduTransport & { readonly model: string }>
}

/** What the service worker hands the engine: WebHID's `navigator.hid` or a shim with the same call. */
export interface HidProvider {
  getDevices(): Promise<HidDeviceLike[]>
}

export function hidDeviceId(d: HidDeviceLike): string {
  return `${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.productName ?? ''}`
}

/** WebHID as a transport provider: the devices the user already paired in tab.html. */
export function hidLedgerProvider(hid: HidProvider): LedgerTransportProvider {
  const transports = new Map<string, LedgerHidTransport>()
  const devices = async (): Promise<HidDeviceLike[]> => {
    const all = await hid.getDevices().catch(() => [] as HidDeviceLike[])
    return all.filter((d) => d.vendorId === LEDGER_VENDOR_ID)
  }
  return {
    kind: 'hid',
    async list() {
      return (await devices()).map((d) => ({ id: hidDeviceId(d), model: ledgerModelName(d.productId, d.productName) }))
    },
    async open(id) {
      const device = (await devices()).find((d) => hidDeviceId(d) === id)
      if (!device) throw new Error('No Ledger is connected. Plug it in, unlock it and open the Ethereum app.')
      let transport = transports.get(id)
      if (!transport || transport.device !== device) {
        transport = new LedgerHidTransport(device)
        transports.set(id, transport)
      }
      const t = transport
      return { model: t.modelName, exchange: (apdu) => t.exchange(apdu) }
    },
  }
}
