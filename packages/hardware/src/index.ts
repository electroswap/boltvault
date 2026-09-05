/**
 * @boltvault/hardware — device signers (master plan §2.7 S3/S7). M5 ships
 * Ledger over HID from the service worker; BLE, Trezor's hosted Connect and
 * Keystone's QR flows land with M8 on the same shapes.
 */
import type { HidDeviceLike } from './ledger/hid'

export { LedgerHidTransport, ApduAssembler, frameApdu, ledgerModelName, LedgerTransportError, LEDGER_VENDOR_ID, HID_PACKET_SIZE, type HidDeviceLike } from './ledger/hid'
export { LedgerError, buildApdu, unwrapResponse, errorForStatus, statusWord, concatBytes, INS, CLA, type LedgerErrorCode } from './ledger/apdu'
export { LedgerEthApp, eip155TailOffset, type ApduTransport, type AppConfiguration, type RawSignature } from './ledger/eth'
export { ledgerAccount, type LedgerAccountInput } from './ledger/account'
export { pathFor, pathToBytes, schemeOf, type PathScheme } from './ledger/paths'
export { yParityFromLedgerV, legacyV } from './ledger/v'
export { FakeLedgerDevice, FakeEthApp, fakeHidProvider, type FakeLedgerOptions } from './ledger/fake'

/** What the service worker hands the engine: WebHID's `navigator.hid` or a BLE/USB shim with the same two calls. */
export interface HidProvider {
  getDevices(): Promise<HidDeviceLike[]>
}
