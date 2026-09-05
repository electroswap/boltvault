/**
 * Ledger over Bluetooth on the phone (master plan §5.4): Ledger's BLE
 * transport does the framing; the engine sees the same list/open seam as
 * WebHID. Nano X / Stax / Flex advertise; a Nano S Plus does not (USB-OTG on
 * Android is the same seam through `@ledgerhq/react-native-hw-transport-hid`
 * when it is added). Loaded lazily — the module needs a device build.
 */
import type { ApduTransport, LedgerTransportProvider } from '@boltvault/hardware'

interface BleTransport {
  exchange(apdu: Buffer): Promise<Buffer>
  close(): Promise<void>
}

interface BleModule {
  default: {
    list(): Promise<Array<{ id: string; name?: string; localName?: string }>>
    open(id: string): Promise<BleTransport>
  }
}

const modelFromName = (name: string | undefined): string => {
  const n = (name ?? '').toLowerCase()
  if (n.includes('stax')) return 'Ledger Stax'
  if (n.includes('flex')) return 'Ledger Flex'
  if (n.includes('nano x')) return 'Ledger Nano X'
  return 'Ledger'
}

export function bleLedgerProvider(): LedgerTransportProvider {
  const open = new Map<string, ApduTransport & { readonly model: string }>()
  const names = new Map<string, string>()
  const load = (): Promise<BleModule> => import('@ledgerhq/react-native-hw-transport-ble') as unknown as Promise<BleModule>
  return {
    kind: 'ble',
    async list() {
      const m = await load()
      const devices = await m.default.list()
      for (const d of devices) names.set(d.id, d.name ?? d.localName ?? '')
      return devices.map((d) => ({ id: d.id, model: modelFromName(d.name ?? d.localName) }))
    },
    async open(id) {
      const existing = open.get(id)
      if (existing) return existing
      const m = await load()
      const t = await m.default.open(id)
      const transport = {
        model: modelFromName(names.get(id)),
        exchange: async (apdu: Uint8Array): Promise<Uint8Array> => {
          try {
            const out = await t.exchange(Buffer.from(apdu))
            return new Uint8Array(out)
          } catch (err) {
            open.delete(id)
            await t.close().catch(() => undefined)
            throw err
          }
        },
      }
      open.set(id, transport)
      return transport
    },
  }
}
