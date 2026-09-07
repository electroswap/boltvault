/**
 * Every way a Ledger can reach this phone, behind the engine's one seam.
 *
 * A Nano X can arrive over either Bluetooth or a cable; a Nano S / S Plus only
 * ever over a cable. The engine asks for a list and opens an id, so the two
 * transports can simply be concatenated — ids are prefixed by their transport
 * ("usb:…" from the HID provider, the BLE peripheral id otherwise), so `open`
 * always knows which one to ask.
 *
 * Neither side is allowed to fail the whole list. A phone with Bluetooth off
 * should still show the device on the end of the cable, and vice versa.
 */
import type { LedgerTransportProvider } from '@boltvault/hardware'
import { bleLedgerProvider } from './ledger-ble'
import { hidLedgerProvider } from './ledger-hid'
import { ensureBluetoothPermission } from './permissions'

export function mobileLedgerProvider(): LedgerTransportProvider {
  const ble = bleLedgerProvider()
  const usb = hidLedgerProvider()
  const isUsb = (id: string): boolean => id.startsWith('usb:')
  return {
    // The seam names a single kind; USB is the one that needs no pairing and
    // no permission, so it is the honest label for the pair.
    kind: 'usb',
    async list() {
      // Android 12+ gates a BLE scan behind a runtime grant. Nothing asked for
      // it, so scanning silently returned nothing even with a Nano X awake.
      const scanAllowed = await ensureBluetoothPermission()
      const [usbDevices, bleDevices] = await Promise.all([
        usb.list().catch(() => []),
        scanAllowed ? ble.list().catch(() => []) : Promise.resolve([]),
      ])
      return [...usbDevices, ...bleDevices]
    },
    open(id) {
      return isUsb(id) ? usb.open(id) : ble.open(id)
    },
  }
}
