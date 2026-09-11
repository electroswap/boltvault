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

/**
 * A step that did not finish, described well enough to report.
 *
 * `phase` is the part of the step that broke, and the three parts fail for
 * genuinely different reasons: `run` throws before there is a sheet at all (a
 * re-quote, an encoder refusal), `result` rejects once the sheet has been
 * decided (a rejection, a broadcast that failed), and `receipt` means the chain
 * took the transaction and then went against it. A report that could not tell
 * them apart would name the wrong stage for most failures.
 */
export interface FlowStepFailure {
  readonly step: SwapStep
  readonly index: number
  readonly phase: 'run' | 'result' | 'receipt'
  readonly error: unknown
  /** The user declined the sheet. Never telemetry — this exists so a reporter can drop it. */
  readonly rejected: boolean
  readonly requestId: string | null
  /** The step's transaction hash, when it had got that far. */
  readonly hash: string | null
}

/**
 * A receipt that went against the flow, carrying the row that says so.
 *
 * The message is all the screen needs. A failure report needs the block the
 * revert landed in, and the activity row is the only place the flow ever sees
 * it — rejecting with a bare `Error` threw it away.
 */
export class FlowReceiptError extends Error {
  override readonly name = 'FlowReceiptError'
  constructor(
    message: string,
    readonly entry: ActivityEntry | null,
  ) {
    super(message)
  }
}

/** The wallet's own word for a declined sheet; `ProviderService` rejects with exactly this (`EngineError('rejected')`). */
function isRejection(message: string): boolean {
  return /rejected/i.test(message)
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

  /** Tell the caller a step failed, and never let that telling become the failure. */
  private notifyFailed(onFailed: ((failure: FlowStepFailure) => void) | undefined, failure: FlowStepFailure): void {
    if (!onFailed) return
    try {
      onFailed(failure)
    } catch {
      // A flow that already failed must not fail twice; a listener never breaks it.
    }
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
        reject(new FlowReceiptError('The network did not confirm this step in time.', null))
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
          reject(new FlowReceiptError(e.status === 'failed' ? 'The network refused this step.' : 'This step was replaced.', e))
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
   *
   * `onFailed` is told about every step that does not finish, before the flow's
   * own state is patched. It is a notification and nothing else: it cannot
   * change the outcome, and `notifyFailed` swallows whatever it throws, because
   * a flow that already failed must not fail twice.
   */
  async start(input: {
    kind: SwapFlow['kind']
    accountId: string
    chainId: number
    quote: SwapQuote | null
    steps: readonly FlowStepRun[]
    onFailed?: (failure: FlowStepFailure) => void
  }): Promise<SwapFlow> {
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
          let started: { requestId: string | null; result: Promise<unknown> }
          try {
            started = await s.run(id)
          } catch (err) {
            /*
              Raising the sheet is where a swap's own refusals land — the
              sign-time re-quote saying the price moved, the encoder refusing a
              route it cannot express. The outer catch below already marks the
              flow failed, and rethrowing keeps that behaviour exactly; this
              only makes sure the step is named before it does.
            */
            this.notifyFailed(input.onFailed, { step: s.step, index: i, phase: 'run', error: err, rejected: isRejection(err instanceof Error ? err.message : String(err)), requestId: null, hash: null })
            throw err
          }
          const { requestId, result } = started
          this.patchStep(id, i, { requestId, status: requestId ? 'signing' : 'submitted' })
          if (i === 0) firstReady()
          let value: unknown
          try {
            value = await result
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            const rejected = isRejection(message)
            this.notifyFailed(input.onFailed, { step: s.step, index: i, phase: 'result', error: err, rejected, requestId, hash: null })
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
              this.notifyFailed(input.onFailed, { step: s.step, index: i, phase: 'receipt', error: err, rejected: false, requestId, hash })
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
