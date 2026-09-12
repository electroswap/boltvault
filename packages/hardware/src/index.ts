/**
 * @boltvault/hardware — device signers (master plan §2.7 S3/S7): Ledger over
 * HID from the service worker and BLE on the phone through one transport
 * seam, Trezor through Connect's five calls behind an interface, Keystone
 * over animated QR. Every device has a scripted fake so the wallet's bytes
 * are exercised without hardware; real devices are manual-gated (§12).
 */
export {
  LedgerHidTransport,
  ApduAssembler,
  frameApdu,
  ledgerModelName,
  LedgerTransportError,
  LEDGER_VENDOR_ID,
  HID_PACKET_SIZE,
  type HidDeviceLike,
} from './ledger/hid'
export {
  LedgerError,
  buildApdu,
  unwrapResponse,
  errorForStatus,
  statusWord,
  concatBytes,
  INS,
  CLA,
  type LedgerErrorCode,
} from './ledger/apdu'
export {
  LedgerEthApp,
  eip155TailOffset,
  supportsClearSigning,
  CLEAR_SIGNING_MIN_VERSION,
  type ApduTransport,
  type AppConfiguration,
  type RawSignature,
} from './ledger/eth'
export {
  eip712Plan,
  definitionField,
  encodeLeaf,
  leafType,
  parseType,
  Eip712Unsupported,
  DEF as EIP712_DEF_P2,
  IMPL as EIP712_IMPL_P2,
  type Eip712Field,
  type Eip712Step,
  type Eip712TypedData,
} from './ledger/eip712'
export { ledgerAccount, type LedgerAccountInput } from './ledger/account'
export { pathFor, pathToBytes, schemeOf, type PathScheme } from './ledger/paths'
export { yParityFromLedgerV, yParityByRecovery, legacyV } from './ledger/v'
export {
  FakeLedgerDevice,
  FakeEthApp,
  fakeHidProvider,
  type FakeLedgerOptions,
} from './ledger/fake'
export {
  hidLedgerProvider,
  hidDeviceId,
  type HidProvider,
  type LedgerTransportProvider,
  type LedgerDeviceInfo,
} from './ledger/provider'

export {
  TREZOR_CONNECT_SRC,
  TrezorError,
  trezorErrorMessage,
  unwrap as unwrapTrezor,
  yParityFromTrezorV,
  TrezorAddressResult,
  TrezorAddressBundleResult,
  TrezorSignatureResult,
  TrezorMessageResult,
  TrezorFeaturesResult,
  type TrezorConnectLike,
  type TrezorResult,
  type TrezorFeatures,
  type TrezorTransactionInput,
} from './trezor/connect'
export {
  trezorAccount,
  normaliseSignature as normaliseTrezorSignature,
  type TrezorAccountInput,
} from './trezor/account'
export { FakeTrezorConnect, type FakeTrezorOptions } from './trezor/fake'

// Keystone (animated QR) lives at `@boltvault/hardware/keystone`: the UR registry registers CBOR tags at import and needs Buffer, so only the worker loads it, lazily.
export type { KeystoneBridge, KeystoneRequest, KeystoneDataType } from './keystone/account'
