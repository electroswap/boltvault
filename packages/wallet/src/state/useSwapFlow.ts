/**
 * The in-flight swap / limit-order flow (master plan §8.6). A flow is up to
 * four sheets; the Swap tab unmounts while a sheet is up, so the flow lives
 * here, fed by `swap.progress` events, and `useFlowNavigation` (mounted in
 * the tab shell) opens the sheet for each step as the engine creates it.
 */
import type { SwapFlow } from '@boltvault/engine'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'
import { useRouter } from '../navigation/router'

interface FlowState {
  readonly activeId: string | null
  readonly flows: Readonly<Record<string, SwapFlow>>
}

let state: FlowState = { activeId: null, flows: {} }
const listeners = new Set<() => void>()
/** Sheets already opened, so a decided request is never re-opened by a late event. */
const opened = new Set<string>()

function set(next: FlowState): void {
  state = next
  for (const l of [...listeners]) l()
}

export const swapFlowStore = {
  get: (): FlowState => state,
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  setActive: (id: string | null): void => set({ ...state, activeId: id }),
  upsert: (flow: SwapFlow): void => set({ ...state, flows: { ...state.flows, [flow.id]: flow } }),
  clear: (): void => {
    opened.clear()
    set({ activeId: null, flows: {} })
  },
}

export function useSwapFlow(): {
  flow: SwapFlow | null
  setActive: (id: string | null) => void
  dismiss: () => void
} {
  const s = useSyncExternalStore(swapFlowStore.subscribe, swapFlowStore.get, swapFlowStore.get)
  const flow = s.activeId ? (s.flows[s.activeId] ?? null) : null
  const dismiss = useCallback(() => swapFlowStore.setActive(null), [])
  return { flow, setActive: swapFlowStore.setActive, dismiss }
}

/**
 * Mount once per body: every `swap.progress` lands in the store, and a step
 * of the active flow that is waiting for a signature opens its sheet once.
 * Only the flow the user started here takes the screen — our own flows never
 * arrive uninvited.
 */
export function useFlowNavigation(): void {
  const engine = useEngine()
  const router = useRouter()
  const s = useSyncExternalStore(swapFlowStore.subscribe, swapFlowStore.get, swapFlowStore.get)
  const onProgress = useCallback((e: { flow: SwapFlow }) => swapFlowStore.upsert(e.flow), [])
  useEngineEvent('swap.progress', onProgress)
  const flow = s.activeId ? (s.flows[s.activeId] ?? null) : null
  useEffect(() => {
    if (!flow || flow.status !== 'running') return
    const signing = flow.steps.find((st) => st.status === 'signing' && st.requestId)
    if (!signing?.requestId || opened.has(signing.requestId)) return
    opened.add(signing.requestId)
    router.navigate('sign', { requestId: signing.requestId })
  }, [flow, router])
  // Lock wipes the flow: the engine's approvals expire with it.
  useEffect(
    () =>
      engine.events.subscribe((ev) => {
        if (ev.type === 'vault.status' && !ev.status.unlocked) swapFlowStore.clear()
      }),
    [engine],
  )
}
