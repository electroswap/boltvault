/**
 * S1 platform capability surface (design doc S1). The wallet "brain" depends
 * only on this interface; each host (chrome extension, mobile, dev) provides
 * an implementation. Everything is Promise-based so the same code runs in the
 * service worker / offscreen contexts.
 */

export interface KeyValueStore {
  get(k: string): Promise<string | null>
  set(k: string, v: string): Promise<void>
  remove(k: string): Promise<void>
}

export interface SecretStore extends KeyValueStore {}

export interface Platform {
  storage: {
    local: KeyValueStore
    session: KeyValueStore
    secret: SecretStore
  }
  /** Cryptographically random bytes. */
  random(bytes: number): Uint8Array
  /**
   * KDF for the master key.
   * NOTE: in the chrome impl this is a documented deterministic stand-in; the
   * real argon2id runs offscreen via hash-wasm (see chrome.ts).
   */
  argon2id(opts: { password: string; salt: Uint8Array; cost?: number }): Promise<Uint8Array>
  biometric: {
    available(): Promise<boolean>
    /** Show the OS biometric prompt; resolves true on success. */
    prompt(reason: string): Promise<boolean>
  }
  clipboard: {
    write(text: string): Promise<void>
    /** Write, then clear after `ms` (sensitive values). */
    writeThenClear(text: string, ms: number): Promise<void>
  }
  qr: {
    scan(): Promise<string>
    show(payload: string): void
  }
  openUrl(url: string): void
  notify(n: { title: string; body: string }): void
  /** Hide the notification preview (sensitive content). */
  hidePreview(): void
}
