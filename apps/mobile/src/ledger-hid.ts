/**
 * Ledger over USB-OTG on the phone (master plan §5.4).
 *
 * Owner: "Adding a Ledger hardware wallet did not work, I connected via OTG
 * cable and had Ethereum app open (Ledger Live detected) but BoltVault did not
 * detect it, even after refreshing several times."
 *
 * It could not have. The app wired only the BLE provider, whose `list()` is a
 * Bluetooth scan — a device on the end of a cable is invisible to it, and a
 * Nano S / S Plus has no radio to be found by anyway. The seam has allowed
 * `kind: 'usb'` since it was written; nothing implemented it.
 *
 * Note the package name: `@ledgerhq/react-native-hid`. The comment in
 * ledger-ble.ts and the milestone log both name
 * `@ledgerhq/react-native-hw-transport-hid`, which does not exist on npm.
 *
 * Loaded lazily, like the BLE one — the module needs a device build, so an
 * import at module scope would break the harness and the extension bundle.
 */
import type { ApduTransport, LedgerTransportProvider } from '@boltvault/hardware'
import { OPEN_TIMEOUT_MS, serial, withTimeout } from './ledger-queue'

interface HidTransport {
  exchange(apdu: Buffer): Promise<Buffer>
  close(): Promise<void>
}

interface HidDescriptor {
  readonly vendorId?: number
  readonly productId?: number
  readonly deviceName?: string
  readonly deviceId?: number
  readonly name?: string
}

interface HidModule {
  default: {
    list(): Promise<HidDescriptor[]>
    open(descriptor: HidDescriptor): Promise<HidTransport>
  }
}

/**
 * Ledger's USB product ids encode the model in their high byte. Ledger Live
 * reads the same field; we only need enough to name the device on screen.
 */
function modelFromProduct(productId: number | undefined, name: string | undefined): string {
  const label = (name ?? '').toLowerCase()
  if (label.includes('stax')) return 'Ledger Stax'
  if (label.includes('flex')) return 'Ledger Flex'
  if (label.includes('nano s plus')) return 'Ledger Nano S Plus'
  if (label.includes('nano x')) return 'Ledger Nano X'
  if (label.includes('nano s')) return 'Ledger Nano S'
  switch ((productId ?? 0) >> 8) {
    case 0x00:
      return 'Ledger Nano S'
    case 0x40:
      return 'Ledger Nano X'
    case 0x50:
      return 'Ledger Nano S Plus'
    case 0x60:
      return 'Ledger Stax'
    case 0x70:
      return 'Ledger Flex'
    default:
      return 'Ledger'
  }
}

/** A stable id for a descriptor, so `open` can find it again after a list. */
function idFor(d: HidDescriptor): string {
  return `usb:${d.vendorId ?? 0}:${d.productId ?? 0}:${d.deviceId ?? 0}`
}

export function hidLedgerProvider(): LedgerTransportProvider {
  const open = new Map<string, ApduTransport & { readonly model: string }>()
  const seen = new Map<string, HidDescriptor>()
  const load = (): Promise<HidModule> =>
    import('@ledgerhq/react-native-hid') as unknown as Promise<HidModule>
  return {
    kind: 'usb',
    async list() {
      const m = await load()
      const devices = await m.default.list()
      seen.clear()
      for (const d of devices) seen.set(idFor(d), d)
      return devices.map((d) => ({
        id: idFor(d),
        model: modelFromProduct(d.productId, d.deviceName ?? d.name),
      }))
    },
    async open(id) {
      const existing = open.get(id)
      if (existing) return existing
      const descriptor = seen.get(id)
      if (!descriptor) throw new Error('that Ledger is no longer attached')
      const m = await load()
      /*
        The first open of a device raises Android's USB permission dialog, and
        that promise simply never settles if the dialog is dismissed or never
        appears. Owner: "Reading addresses from your Ledger -> loading forever.
        Closed the app, tried again via OTG and addresses showed up" — the
        second run inherited the permission granted by the first. A bounded
        wait turns a hang into a sentence the user can act on.
      */
      const t = await withTimeout(
        m.default.open(descriptor),
        OPEN_TIMEOUT_MS,
        'The Ledger did not respond. Allow the USB permission when Android asks, then try again.',
      )
      // Ledger's Transport allows one exchange at a time and throws
      // TransportRaceCondition otherwise; callers are legitimately concurrent,
      // so the queue lives here. See ledger-queue.ts.
      const queue = serial()
      const transport = {
        model: modelFromProduct(descriptor.productId, descriptor.deviceName ?? descriptor.name),
        exchange: (apdu: Uint8Array): Promise<Uint8Array> =>
          queue(async () => {
            try {
              const out = await t.exchange(Buffer.from(apdu))
              return new Uint8Array(out)
            } catch (err) {
              // A pulled cable must not leave a dead handle cached.
              open.delete(id)
              await t.close().catch(() => undefined)
              throw err
            }
          }),
      }
      open.set(id, transport)
      return transport
    },
  }
}
