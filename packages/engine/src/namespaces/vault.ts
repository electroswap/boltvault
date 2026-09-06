/**
 * Vault + accounts on VaultFileV2 (master plan §3.2, §8.1).
 *
 * Storage (via Platform):
 *   secret  `vault.file`      VaultFileV2 (or a V1 file until its first unlock migrates it)
 *   session `vault.dek`       the unlocked DEK (hex) — cleared on lock / browser exit
 *   session `vault.unlockedAt`, `vault.lockAt`
 *   local   `accounts.active` the seated account id
 *   local   `vault.kdf`       calibrated Argon2id parameters for this device
 *
 * Nothing secret is cached outside the sealed file: `accounts.list` opens the
 * plaintext with the session DEK (an XChaCha20 decrypt of a small JSON) on
 * every call, so there is one source of truth. Auto-lock is a platform alarm.
 */
import {
  addWrap,
  assembleQrFrames,
  calibrateArgon2,
  changePassword as changePasswordV2,
  chunkForQr,
  createVaultV2,
  deriveAccount,
  exportVaultV2,
  fromHex,
  generateEntropy,
  migrateV1,
  newAccountId,
  openVaultExport,
  openVaultV2,
  removeWrap,
  resealVaultV2,
  seedHexFromMnemonic,
  toHex,
  unwrapDek,
  validateMnemonicStr,
  type Argon2idParams,
  type VaultAccountV2,
  type VaultCrypto,
  type VaultFileV1,
  type VaultFileV2,
  type VaultPlaintextV2,
  type VaultSeed,
} from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { getAddress, isAddress } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'
import { HDKey } from '@scure/bip32'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { AccountIdSchema, AutoLockSchema, type AccountView, type AutoLock, type SeedView, type VaultStatus } from '../schema'
import type { SettingsStore } from '../settingsStore'
import { readDoc, writeDoc, type DocSpec } from '../storage'

const KEY_FILE = 'vault.file'
const KEY_DEK = 'vault.dek'
const KEY_UNLOCKED_AT = 'vault.unlockedAt'
const KEY_LOCK_AT = 'vault.lockAt'
export const AUTOLOCK_ALARM = 'vault.autolock'

const AUTO_LOCK_MS: Record<AutoLock, number> = {
  '5min': 300_000,
  '15min': 900_000,
  '60min': 3_600_000,
  never: Number.POSITIVE_INFINITY,
}
/** A touch within this long of the last one is a no-op (the alarm is not rescheduled on every keystroke). */
const TOUCH_DEBOUNCE_MS = 30_000

const ACTIVE_DOC: DocSpec<{ id: string | null }> = {
  key: 'accounts.active',
  version: 1,
  schema: z.object({ id: z.string().nullable() }),
  defaultValue: () => ({ id: null }),
}

const KDF_DOC: DocSpec<Argon2idParams | null> = {
  key: 'vault.kdf',
  version: 1,
  schema: z.object({ m: z.number().int().positive(), t: z.number().int().positive(), p: z.number().int().positive() }).nullable(),
  defaultValue: () => null,
}

type StoredFile = VaultFileV2 | VaultFileV1

function isV2(f: StoredFile): f is VaultFileV2 {
  return (f as VaultFileV2).v === 2
}

export function toView(a: VaultAccountV2): AccountView {
  return {
    id: a.id,
    kind: a.kind,
    label: a.label,
    address: a.address,
    ...(a.index !== undefined ? { index: a.index } : {}),
    ...(a.seedId !== undefined ? { seedId: a.seedId } : {}),
    ...(a.hardware ? { hardware: a.hardware } : {}),
    hasKey: a.kind === 'hd' || a.kind === 'imported',
    hidden: a.hidden,
    order: a.order,
    createdAt: a.createdAt,
  }
}

function normaliseMnemonic(m: string): string {
  return m.trim().toLowerCase().split(/\s+/).join(' ')
}

const LEDGER_LIVE = (i: number): string => `m/44'/60'/${i}'/0/0`

export interface VaultManagerOptions {
  /** Override the calibrated KDF (tests). */
  readonly kdf?: Argon2idParams
}

export class VaultManager {
  private stopAlarms: (() => void) | null = null
  private readonly crypto: VaultCrypto

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly settings: SettingsStore,
    private readonly opts: VaultManagerOptions = {},
  ) {
    this.crypto = { argon2id: (i) => platform.kdf.argon2id(i), random: (n) => platform.random(n) }
  }

  init(): void {
    if (this.stopAlarms) return
    this.stopAlarms = this.platform.alarms.onFire((name) => {
      if (name === AUTOLOCK_ALARM) void this.onAutoLockAlarm()
    })
  }

  /** The alarm fired: lock, unless a touch moved the deadline past now (then re-arm at the moved deadline). */
  private async onAutoLockAlarm(): Promise<void> {
    const at = Number((await this.platform.storage.session.get(KEY_LOCK_AT)) ?? 0)
    if (at > this.platform.now() + 1_000) {
      await this.platform.alarms.schedule(AUTOLOCK_ALARM, at)
      return
    }
    await this.lock()
  }

  dispose(): void {
    this.stopAlarms?.()
    this.stopAlarms = null
  }

  // ---- storage helpers -----------------------------------------------------------

  private async readFile(): Promise<StoredFile | null> {
    const raw = await this.platform.storage.secret.get(KEY_FILE)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as StoredFile
    } catch {
      return null
    }
  }

  private async writeFile(file: VaultFileV2): Promise<void> {
    await this.platform.storage.secret.set(KEY_FILE, JSON.stringify(file))
  }

  private async requireV2(): Promise<VaultFileV2> {
    const f = await this.readFile()
    if (!f) throw new EngineError('no_vault', 'no vault exists yet')
    if (!isV2(f)) throw new EngineError('locked', 'unlock once with your password to upgrade this vault')
    return f
  }

  private async dek(): Promise<Uint8Array> {
    const hex = await this.platform.storage.session.get(KEY_DEK)
    if (hex === null) throw new EngineError('locked', 'the vault is locked')
    return fromHex(hex)
  }

  async isUnlocked(): Promise<boolean> {
    return (await this.platform.storage.session.get(KEY_DEK)) !== null
  }

  private async kdfParams(): Promise<Argon2idParams> {
    if (this.opts.kdf) return this.opts.kdf
    const stored = (await readDoc(this.platform.storage.local, KDF_DOC, () => this.platform.now())).value
    if (stored) return stored
    const calibrated = await calibrateArgon2(this.crypto)
    await writeDoc(this.platform.storage.local, KDF_DOC, calibrated)
    return calibrated
  }

  private async plaintext(): Promise<{ file: VaultFileV2; dek: Uint8Array; pt: VaultPlaintextV2 }> {
    const file = await this.requireV2()
    const dek = await this.dek()
    const pt = openVaultV2(file, dek)
    if (!pt) throw new EngineError('internal', 'the vault could not be opened with the session key')
    return { file, dek, pt }
  }

  /** Open → mutate → reseal with the DEK (no KDF) → persist → emit. */
  private async mutate(fn: (pt: VaultPlaintextV2) => VaultPlaintextV2): Promise<VaultPlaintextV2> {
    const { file, dek, pt } = await this.plaintext()
    const next = fn(pt)
    await this.writeFile(resealVaultV2(this.crypto, file, dek, next, this.platform.now()))
    await this.emitAll(next)
    return next
  }

  // ---- status -------------------------------------------------------------------

  async status(): Promise<VaultStatus> {
    const [file, dekHex, unlockedAt, lockAt, settings] = await Promise.all([
      this.readFile(),
      this.platform.storage.session.get(KEY_DEK),
      this.platform.storage.session.get(KEY_UNLOCKED_AT),
      this.platform.storage.session.get(KEY_LOCK_AT),
      this.settings.get(),
    ])
    const unlocked = dekHex !== null
    const wraps = file ? (isV2(file) ? file.wraps.map((w) => ({ by: w.by, id: w.id })) : [{ by: 'password' as const, id: 'password' }]) : []
    let seeds: SeedView[] = []
    if (unlocked && file && isV2(file)) {
      const pt = openVaultV2(file, fromHex(dekHex))
      if (pt) seeds = pt.seeds.map((s) => this.seedView(s, pt))
    }
    return {
      exists: file !== null,
      unlocked,
      unlockedAt: unlocked && unlockedAt !== null ? Number(unlockedAt) : null,
      lockAt: unlocked && lockAt !== null ? Number(lockAt) : null,
      autoLock: settings.autoLock,
      wraps,
      seeds,
      backupComplete: seeds.every((s) => s.backedUp),
    }
  }

  private seedView(s: VaultSeed, pt: VaultPlaintextV2): SeedView {
    return { id: s.id, label: s.label, backedUp: s.backedUpAt !== null, accountCount: pt.accounts.filter((a) => a.seedId === s.id).length, hasPassphrase: !!s.passphrase }
  }

  // ---- create / import / unlock / lock ----------------------------------------------

  private seedFromMnemonic(mnemonic: string, label: string, passphrase?: string): VaultSeed {
    const m = normaliseMnemonic(mnemonic)
    if (!validateMnemonicStr(m)) throw new EngineError('invalid_mnemonic', 'that is not a valid recovery phrase')
    const seed: VaultSeed = {
      id: toHex(this.platform.random(8)),
      label,
      mnemonic: m,
      seedHex: seedHexFromMnemonic(m, passphrase),
      backedUpAt: null,
      createdAt: this.platform.now(),
    }
    return passphrase ? { ...seed, passphrase } : seed
  }

  private hdAccount(seed: VaultSeed, index: number, label: string, order: number): VaultAccountV2 {
    const d = deriveAccount(seed.seedHex, index)
    return { id: newAccountId(), kind: 'hd', label, address: d.address, seedId: seed.id, index, hidden: false, order, createdAt: this.platform.now() }
  }

  private async createFromSeed(seed: VaultSeed, password: string): Promise<AccountView[]> {
    if (await this.readFile()) throw new EngineError('invalid_argument', 'a vault already exists')
    const first = this.hdAccount(seed, 0, 'Account 1', 0)
    const pt: VaultPlaintextV2 = { v: 2, seeds: [seed], importedKeys: {}, accounts: [first] }
    const { file, dek } = await createVaultV2(this.crypto, { password, plaintext: pt, kdf: await this.kdfParams(), now: this.platform.now() })
    await this.writeFile(file)
    await writeDoc(this.platform.storage.local, ACTIVE_DOC, { id: first.id })
    return this.unlockWithDek(dek, pt)
  }

  /** A vault with no seed — for watch-only or hardware-first users (§8.1). */
  async createEmpty(input: { password: string }): Promise<VaultStatus> {
    if (await this.readFile()) throw new EngineError('invalid_argument', 'a vault already exists')
    const pt: VaultPlaintextV2 = { v: 2, seeds: [], importedKeys: {}, accounts: [] }
    const { file, dek } = await createVaultV2(this.crypto, { password: input.password, plaintext: pt, kdf: await this.kdfParams(), now: this.platform.now() })
    await this.writeFile(file)
    await this.unlockWithDek(dek, pt)
    return this.status()
  }

  async create(input: { password: string; bits?: 128 | 256; label?: string }): Promise<{ accounts: AccountView[]; mnemonic: string; seedId: string }> {
    const entropy = generateEntropy(input.bits ?? 128)
    const seed = this.seedFromMnemonic(entropy.mnemonic, input.label ?? 'Seed 1')
    const accounts = await this.createFromSeed(seed, input.password)
    return { accounts, mnemonic: seed.mnemonic, seedId: seed.id }
  }

  async import(input: { mnemonic: string; password: string; passphrase?: string; label?: string }): Promise<{ accounts: AccountView[]; seedId: string }> {
    const seed = this.seedFromMnemonic(input.mnemonic, input.label ?? 'Seed 1', input.passphrase)
    const accounts = await this.createFromSeed(seed, input.password)
    return { accounts, seedId: seed.id }
  }

  private async unlockWithDek(dek: Uint8Array, pt: VaultPlaintextV2): Promise<AccountView[]> {
    const session = this.platform.storage.session
    await session.set(KEY_DEK, toHex(dek))
    await session.set(KEY_UNLOCKED_AT, String(this.platform.now()))
    await this.scheduleAutoLock()
    await this.emitAll(pt)
    return pt.accounts.map(toView)
  }

  async unlock(input: { password: string }): Promise<{ accounts: AccountView[] }> {
    const file = await this.readFile()
    if (!file) throw new EngineError('no_vault', 'no vault exists yet')
    if (!isV2(file)) {
      // First unlock after the upgrade: migrate v1 → v2 in place.
      const migrated = await migrateV1(this.crypto, file, input.password, await this.kdfParams(), this.platform.now())
      if (!migrated) throw new EngineError('wrong_password', 'wrong password')
      await this.writeFile(migrated.file)
      const pt = openVaultV2(migrated.file, migrated.dek)
      if (!pt) throw new EngineError('internal', 'migration produced an unreadable vault')
      return { accounts: await this.unlockWithDek(migrated.dek, pt) }
    }
    const dek = await unwrapDek(this.crypto, file, { password: input.password })
    if (!dek) throw new EngineError('wrong_password', 'wrong password')
    const pt = openVaultV2(file, dek)
    if (!pt) throw new EngineError('internal', 'the vault could not be opened')
    return { accounts: await this.unlockWithDek(dek, pt) }
  }

  async unlockWithPasskey(input: { credentialId: string; prfSecretHex: string }): Promise<{ accounts: AccountView[] }> {
    const file = await this.requireV2()
    const dek = await unwrapDek(this.crypto, file, { credentialId: input.credentialId, prfSecret: fromHex(input.prfSecretHex) })
    if (!dek) throw new EngineError('unauthorized', 'this passkey does not unlock the vault')
    const pt = openVaultV2(file, dek)
    if (!pt) throw new EngineError('internal', 'the vault could not be opened')
    return { accounts: await this.unlockWithDek(dek, pt) }
  }

  async unlockWithDevice(input: { keyId: string; keyHex: string }): Promise<{ accounts: AccountView[] }> {
    const file = await this.requireV2()
    const dek = await unwrapDek(this.crypto, file, { keyId: input.keyId, deviceKey: fromHex(input.keyHex) })
    if (!dek) throw new EngineError('unauthorized', 'this device key does not unlock the vault')
    const pt = openVaultV2(file, dek)
    if (!pt) throw new EngineError('internal', 'the vault could not be opened')
    return { accounts: await this.unlockWithDek(dek, pt) }
  }

  private scheduleAutoLock(): Promise<{ lockAt: number | null }> {
    return this.arm(true)
  }

  /** Push the idle deadline out. `force` ignores the debounce (unlock, a settings change). */
  private async arm(force: boolean): Promise<{ lockAt: number | null }> {
    const { autoLock } = await this.settings.get()
    const ms = AUTO_LOCK_MS[autoLock]
    if (!Number.isFinite(ms)) {
      await this.platform.alarms.cancel(AUTOLOCK_ALARM)
      await this.platform.storage.session.remove(KEY_LOCK_AT)
      return { lockAt: null }
    }
    const now = this.platform.now()
    if (!force) {
      const current = Number((await this.platform.storage.session.get(KEY_LOCK_AT)) ?? 0)
      if (current - now > ms - TOUCH_DEBOUNCE_MS) return { lockAt: current }
    }
    const at = now + ms
    await this.platform.alarms.schedule(AUTOLOCK_ALARM, at)
    await this.platform.storage.session.set(KEY_LOCK_AT, String(at))
    return { lockAt: at }
  }

  /** A human interacted with the wallet: the idle timer restarts. Cheap enough to call on every gesture. */
  async touch(): Promise<{ lockAt: number | null }> {
    if (!(await this.isUnlocked())) return { lockAt: null }
    return this.arm(false)
  }

  /** Re-announce the current status and accounts (a page that reconnected after a worker restart repaints from these). */
  async announce(): Promise<void> {
    const status = await this.status()
    this.bus.emit({ type: 'vault.status', status })
    if (!status.unlocked) return
    const accounts = await this.accounts().catch(() => [])
    this.bus.emit({ type: 'accounts.changed', accounts, activeId: await this.activeId() })
  }

  async applyAutoLock(): Promise<VaultStatus> {
    if (await this.isUnlocked()) await this.scheduleAutoLock()
    const status = await this.status()
    this.bus.emit({ type: 'vault.status', status })
    return status
  }

  async lock(): Promise<void> {
    const session = this.platform.storage.session
    await Promise.all([session.remove(KEY_DEK), session.remove(KEY_UNLOCKED_AT), session.remove(KEY_LOCK_AT)])
    await this.platform.alarms.cancel(AUTOLOCK_ALARM)
    this.bus.emit({ type: 'vault.status', status: await this.status() })
    this.bus.emit({ type: 'accounts.changed', accounts: [], activeId: null })
  }

  // ---- factors -------------------------------------------------------------------

  private async verifyPassword(password: string): Promise<VaultFileV2> {
    const file = await this.requireV2()
    if (!(await unwrapDek(this.crypto, file, { password }))) throw new EngineError('wrong_password', 'wrong password')
    return file
  }

  async reveal(input: { seedId: string; password: string }): Promise<{ mnemonic: string; passphraseSet: boolean }> {
    const file = await this.verifyPassword(input.password)
    const dek = await unwrapDek(this.crypto, file, { password: input.password })
    const pt = dek ? openVaultV2(file, dek) : null
    const seed = pt?.seeds.find((s) => s.id === input.seedId)
    if (!seed) throw new EngineError('not_found', 'no such seed')
    return { mnemonic: seed.mnemonic, passphraseSet: !!seed.passphrase }
  }

  async changePassword(input: { current: string; next: string }): Promise<VaultStatus> {
    const file = await this.verifyPassword(input.current)
    const dek = await this.dek()
    await this.writeFile(await changePasswordV2(this.crypto, file, dek, input.next, await this.kdfParams(), this.platform.now()))
    return this.emitStatus()
  }

  async enrolPasskey(input: { credentialId: string; prfSecretHex: string }): Promise<VaultStatus> {
    const file = await this.requireV2()
    const dek = await this.dek()
    await this.writeFile(await addWrap(this.crypto, file, dek, { by: 'prf', credentialId: input.credentialId, prfSecret: fromHex(input.prfSecretHex) }, this.platform.now()))
    return this.emitStatus()
  }

  async removePasskey(input: { credentialId: string }): Promise<VaultStatus> {
    await this.dek()
    await this.writeFile(removeWrap(await this.requireV2(), 'prf', input.credentialId, this.platform.now()))
    return this.emitStatus()
  }

  async enrolDevice(input: { keyId: string; keyHex: string }): Promise<VaultStatus> {
    const file = await this.requireV2()
    const dek = await this.dek()
    await this.writeFile(await addWrap(this.crypto, file, dek, { by: 'device', keyId: input.keyId, deviceKey: fromHex(input.keyHex) }, this.platform.now()))
    return this.emitStatus()
  }

  async removeDevice(input: { keyId: string }): Promise<VaultStatus> {
    await this.dek()
    await this.writeFile(removeWrap(await this.requireV2(), 'device', input.keyId, this.platform.now()))
    return this.emitStatus()
  }

  // ---- backup --------------------------------------------------------------------

  async backupQuiz(input: { seedId: string }): Promise<{ positions: number[]; wordCount: number }> {
    const { pt } = await this.plaintext()
    const seed = pt.seeds.find((s) => s.id === input.seedId)
    if (!seed) throw new EngineError('not_found', 'no such seed')
    const words = seed.mnemonic.split(' ')
    const positions = new Set<number>()
    while (positions.size < 3) {
      const b = this.platform.random(1)[0] ?? 0
      positions.add((b % words.length) + 1)
    }
    return { positions: [...positions].sort((a, b) => a - b), wordCount: words.length }
  }

  async confirmBackup(input: { seedId: string; answers: Array<{ position: number; word: string }> }): Promise<{ ok: boolean; status: VaultStatus }> {
    const { pt } = await this.plaintext()
    const seed = pt.seeds.find((s) => s.id === input.seedId)
    if (!seed) throw new EngineError('not_found', 'no such seed')
    const words = seed.mnemonic.split(' ')
    const ok = input.answers.length >= 3 && input.answers.every((a) => words[a.position - 1] === a.word.trim().toLowerCase())
    if (ok) {
      const now = this.platform.now()
      await this.mutate((p) => ({ ...p, seeds: p.seeds.map((s) => (s.id === seed.id ? { ...s, backedUpAt: now } : s)) }))
    }
    return { ok, status: await this.status() }
  }

  /** A hardware/export verification counts as a backup (§8.1). */
  async markBackedUp(seedId: string): Promise<void> {
    const now = this.platform.now()
    await this.mutate((p) => ({ ...p, seeds: p.seeds.map((s) => (s.id === seedId ? { ...s, backedUpAt: now } : s)) }))
  }

  // ---- export / import (air-gapped) ---------------------------------------------------

  async export(input: { password: string; code: string }): Promise<{ frames: string[] }> {
    await this.verifyPassword(input.password)
    const { pt } = await this.plaintext()
    const env = await exportVaultV2(this.crypto, pt, input.code, await this.kdfParams(), this.platform.now())
    return { frames: chunkForQr(JSON.stringify(env)) }
  }

  async importExport(input: { frames: string[]; code: string; password: string }): Promise<{ accounts: AccountView[] }> {
    if (await this.readFile()) throw new EngineError('invalid_argument', 'a vault already exists on this device')
    const payload = assembleQrFrames(input.frames)
    if (!payload) throw new EngineError('invalid_argument', 'the export is incomplete — keep scanning')
    let env: unknown
    try {
      env = JSON.parse(payload)
    } catch {
      throw new EngineError('invalid_argument', 'the export could not be read')
    }
    const pt = await openVaultExport(this.crypto, env as Parameters<typeof openVaultExport>[1], input.code)
    if (!pt) throw new EngineError('unauthorized', 'wrong code')
    const { file, dek } = await createVaultV2(this.crypto, { password: input.password, plaintext: pt, kdf: await this.kdfParams(), now: this.platform.now() })
    await this.writeFile(file)
    await writeDoc(this.platform.storage.local, ACTIVE_DOC, { id: pt.accounts[0]?.id ?? null })
    return { accounts: await this.unlockWithDek(dek, pt) }
  }

  // ---- accounts ------------------------------------------------------------------

  async accounts(): Promise<AccountView[]> {
    if (!(await this.isUnlocked())) return []
    const { pt } = await this.plaintext()
    return [...pt.accounts].sort((a, b) => a.order - b.order).map(toView)
  }

  async activeId(): Promise<string | null> {
    return (await readDoc(this.platform.storage.local, ACTIVE_DOC, () => this.platform.now())).value.id
  }

  async active(): Promise<AccountView | null> {
    const [accounts, id] = await Promise.all([this.accounts(), this.activeId()])
    return accounts.find((a) => a.id === id) ?? accounts.find((a) => !a.hidden) ?? accounts[0] ?? null
  }

  async setActive(id: string): Promise<AccountView> {
    const accounts = await this.accounts()
    const found = accounts.find((a) => a.id === id)
    if (!found) throw new EngineError('not_found', 'no such account')
    await writeDoc(this.platform.storage.local, ACTIVE_DOC, { id })
    this.bus.emit({ type: 'accounts.changed', accounts, activeId: id })
    return found
  }

  private async updateAccount(id: string, fn: (a: VaultAccountV2) => VaultAccountV2): Promise<AccountView> {
    const pt = await this.mutate((p) => {
      if (!p.accounts.some((a) => a.id === id)) throw new EngineError('not_found', 'no such account')
      return { ...p, accounts: p.accounts.map((a) => (a.id === id ? fn(a) : a)) }
    })
    const a = pt.accounts.find((x) => x.id === id)
    if (!a) throw new EngineError('internal', 'account vanished')
    return toView(a)
  }

  rename(id: string, label: string): Promise<AccountView> {
    return this.updateAccount(id, (a) => ({ ...a, label }))
  }

  setHidden(id: string, hidden: boolean): Promise<AccountView> {
    return this.updateAccount(id, (a) => ({ ...a, hidden }))
  }

  async reorder(ids: string[]): Promise<AccountView[]> {
    const pt = await this.mutate((p) => {
      const known = new Set(p.accounts.map((a) => a.id))
      if (ids.length !== known.size || !ids.every((id) => known.has(id))) throw new EngineError('invalid_argument', 'reorder must list every account exactly once')
      const order = new Map(ids.map((id, i) => [id, i]))
      return { ...p, accounts: p.accounts.map((a) => ({ ...a, order: order.get(a.id) ?? a.order })) }
    })
    return [...pt.accounts].sort((a, b) => a.order - b.order).map(toView)
  }

  private async addAccount(build: (pt: VaultPlaintextV2, order: number) => { account: VaultAccountV2; importedKey?: `0x${string}`; seed?: VaultSeed }): Promise<AccountView> {
    let created: VaultAccountV2 | null = null
    await this.mutate((p) => {
      const order = p.accounts.reduce((m, a) => Math.max(m, a.order), -1) + 1
      const { account, importedKey, seed } = build(p, order)
      if (p.accounts.some((a) => a.address.toLowerCase() === account.address.toLowerCase())) throw new EngineError('invalid_argument', 'that address is already in this vault')
      created = account
      return {
        ...p,
        seeds: seed ? [...p.seeds, seed] : p.seeds,
        importedKeys: importedKey ? { ...p.importedKeys, [account.id]: importedKey } : p.importedKeys,
        accounts: [...p.accounts, account],
      }
    })
    if (!created) throw new EngineError('internal', 'account not created')
    return toView(created)
  }

  derive(seedId: string, label?: string): Promise<AccountView> {
    return this.addAccount((p, order) => {
      const seed = p.seeds.find((s) => s.id === seedId)
      if (!seed) throw new EngineError('not_found', 'no such seed')
      const used = p.accounts.filter((a) => a.seedId === seedId).map((a) => a.index ?? 0)
      const index = used.length ? Math.max(...used) + 1 : 0
      return { account: this.hdAccount(seed, index, label ?? `Account ${index + 1}`, order) }
    })
  }

  async addSeed(input: { mnemonic: string; label?: string; passphrase?: string }): Promise<{ seedId: string; account: AccountView }> {
    const { pt } = await this.plaintext()
    const seed = this.seedFromMnemonic(input.mnemonic, input.label ?? `Seed ${pt.seeds.length + 1}`, input.passphrase)
    if (pt.seeds.some((s) => s.seedHex === seed.seedHex)) throw new EngineError('invalid_argument', 'that recovery phrase is already in this vault')
    const account = await this.addAccount((_p, order) => ({ account: this.hdAccount(seed, 0, `${seed.label} · Account 1`, order), seed }))
    return { seedId: seed.id, account }
  }

  addImported(input: { privateKey: string; label?: string }): Promise<AccountView> {
    const key = (input.privateKey.startsWith('0x') ? input.privateKey : `0x${input.privateKey}`).toLowerCase()
    if (!/^0x[0-9a-f]{64}$/.test(key)) throw new EngineError('invalid_argument', 'a private key is 32 bytes of hex')
    const privateKey = key as `0x${string}`
    const address = privateKeyToAddress(privateKey)
    return this.addAccount((_p, order) => ({
      account: { id: newAccountId(), kind: 'imported', label: input.label ?? 'Imported key', address, hidden: false, order, createdAt: this.platform.now() },
      importedKey: privateKey,
    }))
  }

  addWatch(input: { address: string; label?: string }): Promise<AccountView> {
    const raw = input.address.startsWith('0x') ? input.address : `0x${input.address}`
    if (!isAddress(raw, { strict: false })) throw new EngineError('invalid_argument', 'that is not an address')
    const address = getAddress(raw)
    return this.addAccount((_p, order) => ({
      account: { id: newAccountId(), kind: 'watch', label: input.label ?? 'Watch address', address, hidden: false, order, createdAt: this.platform.now() },
    }))
  }

  addHardware(input: { kind: 'ledger' | 'trezor' | 'keystone'; address: string; path: string; deviceId?: string; label?: string }): Promise<AccountView> {
    const raw = input.address.startsWith('0x') ? input.address : `0x${input.address}`
    if (!isAddress(raw, { strict: false })) throw new EngineError('invalid_argument', 'that is not an address')
    const address = getAddress(raw)
    return this.addAccount((_p, order) => ({
      account: {
        id: newAccountId(),
        kind: input.kind,
        label: input.label ?? `${input.kind[0]?.toUpperCase()}${input.kind.slice(1)}`,
        address,
        hardware: { path: input.path, ...(input.deviceId ? { deviceId: input.deviceId } : {}) },
        hidden: false,
        order,
        createdAt: this.platform.now(),
      },
    }))
  }

  async remove(id: string): Promise<void> {
    await this.mutate((p) => {
      const a = p.accounts.find((x) => x.id === id)
      if (!a) throw new EngineError('not_found', 'no such account')
      if (a.kind === 'hd') throw new EngineError('invalid_argument', 'hide seed accounts instead of removing them')
      const { [id]: _dropped, ...importedKeys } = p.importedKeys
      return { ...p, importedKeys, accounts: p.accounts.filter((x) => x.id !== id) }
    })
    if ((await this.activeId()) === id) {
      const next = (await this.accounts()).find((a) => !a.hidden)
      await writeDoc(this.platform.storage.local, ACTIVE_DOC, { id: next?.id ?? null })
    }
  }

  previewDerivations(input: { mnemonic: string; passphrase?: string; count?: number }): { bip44: string[]; ledgerLive: string[] } {
    const m = normaliseMnemonic(input.mnemonic)
    if (!validateMnemonicStr(m)) throw new EngineError('invalid_mnemonic', 'that is not a valid recovery phrase')
    const seedHex = seedHexFromMnemonic(m, input.passphrase)
    const n = Math.min(Math.max(input.count ?? 3, 1), 10)
    const root = HDKey.fromMasterSeed(fromHex(seedHex))
    const bip44: string[] = []
    const ledgerLive: string[] = []
    for (let i = 0; i < n; i++) {
      bip44.push(deriveAccount(seedHex, i).address)
      const node = root.derive(LEDGER_LIVE(i))
      if (!node.privateKey) throw new EngineError('internal', 'derivation failed')
      ledgerLive.push(privateKeyToAddress(`0x${toHex(node.privateKey)}`))
    }
    return { bip44, ledgerLive }
  }

  // ---- signing material (for the signing router, M3) -------------------------------

  async privateKeyFor(accountId: string): Promise<`0x${string}` | null> {
    const { pt } = await this.plaintext()
    const a = pt.accounts.find((x) => x.id === accountId)
    if (!a) return null
    if (a.kind === 'imported') return pt.importedKeys[accountId] ?? null
    if (a.kind === 'hd' && a.seedId && a.index !== undefined) {
      const seed = pt.seeds.find((s) => s.id === a.seedId)
      return seed ? deriveAccount(seed.seedHex, a.index).privateKey : null
    }
    return null
  }

  // ---- events --------------------------------------------------------------------

  private async emitStatus(): Promise<VaultStatus> {
    const status = await this.status()
    this.bus.emit({ type: 'vault.status', status })
    return status
  }

  private async emitAll(pt: VaultPlaintextV2): Promise<void> {
    this.bus.emit({ type: 'vault.status', status: await this.status() })
    const accounts = [...pt.accounts].sort((a, b) => a.order - b.order).map(toView)
    this.bus.emit({ type: 'accounts.changed', accounts, activeId: await this.activeId() })
  }
}

const PasswordSchema = z.string().min(1).max(1024)
const HexSchema = z.string().regex(/^[0-9a-fA-F]+$/)

export function vaultNamespace(vault: VaultManager, settings: SettingsStore): NamespaceSpec {
  return {
    status: { handler: () => vault.status() },
    createEmpty: { input: z.object({ password: PasswordSchema }), handler: (arg) => vault.createEmpty(arg as { password: string }) },
    create: {
      input: z.object({ password: PasswordSchema, bits: z.union([z.literal(128), z.literal(256)]).optional(), label: z.string().max(64).optional() }),
      handler: (arg) => vault.create(arg as { password: string; bits?: 128 | 256; label?: string }),
    },
    import: {
      input: z.object({ mnemonic: z.string().min(1).max(2048), password: PasswordSchema, passphrase: z.string().max(256).optional(), label: z.string().max(64).optional() }),
      handler: (arg) => vault.import(arg as { mnemonic: string; password: string; passphrase?: string; label?: string }),
    },
    unlock: { input: z.object({ password: PasswordSchema }), handler: (arg) => vault.unlock(arg as { password: string }) },
    unlockWithPasskey: {
      input: z.object({ credentialId: z.string().min(1), prfSecretHex: HexSchema }),
      handler: (arg) => vault.unlockWithPasskey(arg as { credentialId: string; prfSecretHex: string }),
    },
    unlockWithDevice: {
      input: z.object({ keyId: z.string().min(1), keyHex: HexSchema }),
      handler: (arg) => vault.unlockWithDevice(arg as { keyId: string; keyHex: string }),
    },
    lock: { handler: () => vault.lock() },
    touch: { handler: () => vault.touch() },
    reveal: {
      input: z.object({ seedId: z.string(), password: PasswordSchema }),
      handler: (arg) => vault.reveal(arg as { seedId: string; password: string }),
    },
    changePassword: {
      input: z.object({ current: PasswordSchema, next: PasswordSchema }),
      handler: (arg) => vault.changePassword(arg as { current: string; next: string }),
    },
    enrolPasskey: {
      input: z.object({ credentialId: z.string().min(1), prfSecretHex: HexSchema }),
      handler: (arg) => vault.enrolPasskey(arg as { credentialId: string; prfSecretHex: string }),
    },
    removePasskey: { input: z.object({ credentialId: z.string().min(1) }), handler: (arg) => vault.removePasskey(arg as { credentialId: string }) },
    enrolDevice: {
      input: z.object({ keyId: z.string().min(1), keyHex: HexSchema }),
      handler: (arg) => vault.enrolDevice(arg as { keyId: string; keyHex: string }),
    },
    removeDevice: { input: z.object({ keyId: z.string().min(1) }), handler: (arg) => vault.removeDevice(arg as { keyId: string }) },
    setAutoLock: {
      input: z.object({ autoLock: AutoLockSchema }),
      handler: async (arg) => {
        await settings.set({ autoLock: (arg as { autoLock: AutoLock }).autoLock })
        return vault.applyAutoLock()
      },
    },
    backupQuiz: { input: z.object({ seedId: z.string() }), handler: (arg) => vault.backupQuiz(arg as { seedId: string }) },
    confirmBackup: {
      input: z.object({ seedId: z.string(), answers: z.array(z.object({ position: z.number().int().positive(), word: z.string() })).min(3) }),
      handler: (arg) => vault.confirmBackup(arg as { seedId: string; answers: Array<{ position: number; word: string }> }),
    },
    export: {
      input: z.object({ password: PasswordSchema, code: z.string().min(8) }),
      handler: (arg) => vault.export(arg as { password: string; code: string }),
    },
    importExport: {
      input: z.object({ frames: z.array(z.string()).min(1), code: z.string().min(8), password: PasswordSchema }),
      handler: (arg) => vault.importExport(arg as { frames: string[]; code: string; password: string }),
    },
  }
}

export function accountsNamespace(vault: VaultManager): NamespaceSpec {
  return {
    list: { handler: () => vault.accounts() },
    active: { handler: () => vault.active() },
    setActive: { input: z.object({ id: AccountIdSchema }), handler: (arg) => vault.setActive((arg as { id: string }).id) },
    rename: {
      input: z.object({ id: AccountIdSchema, label: z.string().trim().min(1).max(64) }),
      handler: (arg) => {
        const { id, label } = arg as { id: string; label: string }
        return vault.rename(id, label)
      },
    },
    setHidden: {
      input: z.object({ id: AccountIdSchema, hidden: z.boolean() }),
      handler: (arg) => {
        const { id, hidden } = arg as { id: string; hidden: boolean }
        return vault.setHidden(id, hidden)
      },
    },
    reorder: { input: z.object({ ids: z.array(AccountIdSchema) }), handler: (arg) => vault.reorder((arg as { ids: string[] }).ids) },
    derive: {
      input: z.object({ seedId: z.string(), label: z.string().max(64).optional() }),
      handler: (arg) => {
        const { seedId, label } = arg as { seedId: string; label?: string }
        return vault.derive(seedId, label)
      },
    },
    addSeed: {
      input: z.object({ mnemonic: z.string().min(1).max(2048), label: z.string().max(64).optional(), passphrase: z.string().max(256).optional() }),
      handler: (arg) => vault.addSeed(arg as { mnemonic: string; label?: string; passphrase?: string }),
    },
    addImported: {
      input: z.object({ privateKey: z.string().min(64).max(66), label: z.string().max(64).optional() }),
      handler: (arg) => vault.addImported(arg as { privateKey: string; label?: string }),
    },
    addWatch: {
      input: z.object({ address: z.string().min(40).max(42), label: z.string().max(64).optional() }),
      handler: (arg) => vault.addWatch(arg as { address: string; label?: string }),
    },
    addHardware: {
      input: z.object({ kind: z.enum(['ledger', 'trezor', 'keystone']), address: z.string().min(40).max(42), path: z.string().min(1), deviceId: z.string().optional(), label: z.string().max(64).optional() }),
      handler: (arg) => vault.addHardware(arg as { kind: 'ledger' | 'trezor' | 'keystone'; address: string; path: string; deviceId?: string; label?: string }),
    },
    remove: { input: z.object({ id: AccountIdSchema }), handler: (arg) => vault.remove((arg as { id: string }).id) },
    previewDerivations: {
      input: z.object({ mnemonic: z.string().min(1).max(2048), passphrase: z.string().max(256).optional(), count: z.number().int().min(1).max(10).optional() }),
      handler: async (arg) => vault.previewDerivations(arg as { mnemonic: string; passphrase?: string; count?: number }),
    },
  }
}
