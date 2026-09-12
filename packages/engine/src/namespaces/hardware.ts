/**
 * Hardware devices in the engine (master plan §2.7 S7, §8.1, §5.4): Ledger
 * through one transport seam (WebHID from the service worker, BLE on the
 * phone), Trezor through Connect's five calls (the hosted popup on the
 * extension; watch-only + remote sign on the phone), Keystone over animated
 * QR on every body. The signing router asks `signerFor()` for a viem
 * account; everything else — the firewall, the sheet, Activity — is
 * unchanged. Keystone's round trip is a pending table the UI drains.
 */
import {
  LedgerEthApp,
  LedgerError,
  LedgerTransportError,
  TrezorError,
  hidLedgerProvider,
  ledgerAccount,
  pathFor,
  trezorAccount,
  unwrapTrezor,
  type HidProvider,
  type KeystoneBridge,
  type KeystoneRequest,
  type LedgerTransportProvider,
  type PathScheme,
  type TrezorConnectLike,
} from '@boltvault/hardware'
import type * as KeystoneCodec from '@boltvault/hardware/keystone'
import type { Platform } from '@boltvault/platform'
import type { LocalAccount } from 'viem/accounts'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { AccountIdSchema, type AccountView, type KeystonePending } from '../schema'
import type { VaultManager } from './vault'

export interface HardwareDeps {
  readonly hid: HidProvider | null
  /** A transport provider when the body has one that is not WebHID (BLE on the phone). */
  readonly ledger?: LedgerTransportProvider | null
  readonly trezor?: TrezorConnectLike | null
  readonly vault: VaultManager
  readonly bus: EventBus
  readonly platform: Platform
  readonly keystoneTimeoutMs?: number
}

export interface LedgerDeviceView {
  readonly deviceId: string
  readonly model: string
}

/** The answer to "can we sign on this device right now", and what to do if not. */
export interface LedgerPreflightView {
  readonly state:
    'ready' | 'no_device' | 'locked' | 'wrong_app' | 'no_answer' | 'unavailable' | 'error'
  /** Null only when ready; otherwise the sentence to show. */
  readonly message: string | null
  /** Whether blind signing is on, when we could ask. */
  readonly blindSigning: boolean | null
}

export interface LedgerStatusView {
  readonly available: boolean
  readonly transport: 'hid' | 'ble' | 'usb' | null
  readonly devices: LedgerDeviceView[]
  readonly app: { readonly version: string; readonly blindSigning: boolean } | null
  readonly problem: string | null
}

export interface TrezorStatusView {
  readonly available: boolean
  readonly model: string | null
  readonly label: string | null
  readonly problem: string | null
}

/**
 * Trezor Connect's required manifest. Both values are public by design — the
 * email is a contact address Trezor shows to users, not a credential. Named
 * here because a store reviewer reading the bundle will ask (audit F6).
 */
const TREZOR_MANIFEST = { email: 'wallet@electroswap.io', appUrl: 'https://wallet.electroswap.io' }

/** The QR codec is a worker-only chunk (CBOR registry + Buffer); loaded on the first Keystone call. */

const keystoneCodec = (): Promise<typeof KeystoneCodec> => import('@boltvault/hardware/keystone')

function plain(err: unknown): string {
  if (
    err instanceof LedgerError ||
    err instanceof LedgerTransportError ||
    err instanceof TrezorError
  )
    return err.message
  return err instanceof Error ? err.message : String(err)
}

export class HardwareService {
  private readonly ledger: LedgerTransportProvider | null
  private trezorReady: Promise<void> | null = null
  private keystone = new Map<
    string,
    {
      view: KeystonePending
      requestId: Uint8Array
      resolve: (sig: Uint8Array) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(private readonly deps: HardwareDeps) {
    this.ledger = deps.ledger ?? (deps.hid ? hidLedgerProvider(deps.hid) : null)
  }

  get available(): boolean {
    return this.ledger !== null
  }

  /** Whether this body can drive the account's signer itself (else remote sign, §6). */
  canSign(account: AccountView): boolean {
    if (account.kind === 'hd' || account.kind === 'imported') return true
    if (account.kind === 'ledger') return this.ledger !== null
    if (account.kind === 'trezor') return !!this.deps.trezor
    if (account.kind === 'keystone') return true
    return false
  }

  // ---- Ledger --------------------------------------------------------------------

  async listLedgers(): Promise<LedgerDeviceView[]> {
    if (!this.ledger) return []
    return (await this.ledger.list().catch(() => [])).map((d) => ({
      deviceId: d.id,
      model: d.model,
    }))
  }

  private async app(
    preferred?: string,
  ): Promise<{ app: LedgerEthApp; deviceId: string; model: string }> {
    if (!this.ledger)
      throw new EngineError('not_implemented', 'Ledger is not available in this body.')
    const devices = await this.ledger.list()
    /*
      A named device is the only acceptable answer to a request for that
      device. This used to fall through to `devices[0]`, so "the Ledger this
      account came from is not connected" quietly became "sign on whichever
      Ledger is plugged in" — and since the device id is only
      vendor:product:name, two units of the same model are indistinguishable
      anyway. A second device at the same derivation path returns a perfectly
      valid signature from a different seed.
    */
    const device = preferred ? devices.find((d) => d.id === preferred) : devices[0]
    if (!device && preferred)
      throw new EngineError(
        'not_found',
        'That Ledger is not connected. Connect the device this account was added from.',
      )
    if (!device)
      throw new EngineError(
        'not_found',
        this.ledger.kind === 'ble'
          ? 'No Ledger is in range. Turn it on, unlock it and open the Ethereum app.'
          : 'No Ledger is connected. Plug it in, unlock it and open the Ethereum app.',
      )
    const transport = await this.ledger.open(device.id)
    return { app: new LedgerEthApp(transport), deviceId: device.id, model: transport.model }
  }

  /**
   * Can this Ledger be asked to sign right now? Bounded, and shows nothing on
   * the device — safe to call while a sheet is being read.
   */
  async ledgerPreflight(deviceId?: string): Promise<LedgerPreflightView> {
    if (!this.ledger)
      return {
        state: 'unavailable',
        message: 'Ledger is not available in this body.',
        blindSigning: null,
      }
    const devices = await this.ledger.list().catch(() => [])
    if (devices.length === 0) {
      const message =
        this.ledger.kind === 'ble'
          ? 'No Ledger is in range. Turn it on, unlock it and open the Ethereum app.'
          : 'No Ledger is connected. Plug it in, unlock it and open the Ethereum app.'
      return { state: 'no_device', message, blindSigning: null }
    }
    try {
      const { app } = await this.app(deviceId)
      const readiness = await app.ready()
      if (readiness.state === 'ready')
        return { state: 'ready', message: null, blindSigning: readiness.app.blindSigning }
      return { state: readiness.state, message: readiness.message, blindSigning: null }
    } catch (err) {
      return { state: 'error', message: plain(err), blindSigning: null }
    }
  }

  async ledgerStatus(): Promise<LedgerStatusView> {
    if (!this.ledger)
      return { available: false, transport: null, devices: [], app: null, problem: null }
    const devices = await this.listLedgers()
    if (devices.length === 0)
      return { available: true, transport: this.ledger.kind, devices, app: null, problem: null }
    try {
      const { app } = await this.app()
      // Bounded: an unlocked device on the dashboard answers this by not
      // answering, and the Devices screen should say so in a moment rather
      // than hold a spinner for the transport's full minute.
      const cfg = await app.getAppConfiguration(3_000)
      return {
        available: true,
        transport: this.ledger.kind,
        devices,
        app: { version: cfg.version, blindSigning: cfg.blindSigning },
        problem: null,
      }
    } catch (err) {
      return {
        available: true,
        transport: this.ledger.kind,
        devices,
        app: null,
        problem:
          err instanceof LedgerTransportError
            ? 'Open the Ethereum app on your Ledger.'
            : plain(err),
      }
    }
  }

  /** Addresses for the account picker: both schemes side by side (§8.1). */
  async ledgerAddresses(input: {
    scheme: PathScheme
    from?: number
    count?: number
    deviceId?: string
  }): Promise<Array<{ path: string; address: string; index: number }>> {
    const { app } = await this.app(input.deviceId)
    const from = input.from ?? 0
    const count = Math.min(input.count ?? 5, 20)
    const out: Array<{ path: string; address: string; index: number }> = []
    try {
      for (let i = from; i < from + count; i++) {
        const path = pathFor(input.scheme, i)
        const { address } = await app.getAddress(path)
        out.push({ path, address, index: i })
      }
    } catch (err) {
      throw new EngineError('internal', plain(err))
    }
    return out
  }

  /** Show the address on the device (§8.5 "Verify on device"). */
  async ledgerVerify(input: { path: string; deviceId?: string }): Promise<{ address: string }> {
    const { app } = await this.app(input.deviceId)
    try {
      const { address } = await app.getAddress(input.path, true)
      return { address }
    } catch (err) {
      throw new EngineError('internal', plain(err))
    }
  }

  /** Whether a Ledger account can sign a transaction with calldata right now (blind signing on). */
  async ledgerCanSignData(): Promise<boolean> {
    try {
      const { app } = await this.app()
      return (await app.getAppConfiguration()).blindSigning
    } catch {
      return false
    }
  }

  // ---- Trezor --------------------------------------------------------------------

  private async trezor(): Promise<TrezorConnectLike> {
    const c = this.deps.trezor
    if (!c)
      throw new EngineError(
        'not_implemented',
        'Trezor signs from the browser extension; on the phone a Trezor account is watch-only and signs on a paired device.',
      )
    this.trezorReady ??= c.init({ manifest: TREZOR_MANIFEST }).catch((err: unknown) => {
      this.trezorReady = null
      throw err
    })
    await this.trezorReady
    return c
  }

  async trezorStatus(): Promise<TrezorStatusView> {
    if (!this.deps.trezor) return { available: false, model: null, label: null, problem: null }
    try {
      const c = await this.trezor()
      const f = unwrapTrezor(await c.getFeatures())
      return {
        available: true,
        model: f.model ?? f.internal_model ?? null,
        label: f.label ?? null,
        problem: null,
      }
    } catch (err) {
      return { available: true, model: null, label: null, problem: plain(err) }
    }
  }

  async trezorAddresses(input: {
    scheme: PathScheme
    from?: number
    count?: number
  }): Promise<Array<{ path: string; address: string; index: number }>> {
    const c = await this.trezor()
    const from = input.from ?? 0
    const count = Math.min(input.count ?? 5, 20)
    const paths = Array.from({ length: count }, (_, i) => pathFor(input.scheme, from + i))
    try {
      const rows = unwrapTrezor(
        await c.ethereumGetAddressBundle({
          bundle: paths.map((path) => ({ path, showOnTrezor: false as const })),
        }),
      )
      /*
        Pair each address with the path the device says it came from, not with
        the path at the same array index.

        Trezor Connect runs in a hosted popup — a third-party surface — and it
        returns `serializedPath` on every row, which the result schema already
        parses and this code then discarded. Zipping by index meant a reordered
        or truncated answer stored an address against the wrong derivation path
        (and `paths[i] ?? ''` turned a short answer into an empty path rather
        than an error). Every later signature would then come from a different
        key than the address on screen, and the pair is synced to the user's
        other devices as well.
      */
      if (rows.length !== paths.length)
        throw new EngineError(
          'internal',
          'The device returned a different number of addresses than were asked for.',
        )
      return rows.map((r, i) => {
        const expected = paths[i] ?? ''
        const got = r.serializedPath ?? ''
        if (got !== expected)
          throw new EngineError(
            'internal',
            'The device answered for a different derivation path than the one requested.',
          )
        return { path: expected, address: r.address, index: from + i }
      })
    } catch (err) {
      throw new EngineError('internal', plain(err))
    }
  }

  async trezorVerify(input: { path: string }): Promise<{ address: string }> {
    const c = await this.trezor()
    try {
      const r = unwrapTrezor(await c.ethereumGetAddress({ path: input.path, showOnTrezor: true }))
      return { address: r.address }
    } catch (err) {
      throw new EngineError('internal', plain(err))
    }
  }

  // ---- Keystone ------------------------------------------------------------------

  /** Parse the device's account QR (crypto-hdkey / crypto-account) into the picker's rows. */
  async keystoneImport(input: {
    parts: string[]
    count?: number
  }): Promise<{
    xfp: string
    name: string | null
    addresses: Array<{ path: string; address: string; index: number }>
  }> {
    try {
      const { decodeAccount } = await keystoneCodec()
      const a = decodeAccount(input.parts, Math.min(input.count ?? 5, 20))
      return { xfp: a.xfp, name: a.name, addresses: a.addresses }
    } catch (err) {
      throw new EngineError('invalid_argument', plain(err))
    }
  }

  keystonePending(): KeystonePending[] {
    return [...this.keystone.values()].map((p) => p.view)
  }

  private emitKeystone(): void {
    this.deps.bus.emit({ type: 'hardware.keystone', pending: this.keystonePending() })
  }

  private get bridge(): KeystoneBridge {
    return {
      random: (n) => this.deps.platform.random(n),
      request: (req: KeystoneRequest) =>
        new Promise<Uint8Array>((resolve, reject) => {
          const id = Array.from(req.requestId, (b) => b.toString(16).padStart(2, '0')).join('')
          const timer = setTimeout(
            () => {
              this.keystone.delete(id)
              this.emitKeystone()
              reject(new EngineError('internal', 'The Keystone did not answer in time.'))
            },
            this.deps.keystoneTimeoutMs ?? 5 * 60_000,
          )
          this.keystone.set(id, {
            view: {
              id,
              frames: req.frames,
              kind: req.dataType,
              address: req.address,
              path: req.path,
              createdAt: this.deps.platform.now(),
            },
            requestId: req.requestId,
            resolve,
            reject,
            timer,
          })
          this.emitKeystone()
        }),
    }
  }

  /** The scanned `eth-signature` for a pending request; the request id must match. */
  async keystoneSubmit(input: { id: string; parts: string[] }): Promise<{ ok: true }> {
    const p = this.keystone.get(input.id)
    if (!p) throw new EngineError('not_found', 'That signing request is no longer waiting.')
    const { decodeSignature } = await keystoneCodec()
    let sig: ReturnType<typeof decodeSignature>
    try {
      sig = decodeSignature(input.parts)
    } catch (err) {
      throw new EngineError('invalid_argument', plain(err))
    }
    const got = sig.requestId
      ? Array.from(sig.requestId, (b) => b.toString(16).padStart(2, '0')).join('')
      : null
    // The binding is required, not optional: a signature that carries no request
    // id is not evidence that this request was the one the device answered, and
    // nothing downstream re-checks it (the engine never recovers a signature
    // against the expected address).
    if (!got || got !== input.id)
      throw new EngineError(
        'invalid_argument',
        'That signature answers a different request. Scan the QR for this one.',
      )
    clearTimeout(p.timer)
    this.keystone.delete(input.id)
    this.emitKeystone()
    p.resolve(sig.signature)
    return { ok: true }
  }

  keystoneCancel(input: { id: string }): { ok: true } {
    const p = this.keystone.get(input.id)
    if (p) {
      clearTimeout(p.timer)
      this.keystone.delete(input.id)
      this.emitKeystone()
      p.reject(new EngineError('rejected', 'Cancelled.'))
    }
    return { ok: true }
  }

  // ---- The signing router's hook -------------------------------------------------

  /** A viem account for a hardware account this body can drive; null when it cannot (remote sign may). */
  async signerFor(account: AccountView): Promise<LocalAccount | null> {
    if (!account.hardware) return null
    if (account.kind === 'ledger') {
      if (!this.ledger) return null
      const { app } = await this.app(account.hardware.deviceId)
      /*
        Ask the device whether it can sign before sending it anything to sign.

        On the dashboard the Ethereum app's APDU class belongs to no running
        app, and rather than returning 0x6511 some firmware does not answer at
        all — so the first signing APDU sat there for the transport's full
        minute and the sheet spun. Owner: "Connecting to ledger spins if not in
        the Ethereum app on the ledger device, should do a pre-flight check to
        detect HW readiness before attempting to send."

        `ready()` is bounded at three seconds and shows nothing on the device,
        so the cost of asking is nothing and the answer is a sentence the user
        can act on.
      */
      const readiness = await app.ready()
      if (readiness.state !== 'ready') throw new EngineError('invalid_argument', readiness.message)
      /*
        Ask the device which address it holds at this path, before asking it to
        sign. The same check already existed as "verify on device" on the
        Receive screen, where it needs a button press; without `verify` it is
        one APDU, shows nothing, and needs no one to be looking. A device
        holding a different seed is caught here rather than after it has
        produced a signature for an account the user never chose.
      */
      const onDevice = await app.getAddress(account.hardware.path).catch(() => null)
      if (!onDevice)
        throw new EngineError('internal', 'The device did not say which account it holds.')
      if (onDevice.address.toLowerCase() !== account.address.toLowerCase())
        throw new EngineError(
          'internal',
          'This Ledger holds a different account at that path. Connect the device this account was added from.',
        )
      return ledgerAccount({
        address: account.address as `0x${string}`,
        path: account.hardware.path,
        app,
      })
    }
    if (account.kind === 'trezor') {
      if (!this.deps.trezor) return null
      const connect = await this.trezor()
      const status = await this.trezorStatus()
      return trezorAccount({
        address: account.address as `0x${string}`,
        path: account.hardware.path,
        connect,
        hashesOnly: status.model === '1',
      })
    }
    if (account.kind === 'keystone') {
      const { keystoneAccount } = await keystoneCodec()
      return keystoneAccount({
        address: account.address as `0x${string}`,
        path: account.hardware.path,
        xfp: account.hardware.deviceId ?? '00000000',
        bridge: this.bridge,
      })
    }
    return null
  }

  dispose(): void {
    for (const p of this.keystone.values()) {
      clearTimeout(p.timer)
      p.reject(new EngineError('rejected', 'Shutting down.'))
    }
    this.keystone.clear()
  }
}

const SchemeSchema = z.enum(['bip44', 'live'])

export function hardwareNamespace(hardware: HardwareService, vault: VaultManager): NamespaceSpec {
  return {
    ledgerStatus: { handler: () => hardware.ledgerStatus() },
    ledgerPreflight: {
      input: z.object({ deviceId: z.string().optional() }).optional(),
      handler: (arg) =>
        hardware.ledgerPreflight((arg as { deviceId?: string } | undefined)?.deviceId),
    },
    ledgerAddresses: {
      input: z.object({
        scheme: SchemeSchema,
        from: z.number().int().nonnegative().optional(),
        count: z.number().int().positive().max(20).optional(),
        deviceId: z.string().optional(),
      }),
      handler: (arg) =>
        hardware.ledgerAddresses(
          arg as { scheme: PathScheme; from?: number; count?: number; deviceId?: string },
        ),
    },
    ledgerVerify: {
      input: z.object({ path: z.string().min(1), deviceId: z.string().optional() }),
      handler: (arg) => hardware.ledgerVerify(arg as { path: string; deviceId?: string }),
    },
    trezorStatus: { handler: () => hardware.trezorStatus() },
    trezorAddresses: {
      input: z.object({
        scheme: SchemeSchema,
        from: z.number().int().nonnegative().optional(),
        count: z.number().int().positive().max(20).optional(),
      }),
      handler: (arg) =>
        hardware.trezorAddresses(arg as { scheme: PathScheme; from?: number; count?: number }),
    },
    trezorVerify: {
      input: z.object({ path: z.string().min(1) }),
      handler: (arg) => hardware.trezorVerify(arg as { path: string }),
    },
    keystoneImport: {
      input: z.object({
        parts: z.array(z.string().min(1)).min(1),
        count: z.number().int().positive().max(20).optional(),
      }),
      handler: async (arg) => hardware.keystoneImport(arg as { parts: string[]; count?: number }),
    },
    keystonePending: { handler: async () => hardware.keystonePending() },
    keystoneSubmit: {
      input: z.object({ id: z.string(), parts: z.array(z.string().min(1)).min(1) }),
      handler: async (arg) => hardware.keystoneSubmit(arg as { id: string; parts: string[] }),
    },
    keystoneCancel: {
      input: z.object({ id: z.string() }),
      handler: async (arg) => hardware.keystoneCancel(arg as { id: string }),
    },
    /** Verify the account's address on its device, given an account id (the Receive screen). */
    verifyAccount: {
      input: z.object({ accountId: AccountIdSchema }),
      handler: async (arg) => {
        const a = (await vault.accounts()).find(
          (x) => x.id === (arg as { accountId: string }).accountId,
        )
        if (!a?.hardware) throw new EngineError('invalid_argument', 'not a hardware account')
        if (a.kind === 'keystone')
          throw new EngineError(
            'not_implemented',
            'A Keystone shows its addresses on the device itself; compare it there.',
          )
        const { address } =
          a.kind === 'trezor'
            ? await hardware.trezorVerify({ path: a.hardware.path })
            : await hardware.ledgerVerify({
                path: a.hardware.path,
                ...(a.hardware.deviceId ? { deviceId: a.hardware.deviceId } : {}),
              })
        if (address.toLowerCase() !== a.address.toLowerCase())
          throw new EngineError('internal', 'The device shows a different address for this path.')
        return { address }
      },
    },
  }
}
