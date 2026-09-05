/**
 * Vault + accounts — custody state for M0.
 *
 * Storage (via Platform):
 *   secret  `vault.file`        VaultFileV1 envelope (ciphertext)
 *   session `vault.seedHex`     unlocked seed — cleared on lock / browser exit
 *   session `vault.unlockedAt`, `vault.lockAt`
 *   session `accounts.session`  AccountView[] cache so `accounts.list` survives
 *                               a service-worker restart without re-unlocking
 *   local   `accounts.active`   the seated account id
 *   local   `accounts.meta`     label/hidden overrides (moves under the DEK
 *                               with vault v2 in M2 — see master plan §3.2)
 *
 * Auto-lock is a platform alarm, never a timer: the alarm survives SW
 * eviction, and firing it wipes every session key above.
 */
import {
  accountsFromPlaintext,
  buildAccount,
  createVault,
  generateEntropy,
  openVault,
  seedHexFromMnemonic,
  validateMnemonicStr,
  type VaultAccount,
  type VaultFileV1,
  type VaultPlaintext,
} from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import {
  AccountIdSchema,
  AccountViewSchema,
  AutoLockSchema,
  type AccountView,
  type AutoLock,
  type VaultStatus,
} from '../schema'
import type { SettingsStore } from '../settingsStore'
import { readDoc, writeDoc, type DocSpec } from '../storage'

const KEY_FILE = 'vault.file'
const KEY_SEED = 'vault.seedHex'
const KEY_UNLOCKED_AT = 'vault.unlockedAt'
const KEY_LOCK_AT = 'vault.lockAt'
export const AUTOLOCK_ALARM = 'vault.autolock'

const AUTO_LOCK_MS: Record<AutoLock, number> = {
  immediately: 0,
  '1min': 60_000,
  '5min': 300_000,
  '30min': 1_800_000,
  never: Number.POSITIVE_INFINITY,
}

const ACCOUNTS_SESSION: DocSpec<AccountView[]> = {
  key: 'accounts.session',
  version: 1,
  schema: z.array(AccountViewSchema),
  defaultValue: () => [],
}

const ACTIVE_DOC: DocSpec<{ id: string | null }> = {
  key: 'accounts.active',
  version: 1,
  schema: z.object({ id: z.string().nullable() }),
  defaultValue: () => ({ id: null }),
}

const MetaSchema = z.record(z.string(), z.object({ label: z.string().max(64).optional(), hidden: z.boolean().optional() }))
type AccountMeta = z.infer<typeof MetaSchema>
const META_DOC: DocSpec<AccountMeta> = {
  key: 'accounts.meta',
  version: 1,
  schema: MetaSchema,
  defaultValue: () => ({}),
}

function toView(a: VaultAccount, meta: AccountMeta): AccountView {
  const m = meta[a.id]
  const base: AccountView = {
    id: a.id,
    kind: a.kind,
    label: m?.label ?? a.label,
    address: a.address,
    hasKey: a.hasKey,
    hidden: m?.hidden ?? false,
    createdAt: a.createdAt,
  }
  return a.index === undefined ? base : { ...base, index: a.index }
}

export class VaultManager {
  private stopAlarms: (() => void) | null = null

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly settings: SettingsStore,
  ) {}

  /** Subscribe to the auto-lock alarm. Idempotent. */
  init(): void {
    if (this.stopAlarms) return
    this.stopAlarms = this.platform.alarms.onFire((name) => {
      if (name === AUTOLOCK_ALARM) void this.lock()
    })
  }

  dispose(): void {
    this.stopAlarms?.()
    this.stopAlarms = null
  }

  private async readFile(): Promise<VaultFileV1 | null> {
    const raw = await this.platform.storage.secret.get(KEY_FILE)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as VaultFileV1
    } catch {
      return null
    }
  }

  async status(): Promise<VaultStatus> {
    const [exists, seed, unlockedAt, lockAt, settings] = await Promise.all([
      this.platform.storage.secret.get(KEY_FILE),
      this.platform.storage.session.get(KEY_SEED),
      this.platform.storage.session.get(KEY_UNLOCKED_AT),
      this.platform.storage.session.get(KEY_LOCK_AT),
      this.settings.get(),
    ])
    const unlocked = seed !== null
    return {
      exists: exists !== null,
      unlocked,
      unlockedAt: unlocked && unlockedAt !== null ? Number(unlockedAt) : null,
      lockAt: unlocked && lockAt !== null ? Number(lockAt) : null,
      autoLock: settings.autoLock,
    }
  }

  async isUnlocked(): Promise<boolean> {
    return (await this.platform.storage.session.get(KEY_SEED)) !== null
  }

  async create(input: { password: string; bits?: 128 | 256 }): Promise<{ accounts: AccountView[]; mnemonic: string }> {
    if (await this.readFile()) throw new EngineError('invalid_argument', 'a vault already exists')
    const entropy = generateEntropy(input.bits ?? 128)
    const accounts = await this.createFromMnemonic(entropy.mnemonic, input.password)
    return { accounts, mnemonic: entropy.mnemonic }
  }

  async import(input: { mnemonic: string; password: string }): Promise<{ accounts: AccountView[] }> {
    if (await this.readFile()) throw new EngineError('invalid_argument', 'a vault already exists')
    const accounts = await this.createFromMnemonic(input.mnemonic, input.password)
    return { accounts }
  }

  private async createFromMnemonic(mnemonic: string, password: string): Promise<AccountView[]> {
    const trimmed = mnemonic.trim().toLowerCase().split(/\s+/).join(' ')
    if (!validateMnemonicStr(trimmed)) throw new EngineError('invalid_mnemonic', 'that is not a valid recovery phrase')
    const seedHex = seedHexFromMnemonic(trimmed)
    const first = buildAccount({ kind: 'hd', label: 'Account 1', index: 0 }, seedHex)
    const pt: VaultPlaintext = { seedHex, mnemonic: trimmed, importedKeys: {}, accounts: [first.meta] }
    const file = await createVault(password, pt)
    await this.platform.storage.secret.set(KEY_FILE, JSON.stringify(file))
    await writeDoc(this.platform.storage.local, ACTIVE_DOC, { id: first.meta.id })
    return this.unlockWithPlaintext(pt)
  }

  async unlock(input: { password: string }): Promise<{ accounts: AccountView[] }> {
    const file = await this.readFile()
    if (!file) throw new EngineError('no_vault', 'no vault exists yet')
    const pt = await openVault(file, input.password)
    if (!pt) throw new EngineError('wrong_password', 'wrong password')
    return { accounts: await this.unlockWithPlaintext(pt) }
  }

  private async unlockWithPlaintext(pt: VaultPlaintext): Promise<AccountView[]> {
    const meta = (await readDoc(this.platform.storage.local, META_DOC, () => this.platform.now())).value
    const views = accountsFromPlaintext(pt).map((a) => toView(a, meta))
    const session = this.platform.storage.session
    if (pt.seedHex) await session.set(KEY_SEED, pt.seedHex)
    await session.set(KEY_UNLOCKED_AT, String(this.platform.now()))
    await writeDoc(session, ACCOUNTS_SESSION, views)
    await this.scheduleAutoLock()
    await this.emitAll(views)
    return views
  }

  private async scheduleAutoLock(): Promise<void> {
    const { autoLock } = await this.settings.get()
    const ms = AUTO_LOCK_MS[autoLock]
    if (ms === 0) {
      // "immediately" means: lock as soon as the UI closes. The UI calls lock()
      // on blur; the engine keeps a short safety net.
      await this.platform.alarms.schedule(AUTOLOCK_ALARM, this.platform.now() + 30_000)
      await this.platform.storage.session.set(KEY_LOCK_AT, String(this.platform.now() + 30_000))
      return
    }
    if (!Number.isFinite(ms)) {
      await this.platform.alarms.cancel(AUTOLOCK_ALARM)
      await this.platform.storage.session.remove(KEY_LOCK_AT)
      return
    }
    const at = this.platform.now() + ms
    await this.platform.alarms.schedule(AUTOLOCK_ALARM, at)
    await this.platform.storage.session.set(KEY_LOCK_AT, String(at))
  }

  /** Re-arm the auto-lock after a settings change (no-op when locked). */
  async applyAutoLock(): Promise<VaultStatus> {
    if (await this.isUnlocked()) await this.scheduleAutoLock()
    const status = await this.status()
    this.bus.emit({ type: 'vault.status', status })
    return status
  }

  async lock(): Promise<void> {
    const session = this.platform.storage.session
    await Promise.all([session.remove(KEY_SEED), session.remove(KEY_UNLOCKED_AT), session.remove(KEY_LOCK_AT), session.remove(ACCOUNTS_SESSION.key)])
    await this.platform.alarms.cancel(AUTOLOCK_ALARM)
    await this.emitAll([])
  }

  async reveal(input: { password: string }): Promise<{ mnemonic: string }> {
    const file = await this.readFile()
    if (!file) throw new EngineError('no_vault', 'no vault exists yet')
    const pt = await openVault(file, input.password)
    if (!pt) throw new EngineError('wrong_password', 'wrong password')
    if (!pt.mnemonic) throw new EngineError('not_found', 'this vault has no recovery phrase')
    return { mnemonic: pt.mnemonic }
  }

  /** The unlocked seed, for the signing router. Null when locked. */
  async seedHex(): Promise<string | null> {
    return this.platform.storage.session.get(KEY_SEED)
  }

  // ---- accounts -------------------------------------------------------------

  async accounts(): Promise<AccountView[]> {
    if (!(await this.isUnlocked())) return []
    return (await readDoc(this.platform.storage.session, ACCOUNTS_SESSION, () => this.platform.now())).value
  }

  async activeId(): Promise<string | null> {
    return (await readDoc(this.platform.storage.local, ACTIVE_DOC, () => this.platform.now())).value.id
  }

  async active(): Promise<AccountView | null> {
    const [accounts, id] = await Promise.all([this.accounts(), this.activeId()])
    return accounts.find((a) => a.id === id) ?? accounts[0] ?? null
  }

  async setActive(id: string): Promise<AccountView> {
    const accounts = await this.accounts()
    const found = accounts.find((a) => a.id === id)
    if (!found) throw new EngineError('not_found', 'no such account')
    await writeDoc(this.platform.storage.local, ACTIVE_DOC, { id })
    this.bus.emit({ type: 'accounts.changed', accounts, activeId: id })
    return found
  }

  async rename(id: string, label: string): Promise<AccountView> {
    const accounts = await this.accounts()
    const idx = accounts.findIndex((a) => a.id === id)
    const current = accounts[idx]
    if (!current) throw new EngineError('not_found', 'no such account')
    const meta = (await readDoc(this.platform.storage.local, META_DOC, () => this.platform.now())).value
    meta[id] = { ...meta[id], label }
    await writeDoc(this.platform.storage.local, META_DOC, meta)
    const updated: AccountView = { ...current, label }
    const next = accounts.map((a) => (a.id === id ? updated : a))
    await writeDoc(this.platform.storage.session, ACCOUNTS_SESSION, next)
    this.bus.emit({ type: 'accounts.changed', accounts: next, activeId: await this.activeId() })
    return updated
  }

  private async emitAll(accounts: AccountView[]): Promise<void> {
    this.bus.emit({ type: 'vault.status', status: await this.status() })
    this.bus.emit({ type: 'accounts.changed', accounts, activeId: accounts.length ? await this.activeId() : null })
  }
}

const PasswordSchema = z.string().min(1).max(1024)

export function vaultNamespace(vault: VaultManager, settings: SettingsStore): NamespaceSpec {
  return {
    status: { handler: () => vault.status() },
    create: {
      input: z.object({ password: PasswordSchema, bits: z.union([z.literal(128), z.literal(256)]).optional() }),
      handler: (arg) => vault.create(arg as { password: string; bits?: 128 | 256 }),
    },
    import: {
      input: z.object({ mnemonic: z.string().min(1).max(2048), password: PasswordSchema }),
      handler: (arg) => vault.import(arg as { mnemonic: string; password: string }),
    },
    unlock: {
      input: z.object({ password: PasswordSchema }),
      handler: (arg) => vault.unlock(arg as { password: string }),
    },
    lock: { handler: () => vault.lock() },
    reveal: {
      input: z.object({ password: PasswordSchema }),
      handler: (arg) => vault.reveal(arg as { password: string }),
    },
    setAutoLock: {
      input: z.object({ autoLock: AutoLockSchema }),
      handler: async (arg) => {
        await settings.set({ autoLock: (arg as { autoLock: AutoLock }).autoLock })
        return vault.applyAutoLock()
      },
    },
  }
}

export function accountsNamespace(vault: VaultManager): NamespaceSpec {
  return {
    list: { handler: () => vault.accounts() },
    active: { handler: () => vault.active() },
    setActive: {
      input: z.object({ id: AccountIdSchema }),
      handler: (arg) => vault.setActive((arg as { id: string }).id),
    },
    rename: {
      input: z.object({ id: AccountIdSchema, label: z.string().trim().min(1).max(64) }),
      handler: (arg) => {
        const { id, label } = arg as { id: string; label: string }
        return vault.rename(id, label)
      },
    },
  }
}
