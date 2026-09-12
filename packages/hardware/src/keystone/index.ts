/**
 * `@boltvault/hardware/keystone` — the animated-QR codec and the Keystone
 * account, kept behind their own entry because the UR registry registers
 * CBOR tags at import and wants Node's Buffer: the engine loads this chunk
 * lazily in the worker, and the popup never carries it.
 */
export {
  encodeSignRequest,
  decodeSignRequest,
  decodeSignature,
  decodeAccount,
  encodeAccount,
  encodeSignature,
  decodeUr,
  UrCollector,
  asUuidBytes,
  type KeystoneDataType,
  type KeystoneSignRequestInput,
  type KeystoneSignature,
  type KeystoneAccountImport,
} from './ur'
export {
  keystoneAccount,
  type KeystoneAccountInput,
  type KeystoneBridge,
  type KeystoneRequest,
} from './account'
export { FakeKeystone, type FakeKeystoneOptions } from './fake'
