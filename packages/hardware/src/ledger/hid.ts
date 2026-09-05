/**
 * Ledger's HID framing (master plan §2.7 S7): every APDU is cut into 64-byte
 * reports `[channel 0x0101][tag 0x05][seq u16][payload]`, the first carrying
 * a u16 length; responses come back the same way and are reassembled by
 * sequence. Pure over a `HidDeviceLike` so the service worker hands in a
 * WebHID `HIDDevice`, mobile a BLE/USB shim, and tests a scripted fake.
 */

/** The slice of WebHID's `HIDDevice` the transport uses; a BLE shim implements the same. */
export interface HidDeviceLike {
  readonly vendorId: number
  readonly productId: number
  readonly productName?: string
  readonly opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  sendReport(reportId: number, data: Uint8Array): Promise<void>
  addEventListener(type: 'inputreport', listener: (event: { readonly data: DataView }) => void): void
  removeEventListener(type: 'inputreport', listener: (event: { readonly data: DataView }) => void): void
}

export const LEDGER_VENDOR_ID = 0x2c97
export const HID_CHANNEL = 0x0101
export const HID_TAG = 0x05
export const HID_PACKET_SIZE = 64
/** Model names by USB product id high byte (Ledger's `productId >> 8`). */
export const LEDGER_MODELS: Readonly<Record<number, string>> = { 0x00: 'Ledger Blue', 0x10: 'Ledger Nano S', 0x40: 'Ledger Nano X', 0x50: 'Ledger Nano S Plus', 0x60: 'Ledger Stax', 0x70: 'Ledger Flex' }

export function ledgerModelName(productId: number, productName?: string): string {
  return LEDGER_MODELS[productId >> 8] ?? productName ?? 'Ledger'
}

export class LedgerTransportError extends Error {
  override readonly name = 'LedgerTransportError'
  constructor(
    readonly code: 'disconnected' | 'timeout' | 'framing' | 'busy',
    message: string,
  ) {
    super(message)
  }
}

/** Split one APDU into HID reports. Exported for the fake device and tests. */
export function frameApdu(apdu: Uint8Array, packetSize = HID_PACKET_SIZE): Uint8Array[] {
  const out: Uint8Array[] = []
  let offset = 0
  let seq = 0
  while (offset < apdu.length || seq === 0) {
    const packet = new Uint8Array(packetSize)
    const view = new DataView(packet.buffer)
    view.setUint16(0, HID_CHANNEL)
    packet[2] = HID_TAG
    view.setUint16(3, seq)
    let head = 5
    if (seq === 0) {
      view.setUint16(5, apdu.length)
      head = 7
    }
    const n = Math.min(packetSize - head, apdu.length - offset)
    packet.set(apdu.subarray(offset, offset + n), head)
    offset += n
    seq += 1
    out.push(packet)
  }
  return out
}

/** Reassemble reports into one APDU; returns null while more packets are needed. */
export class ApduAssembler {
  private expected = -1
  private seq = 0
  private chunks: Uint8Array[] = []
  private got = 0

  push(report: Uint8Array): Uint8Array | null {
    const view = new DataView(report.buffer, report.byteOffset, report.byteLength)
    if (report.length < 5 || view.getUint16(0) !== HID_CHANNEL || report[2] !== HID_TAG) throw new LedgerTransportError('framing', 'unexpected HID report')
    const seq = view.getUint16(3)
    if (seq !== this.seq) throw new LedgerTransportError('framing', `HID sequence ${seq}, expected ${this.seq}`)
    let head = 5
    if (seq === 0) {
      this.expected = view.getUint16(5)
      head = 7
      this.chunks = []
      this.got = 0
    }
    const n = Math.min(report.length - head, this.expected - this.got)
    this.chunks.push(report.subarray(head, head + n))
    this.got += n
    this.seq += 1
    if (this.got < this.expected) return null
    const out = new Uint8Array(this.expected)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    this.expected = -1
    this.seq = 0
    this.chunks = []
    return out
  }
}

/** One APDU at a time over one device. */
export class LedgerHidTransport {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly device: HidDeviceLike,
    private readonly timeoutMs = 60_000,
  ) {}

  get modelName(): string {
    return ledgerModelName(this.device.productId, this.device.productName)
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open()
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close().catch(() => undefined)
  }

  /** Send one APDU and resolve with the full response (status word included). */
  exchange(apdu: Uint8Array): Promise<Uint8Array> {
    const run = this.queue.then(() => this.exchangeNow(apdu))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async exchangeNow(apdu: Uint8Array): Promise<Uint8Array> {
    await this.open()
    const assembler = new ApduAssembler()
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new LedgerTransportError('timeout', 'The device did not answer. Unlock it and open the Ethereum app.'))
      }, this.timeoutMs)
      const onReport = (event: { readonly data: DataView }): void => {
        try {
          const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
          const done = assembler.push(bytes)
          if (done) {
            cleanup()
            resolve(done)
          }
        } catch (err) {
          cleanup()
          reject(err)
        }
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        this.device.removeEventListener('inputreport', onReport)
      }
      this.device.addEventListener('inputreport', onReport)
      void (async () => {
        try {
          for (const packet of frameApdu(apdu)) await this.device.sendReport(0, packet)
        } catch (err) {
          cleanup()
          reject(new LedgerTransportError('disconnected', err instanceof Error ? err.message : 'The device went away.'))
        }
      })()
    })
  }
}
