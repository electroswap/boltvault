import {
  accountsFromPlaintext,
  addAccountToPlaintext,
  buildAccount,
  createVault,
  emptyPlaintext,
  generateEntropy,
  openVault,
  seedHexFromMnemonic,
  validateMnemonicStr,
  type KeyValueStore,
  type VaultAccount,
  type VaultFileV1,
  type VaultPlaintext,
} from '@boltvault/core'

/**
 * VaultService (T3.3) — the SW's vault lifecycle, storage-agnostic.
 *
 * Composition only: the crypto is @boltvault/core (VaultFileV1); this decides
 * *where* things live and *when* we hold the seed in memory.
 *
 * Storage layout (design S1 "Platform storage contract"):
 *  - secret  (chrome.storage.local):    the VaultFileV1 envelope (ciphertext)
 *  - session (chrome.storage.session):  the unlocked seedHex — cleared on
 *                                       auto-lock / browser close
 *
 * The wrapping key (password) is never persisted; only the derived seedHex
 * lives in the ephemeral session. Wrong password → openVault returns null.
 */

const VAULT_KEY = 'vault.file'
const SEED_KEY = 'vault.session.seedHex'
const UNLOCKED_KEY = 'vault.session.unlockedAt'

export type AutoLock = 'immediately' | '1min' | '5min' | '30min' | 'never'

const AUTO_LOCK_MS: Record<AutoLock, number> = {
  immediately: 0,
  '1min': 60_000,
  '5min': 300_000,
  '30min': 1_800_000,
  never: Number.POSITIVE_INFINITY,
}

export interface VaultStores {
  readonly secret: KeyValueStore
  readonly session: KeyValueStore
}

export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password')
    this.name = 'WrongPasswordError'
  }
}

export interface CreatedVault {
  readonly file: VaultFileV1
  readonly accounts: VaultAccount[]
  /** The mnemonic (space-joined) — reveal during onboarding, then discard. */
  readonly mnemonic: string
  readonly seedHex: string
}

export class VaultService {
  private constructor(
    private readonly stores: VaultStores,
    private readonly autoLock: AutoLock = '5min',
  ) {}

  /** Wire a service to platform stores. */
  static connect(stores: VaultStores, autoLock: AutoLock = '5min'): VaultService {
    return new VaultService(stores, autoLock)
  }

  /** Is there a stored vault yet (i.e. the user has onboarded)? */
  async hasVault(): Promise<boolean> {
    return (await this.stores.secret.get(VAULT_KEY)) !== null
  }

  private async readFile(): Promise<VaultFileV1 | null> {
    const raw = await this.stores.secret.get(VAULT_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as VaultFileV1
    } catch {
      return null
    }
  }

  /** Onboarding: generate a fresh vault + first HD account. */
  async createVault(password: string, opts: { bits?: 128 | 256 } = {}): Promise<CreatedVault> {
    const entropy = generateEntropy(opts.bits ?? 128)
    return this.createFromMnemonic(entropy.mnemonic, password)
  }

  /** Onboarding: import a mnemonic the user already has. */
  async importVault(mnemonic: string, password: string): Promise<CreatedVault> {
    return this.createFromMnemonic(mnemonic, password)
  }

  private async createFromMnemonic(mnemonic: string, password: string): Promise<CreatedVault> {
    const trimmed = mnemonic.trim()
    if (!validateMnemonicStr(trimmed)) throw new Error('invalid mnemonic')
    const seedHex = seedHexFromMnemonic(trimmed)
    const created = buildAccount({ kind: 'hd', label: 'Account 1', index: 0 }, seedHex)
    const pt: VaultPlaintext = {
      seedHex,
      mnemonic: trimmed,
      importedKeys: {},
      accounts: [created.meta],
    }
    const file = await createVault(password, pt)
    await this.stores.secret.set(VAULT_KEY, JSON.stringify(file))
    return {
      file,
      accounts: accountsFromPlaintext(pt),
      mnemonic: trimmed,
      seedHex,
    }
  }

  /**
   * Unlock: verify the password, load the seed into the ephemeral session,
   * and arm the auto-lock timer. Returns the accounts so the UI can render.
   */
  async unlock(password: string, autoLock: AutoLock = this.autoLock): Promise<VaultAccount[]> {
    const file = await this.readFile()
    if (!file) throw new Error('no vault found')
    const pt = await openVault(file, password)
    if (!pt) throw new WrongPasswordError()
    if (pt.seedHex) await this.stores.session.set(SEED_KEY, pt.seedHex)
    await this.stores.session.set(UNLOCKED_KEY, String(Date.now()))
    this.armAutoLock(autoLock)
    return accountsFromPlaintext(pt)
  }

  /** Clear the unlocked seed (browser close also clears the session store). */
  async lock(): Promise<void> {
    await this.stores.session.remove(SEED_KEY)
    await this.stores.session.remove(UNLOCKED_KEY)
  }

  /** True if a seed is currently held in the session. */
  async isUnlocked(): Promise<boolean> {
    return (await this.stores.session.get(SEED_KEY)) !== null
  }

  /** The unlocked seed, or null when locked. */
  async getUnlockedSeedHex(): Promise<string | null> {
    return this.stores.session.get(SEED_KEY)
  }

  /** Reveal the recovery phrase (for the backup / seed-reveal screen). */
  async revealMnemonic(password: string): Promise<string> {
    const file = await this.readFile()
    if (!file) throw new Error('no vault found')
    const pt = await openVault(file, password)
    if (!pt) throw new WrongPasswordError()
    if (!pt.mnemonic) throw new Error('no mnemonic in vault')
    return pt.mnemonic
  }

  /**
   * Pick 3 distinct words from the mnemonic for the 3-word quiz. Returns the
   * words + their positions so the UI can ask "which word is at position N?".
   */
  static quizWords(mnemonic: string): { words: string[]; positions: number[] } {
    const all = mnemonic.trim().split(/\s+/)
    const idx = new Set<number>()
    while (idx.size < 3 && idx.size < all.length) {
      idx.add(Math.floor(Math.random() * all.length))
    }
    const positions = [...idx].sort((a, b) => a - b)
    const words = positions.map((i) => all[i] ?? '')
    return { words, positions }
  }

  private armAutoLock(autoLock: AutoLock): void {
    const ms = AUTO_LOCK_MS[autoLock]
    if (ms === 0 || ms === Number.POSITIVE_INFINITY) return
    // Fire-and-forget; the SW is alive while a popup is open, which is when
    // the lock matters. (chrome.alarms is the more durable home — wired in a
    // later task when the settings tab lands.)
    setTimeout(() => void this.lock(), ms)
  }
}

export type { VaultFileV1, VaultAccount }
