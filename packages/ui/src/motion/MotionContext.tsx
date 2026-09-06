/**
 * The motion preference, for primitives that animate on their own (a key's
 * charge, a pill's fill, the dock's indicator): the shell sets it once from
 * Settings › Reduce motion or the system, and every micro-interaction reads
 * it here instead of threading a prop through each call site.
 */
import { createContext, useContext, type ReactNode } from 'react'

const MotionPreference = createContext(false)

export function MotionProvider({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  return <MotionPreference.Provider value={reduced}>{children}</MotionPreference.Provider>
}

/** True when motion should be reduced: transitions run at 0 ms and one-shot animations do not mount. */
export function useReducedMotionPref(): boolean {
  return useContext(MotionPreference)
}
