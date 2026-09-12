/**
 * Safe-area insets, as plain context.
 *
 * The Android window is edge-to-edge on purpose (android/gradle.properties sets
 * `edgeToEdgeEnabled=true`, and both system bars are transparent), so the shell
 * has to pad itself or the header sits under the status bar and the dock under
 * the gesture bar — which is exactly what the owner filmed.
 *
 * The values come from react-native-safe-area-context, but that import lives in
 * the mobile app, not here: the extension's popup bundle has ~1 KB of headroom
 * against the 900 KB budget in e2e/gate.spec.ts, and it has no insets to report
 * anyway. A body that has them provides them; every other body gets zeros and
 * lays out exactly as before.
 */
import { createContext, useContext, type ReactNode } from 'react'

export interface Insets {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

const NONE: Insets = { top: 0, bottom: 0, left: 0, right: 0 }

const InsetsContext = createContext<Insets>(NONE)

export function InsetsProvider({
  insets,
  children,
}: {
  insets?: Insets | null
  children: ReactNode
}) {
  return <InsetsContext.Provider value={insets ?? NONE}>{children}</InsetsContext.Provider>
}

/** Zeros unless a body provided real ones — never undefined, never throws. */
export function useInsets(): Insets {
  return useContext(InsetsContext)
}
