/**
 * The engine reaches the UI through React context. Screens never construct an
 * engine: the extension passes a channel client, mobile passes the in-process
 * one, tests pass a fake — the same screens run in all three.
 */
import type { EngineEvent, WalletEngine } from '@boltvault/engine'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const EngineContext = createContext<WalletEngine | null>(null)

export function EngineProvider({
  engine,
  children,
}: {
  engine: WalletEngine
  children: ReactNode
}) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
}

export function useEngine(): WalletEngine {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('useEngine must be used inside <EngineProvider>')
  return engine
}

/** Subscribe to one engine event type for the lifetime of the component. */
export function useEngineEvent<T extends EngineEvent['type']>(
  type: T,
  listener: (event: Extract<EngineEvent, { type: T }>) => void,
): void {
  const engine = useEngine()
  useEffect(
    () =>
      engine.events.subscribe((event) => {
        if (event.type === type) listener(event as Extract<EngineEvent, { type: T }>)
      }),
    [engine, type, listener],
  )
}

export interface AsyncState<T> {
  readonly value: T | null
  readonly error: string | null
  readonly loading: boolean
}

/** Load once, then refresh whenever `deps` change. Errors are strings for the UI. */
export function useEngineQuery<T>(
  load: (engine: WalletEngine) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { refresh: () => void } {
  const engine = useEngine()
  const [state, setState] = useState<AsyncState<T>>({ value: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    load(engine).then(
      (value) => {
        if (!cancelled) setState({ value, error: null, loading: false })
      },
      (err: unknown) => {
        if (!cancelled)
          setState({
            value: null,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          })
      },
    )
    return () => {
      cancelled = true
    }
  }, [engine, tick, ...deps])
  return { ...state, refresh: () => setTick((t) => t + 1) }
}
