/**
 * Multi-signature flows (master plan §8.6): a swap is up to three sheets —
 * approve, permit, swap — and a limit order up to four. Each step creates
 * one internal approval; the flow waits for the sheet's decision, then for
 * the receipt when the next step depends on it, and reports progress as
 * `swap.progress` events so the screen can walk the user through it.
 */
import type { Platform } from '@boltvault/platform'
import type { EventBus } from '../host'
import type { ActivityEntry, SwapFlow, SwapQuote, SwapStep } from '../schema'
import type { ActivityStore } from '../activityStore'

export interface FlowStepRun {
  readonly step: SwapStep
  /** Creates the approval; `result` settles when the sheet decided and the step executed (hash or signature). A step with no sheet (an API call) returns `requestId: null`. */
  readonly run: (flowId: string) => Promise<{ requestId: string | null; result: Promise<unknown> }>
  /** Wait for the receipt before the next step (an approve must land before the swap's estimate). */
  readonly waitReceipt?: boolean
}

export interface FlowDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly activity: ActivityStore
}

/** How long a step may sit unconfirmed before the flow gives up (ETN blocks are 5 s; other chains slower). */
const RECEIPT_TIMEOUT_MS = 20 * 60_000

export class FlowStore {
  private readonly flows = new Map<string, SwapFlow>()
  private counter = 0

  constructor(private readonly deps: FlowDeps) {}

  get(id: string): SwapFlow | null {
    return this.flows.get(id) ?? null
  }

  list(accountId?: string): SwapFlow[] {
    return [...this.flows.values()].filter((f) => !accountId || f.accountId === accountId).sort((a, b) => b.startedAt - a.startedAt)
  }

  private emit(flow: SwapFlow): void {
    this.flows.set(flow.id, flow)
    this.deps.bus.emit({ type: 'swap.progress', flow })
  }

  private patch(id: string, patch: Partial<SwapFlow>): SwapFlow {
    const cur = this.flows.get(id)
    if (!cur) throw new Error('no such flow')
    const next = { ...cur, ...patch }
    this.emit(next)
    return next
  }

  private patchStep(id: string, index: number, patch: Partial<SwapFlow['steps'][number]>): void {
    const cur = this.flows.get(id)
    if (!cur) return
    const steps = cur.steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
    this.patch(id, { steps })
  }

  /** A step re-quoted (the tier moved at sign time): keep the sheet and the screen on the same numbers. */
  setQuote(id: string, quote: SwapQuote): void {
    if (this.flows.has(id)) this.patch(id, { quote })
  }

  /** Resolve when the activity row for `requestId` is confirmed; throw when it failed or timed out. */
  private waitReceipt(requestId: string): Promise<ActivityEntry> {
    return new Promise((resolve, reject) => {
      let off: (() => void) | null = null
      const timer = setTimeout(() => {
        off?.()
        reject(new Error('The network did not confirm this step in time.'))
      }, RECEIPT_TIMEOUT_MS)
      const settle = (e: ActivityEntry): boolean => {
        if (e.status === 'confirmed') {
          clearTimeout(timer)
          off?.()
          resolve(e)
          return true
        }
        if (e.status === 'failed' || e.status === 'replaced') {
          clearTimeout(timer)
          off?.()
          reject(new Error(e.status === 'failed' ? 'The network refused this step.' : 'This step was replaced.'))
          return true
        }
        return false
      }
      off = this.deps.bus.subscribe((ev) => {
        if (ev.type !== 'activity.changed') return
        const hit = ev.entries.find((e) => e.id === requestId)
        if (hit) settle(hit)
      })
      void this.deps.activity
        .list({})
        .then((entries) => {
          const hit = entries.find((e) => e.id === requestId)
          if (hit) settle(hit)
        })
        .catch(() => undefined)
    })
  }

  /**
   * Start a flow. Resolves as soon as the first step's approval exists (so the
   * screen can open the sheet); the rest runs in the background and reports
   * through events. `quote` is re-evaluated by the caller inside a step's `run`.
   */
  async start(input: { kind: SwapFlow['kind']; accountId: string; chainId: number; quote: SwapQuote | null; steps: readonly FlowStepRun[] }): Promise<SwapFlow> {
    const id = `flow-${this.deps.platform.now().toString(36)}-${(++this.counter).toString(36)}`
    const flow: SwapFlow = {
      id,
      kind: input.kind,
      accountId: input.accountId,
      chainId: input.chainId,
      steps: input.steps.map((s) => ({ step: s.step, requestId: null, status: 'pending' as const, hash: null })),
      status: 'running',
      error: null,
      hash: null,
      quote: input.quote,
      startedAt: this.deps.platform.now(),
    }
    this.emit(flow)
    let firstReady: () => void = () => undefined
    const first = new Promise<void>((resolve) => {
      firstReady = resolve
    })
    void (async () => {
      try {
        for (let i = 0; i < input.steps.length; i++) {
          const s = input.steps[i] as FlowStepRun
          const { requestId, result } = await s.run(id)
          this.patchStep(id, i, { requestId, status: requestId ? 'signing' : 'submitted' })
          if (i === 0) firstReady()
          let value: unknown
          try {
            value = await result
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            const rejected = /rejected/i.test(message)
            this.patchStep(id, i, { status: rejected ? 'rejected' : 'failed' })
            this.patch(id, { status: rejected ? 'rejected' : 'failed', error: rejected ? null : message })
            return
          }
          const hash = typeof value === 'string' && value.startsWith('0x') && value.length === 66 ? value : null
          this.patchStep(id, i, { status: 'submitted', hash })
          if (s.waitReceipt && hash && requestId) {
            try {
              await this.waitReceipt(requestId)
            } catch (err) {
              this.patchStep(id, i, { status: 'failed' })
              this.patch(id, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
              return
            }
          }
          // The last step's confirmation and the flow's completion land in one event.
          const last = i === input.steps.length - 1
          const cur = this.flows.get(id)
          if (!cur) return
          this.patch(id, { steps: cur.steps.map((st, j) => (j === i ? { ...st, status: 'confirmed' as const } : st)), ...(last ? { status: 'done' as const, hash: hash ?? (typeof value === 'string' ? value : null) } : {}) })
        }
      } catch (err) {
        this.patch(id, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
      } finally {
        firstReady()
      }
    })()
    await first
    return this.flows.get(id) as SwapFlow
  }
}
