/**
 * Hardware devices in the engine (master plan §2.7 S7, §8.1): Ledger over
 * HID from the service worker. Pairing (`requestDevice`) needs a user
 * gesture and happens in tab.html; from then on the engine finds the
 * device through the `HidProvider` it was given (`navigator.hid` in the
 * extension). The signing router asks `signerFor()` for a viem account;
 * everything else — the firewall, the sheet, Activity — is unchanged.
 */
import { LedgerEthApp, LedgerError, LedgerHidTransport, LedgerTransportError, ledgerAccount, ledgerModelName, pathFor, LEDGER_VENDOR_ID, type HidDeviceLike, type HidProvider, type PathScheme } from '@boltvault/hardware'
import type { LocalAccount } from 'viem/accounts'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { AccountIdSchema, type AccountView } from '../schema'
import type { VaultManager } from './vault'

export interface HardwareDeps {
  readonly hid: HidProvider | null
  readonly vault: VaultManager
}

export interface LedgerDeviceView {
  readonly deviceId: string
  readonly model: string
}

export interface LedgerStatusView {
  readonly available: boolean
  readonly devices: LedgerDeviceView[]
  readonly app: { readonly version: string; readonly blindSigning: boolean } | null
  readonly problem: string | null
}

function deviceId(d: HidDeviceLike): string {
  return `${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.productName ?? ''}`
}

function plain(err: unknown): string {
  if (err instanceof LedgerError || err instanceof LedgerTransportError) return err.message
  return err instanceof Error ? err.message : String(err)
}

export class HardwareService {
  private transports = new Map<string, LedgerHidTransport>()

  constructor(private readonly deps: HardwareDeps) {}

  get available(): boolean {
    return this.deps.hid !== null
  }

  private async devices(): Promise<HidDeviceLike[]> {
    if (!this.deps.hid) return []
    const all = await this.deps.hid.getDevices().catch(() => [] as HidDeviceLike[])
    return all.filter((d) => d.vendorId === LEDGER_VENDOR_ID)
  }

  async listLedgers(): Promise<LedgerDeviceView[]> {
    return (await this.devices()).map((d) => ({ deviceId: deviceId(d), model: ledgerModelName(d.productId, d.productName) }))
  }

  private async app(preferred?: string): Promise<{ app: LedgerEthApp; deviceId: string; model: string }> {
    if (!this.deps.hid) throw new EngineError('not_implemented', 'Ledger over USB is not available in this body.')
    const devices = await this.devices()
    const device = (preferred ? devices.find((d) => deviceId(d) === preferred) : undefined) ?? devices[0]
    if (!device) throw new EngineError('not_found', 'No Ledger is connected. Plug it in, unlock it and open the Ethereum app.')
    const id = deviceId(device)
    let transport = this.transports.get(id)
    if (!transport || transport.device !== device) {
      transport = new LedgerHidTransport(device)
      this.transports.set(id, transport)
    }
    return { app: new LedgerEthApp(transport), deviceId: id, model: transport.modelName }
  }

  async ledgerStatus(): Promise<LedgerStatusView> {
    if (!this.deps.hid) return { available: false, devices: [], app: null, problem: null }
    const devices = await this.listLedgers()
    if (devices.length === 0) return { available: true, devices, app: null, problem: null }
    try {
      const { app } = await this.app()
      const cfg = await app.getAppConfiguration()
      return { available: true, devices, app: { version: cfg.version, blindSigning: cfg.blindSigning }, problem: null }
    } catch (err) {
      return { available: true, devices, app: null, problem: plain(err) }
    }
  }

  /** Addresses for the account picker: both schemes side by side (§8.1). */
  async ledgerAddresses(input: { scheme: PathScheme; from?: number; count?: number; deviceId?: string }): Promise<Array<{ path: string; address: string; index: number }>> {
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

  /** The signing router's hook: a viem account for a hardware account, or null when the kind is not one we drive here. */
  async signerFor(account: AccountView): Promise<LocalAccount | null> {
    if (account.kind !== 'ledger' || !account.hardware) return null
    const { app } = await this.app(account.hardware.deviceId)
    return ledgerAccount({ address: account.address as `0x${string}`, path: account.hardware.path, app })
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
}

const SchemeSchema = z.enum(['bip44', 'live'])

export function hardwareNamespace(hardware: HardwareService, vault: VaultManager): NamespaceSpec {
  return {
    ledgerStatus: { handler: () => hardware.ledgerStatus() },
    ledgerAddresses: { input: z.object({ scheme: SchemeSchema, from: z.number().int().nonnegative().optional(), count: z.number().int().positive().max(20).optional(), deviceId: z.string().optional() }), handler: (arg) => hardware.ledgerAddresses(arg as { scheme: PathScheme; from?: number; count?: number; deviceId?: string }) },
    ledgerVerify: { input: z.object({ path: z.string().min(1), deviceId: z.string().optional() }), handler: (arg) => hardware.ledgerVerify(arg as { path: string; deviceId?: string }) },
    /** Verify the account's address on the device, given an account id (the Receive screen). */
    verifyAccount: {
      input: z.object({ accountId: AccountIdSchema }),
      handler: async (arg) => {
        const a = (await vault.accounts()).find((x) => x.id === (arg as { accountId: string }).accountId)
        if (!a?.hardware) throw new EngineError('invalid_argument', 'not a hardware account')
        const { address } = await hardware.ledgerVerify({ path: a.hardware.path, ...(a.hardware.deviceId ? { deviceId: a.hardware.deviceId } : {}) })
        if (address.toLowerCase() !== a.address.toLowerCase()) throw new EngineError('internal', 'The device shows a different address for this path.')
        return { address }
      },
    },
  }
}
