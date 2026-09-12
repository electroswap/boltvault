/**
 * Ledger over Bluetooth on the phone (master plan §5.4): Ledger's BLE
 * transport does the framing; the engine sees the same list/open seam as
 * WebHID. Nano X / Stax / Flex advertise; a Nano S Plus has no radio and
 * arrives over the cable instead (ledger-hid.ts). Loaded lazily — the module
 * needs a device build.
 *
 * DISCOVERY IS A SCAN, NOT A LIST. This module used to call
 * `TransportBLE.list()`, which in this version is literally
 * `throw new Error("not implemented")` — and the composed provider turned that
 * into an empty array, so an awake, advertising Nano X was never shown and the
 * failure was completely silent. Owner: "not seeing anything via BTE even
 * though I approved nearby devices and the BT is enabled on the Ledger Nano
 * X." Discovery is `listen(observer)`: a subscription that emits devices as
 * they are found, which is bounded here so `list()` can keep its shape.
 */
import type { ApduTransport, LedgerDeviceInfo, LedgerTransportProvider } from '@boltvault/hardware'
import { OPEN_TIMEOUT_MS, serial, withTimeout } from './ledger-queue'

interface BleTransport {
  exchange(apdu: Buffer): Promise<Buffer>
  close(): Promise<void>
}

interface BleDescriptor {
  readonly id: string
  readonly name?: string | null
  readonly localName?: string | null
}

interface BleObserver {
  next(event: { type: string; descriptor?: BleDescriptor }): void
  error(err: unknown): void
  complete(): void
}

interface BleModule {
  default: {
    listen(observer: BleObserver): { unsubscribe(): void }
    open(id: string): Promise<BleTransport>
  }
}

/**
 * How long to advertise-scan before answering. Long enough for a Nano X that
 * is awake to be seen, short enough that "Refresh" still feels like a button.
 */
const SCAN_MS = 4_000

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
  const load = (): Promise<BleModule> =>
    import('@ledgerhq/react-native-hw-transport-ble') as unknown as Promise<BleModule>
  return {
    kind: 'ble',
    async list() {
      /*
        Never scan while we are connected to something.

        HardwareService.app() re-lists on every call, and the picker derives
        two address schemes at once, so a scan was starting on top of a live
        GATT connection — which is a well-known way to have Android drop it.
        Owner: "Got 'reading addresses from Ledger' -> 'DisconnectedDevice'."

        An open transport already answers the question a scan would ask, so
        answer from it and leave the radio alone.
      */
      if (open.size > 0)
        return [...open.keys()].map((id) => ({ id, model: modelFromName(names.get(id)) }))
      const m = await load()
      return new Promise<LedgerDeviceInfo[]>((resolve) => {
        const found = new Map<string, string>()
        let done = false
        let sub: { unsubscribe(): void } | null = null
        const finish = (): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          try {
            sub?.unsubscribe()
          } catch {
            // Tearing down a scan must never be what fails the call.
          }
          for (const [id, name] of found) names.set(id, name)
          /*
            A BLE peripheral stops advertising once it is connected, so the
            device we are already talking to is exactly the one a fresh scan
            cannot see. Owner: "it seems to detect now showing Ethereum app
            1.22.1 but then also gives an error 'No Ledger is connected'" —
            the first scan found it, the second came back empty, and the engine
            reported it gone while an open transport was sitting right there.
            Anything we hold open is connected by definition.
          */
          for (const id of open.keys()) if (!found.has(id)) found.set(id, names.get(id) ?? '')
          resolve([...found].map(([id, name]) => ({ id, model: modelFromName(name) })))
        }
        const timer = setTimeout(finish, SCAN_MS)
        try {
          sub = m.default.listen({
            next: (event) => {
              const d = event.descriptor
              if (event.type === 'add' && d) found.set(d.id, d.name ?? d.localName ?? '')
            },
            // A scan that errors still reports whatever it saw first: a
            // powered-off radio should not lose a device already found.
            error: finish,
            complete: finish,
          })
        } catch {
          finish()
        }
      })
    },
    async open(id) {
      const existing = open.get(id)
      if (existing) return existing
      const m = await load()
      const t = await withTimeout(
        m.default.open(id),
        OPEN_TIMEOUT_MS,
        'The Ledger did not finish connecting. Wake it, open the Ethereum app and try again.',
      )
      // One exchange at a time; see ledger-queue.ts.
      const queue = serial()
      const transport = {
        model: modelFromName(names.get(id)),
        exchange: (apdu: Uint8Array): Promise<Uint8Array> =>
          queue(async () => {
            try {
              const out = await t.exchange(Buffer.from(apdu))
              return new Uint8Array(out)
            } catch (err) {
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
