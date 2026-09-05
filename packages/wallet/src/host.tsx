/**
 * Host capabilities the *UI* needs from its body (as opposed to the engine's
 * Platform): where secrets may be shown, passkeys, QR scanning. The extension
 * popup opens secret flows in tab.html (§3.2); mobile navigates in place.
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { ScreenId } from './navigation/registry'

export interface PasskeyResult {
  readonly credentialId: string
  readonly prfSecretHex: string
}

export interface PasskeyProvider {
  /** True when WebAuthn with the `prf` extension is available here. */
  supported(): Promise<boolean>
  create(opts: { userName: string; userIdHex: string; rpName: string }): Promise<PasskeyResult>
  get(credentialIds: readonly string[]): Promise<PasskeyResult>
}

export interface UiHost {
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile' | 'harness'
  /** True when secrets (seed words, exports) may render in this surface. */
  readonly secretsAllowed: boolean
  /** Open a screen in a surface where secrets are allowed (the extension tab). */
  openSecretScreen?(screen: ScreenId): void
  readonly passkeys: PasskeyProvider | null
  scanQr?(): Promise<string>
  /** The sync relay for this build (§9.5). */
  readonly relayUrl: string
}

const unsupported: PasskeyProvider = {
  supported: async () => false,
  create: async () => {
    throw new Error('passkeys are not available here')
  },
  get: async () => {
    throw new Error('passkeys are not available here')
  },
}

export const DEFAULT_RELAY = 'https://electroswap.io/api/wallet/sync'

const HostContext = createContext<UiHost>({ body: 'harness', secretsAllowed: true, passkeys: unsupported, relayUrl: DEFAULT_RELAY })

export function HostProvider({ host, children }: { host: UiHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>
}

export function useHost(): UiHost {
  return useContext(HostContext)
}
