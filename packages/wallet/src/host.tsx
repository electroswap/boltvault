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
  readonly body: 'extension-popup' | 'extension-tab' | 'extension-sign' | 'mobile' | 'harness'
  /** True when secrets (seed words, exports) may render in this surface. */
  readonly secretsAllowed: boolean
  /** Open a screen in a surface where secrets are allowed (the extension tab). */
  openSecretScreen?(screen: ScreenId): void
  readonly passkeys: PasskeyProvider | null
  /** Open the camera; with `onPart`, keep reading distinct codes until it returns true (multi-part URs). */
  scanQr?(onPart?: (text: string) => boolean): Promise<string>
  /** The sync relay for this build (§9.5). */
  readonly relayUrl: string
  /** Copy to the clipboard (addresses, hashes). */
  copy?(text: string): Promise<void>
  /** Open an external page (explorer links) in the body's browser. */
  openUrl?(url: string): Promise<void>
  /** The approval window closes itself after a decision (§3.5). */
  closeWindow?(): void
  /** Fires on window focus/resize so the approval primary can go inert for 600 ms (§3.5). */
  onWindowFocus?(listener: () => void): () => void
  /** Pair a Ledger over WebHID — needs a user gesture, so only a full page offers it (§2.7 S7). Resolves true when a device was granted. */
  requestHid?(): Promise<boolean>
  /** The in-app browser (§5.3): the provider script injected before every page, and where the browser lives. */
  readonly browser?: { readonly providerScript: string }
  /** Deep and universal links (§5.3): the URL the app was opened with, and later ones. */
  readonly links?: { initial(): Promise<string | null>; subscribe(listener: (url: string) => void): () => void }
  /** Haptics (§7.8): light on confirm and keys, medium on a receipt, heavy on danger/reject. */
  haptic?(kind: 'light' | 'medium' | 'heavy'): void
  /** Three sounds (§7.8), off by default. */
  sound?(kind: 'confirm' | 'receive' | 'error'): void
  /** The native share sheet (the share card, §7.13). */
  share?(input: { title: string; text?: string; url?: string }): Promise<void>
  /** Push registration (§9.3). */
  readonly push?: { status(): Promise<'unavailable' | 'off' | 'granted' | 'denied'>; enable(): Promise<boolean>; disable(): Promise<void> }
  /** The body's version and reproducible build hash (Settings › About). */
  readonly version?: string
  readonly buildHash?: string | null
  /** The home-screen widget's snapshot (§7.13): written where the widget extension reads it. */
  readonly widget?: { publish(snapshot: WidgetSnapshot): Promise<void> }
}

/** What the home-screen widget shows (§7.13): the Field signature, the name, the tier — and the total the user opted into. */
export interface WidgetSnapshot {
  readonly address: string
  readonly label: string
  readonly tier: number
  readonly total: number | null
  readonly change24h: number | null
  readonly currency: 'USD' | 'ETN'
  readonly at: number
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
