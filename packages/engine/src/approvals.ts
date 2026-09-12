/**
 * ApprovalStore — the human-decision queue (master plan §2.4, §3.3).
 *
 * Only the engine creates requests. Each has a random 128-bit id and expires
 * five minutes after creation.
 *
 * A request accepts exactly one FINAL decision — but for the kinds that end in
 * a signature, saying yes is not yet final. Those move to `signing`, and the
 * signer reports back through `settle`: a signature makes them `approved`, and
 * a refusal (a Ledger's reject button, pressed by mistake) returns them to
 * `pending`, carrying the reason, so the same request can be approved again
 * instead of being lost. `approved` therefore means "this was signed", not "a
 * button was pressed". Connect, switch-chain and watch-asset have no signature
 * to wait for and are final immediately.
 *
 * `decide` deliberately does NOT wait for the signature. Keystone and a paired
 * device need more of the interface after the yes — frames to scan, another
 * machine to answer — so a decide that blocked until signed would deadlock:
 * the signature waiting on the user, the user waiting on the decide. Screens
 * follow the request's status instead, which works the same for a Ledger held
 * in the hand and a laptop in the next room.
 *
 * Pending requests
 * are persisted in *session* storage so a service-worker restart mid-sign
 * neither loses nor duplicates them; in-memory waiters (the provider layer's
 * awaiting promise) are re-attached by id after a restart.
 */
import type { Platform } from '@boltvault/platform'
import { toHex } from '@boltvault/platform'
import { z } from 'zod'
import { EngineError } from './errors'
import type { EventBus } from './host'
import {
  ApprovalRequestSchema,
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalRequest,
} from './schema'
import { readDoc, writeDoc, type DocSpec } from './storage'

const PENDING_DOC: DocSpec<ApprovalRequest[]> = {
  key: 'approvals.pending',
  version: 1,
  schema: z.array(ApprovalRequestSchema),
  defaultValue: () => [],
}

/** The tab a request's payload names, where it names one (ES-BV-019). */
function tabOf(payload: unknown): number | undefined {
  const tabId = (payload as { tabId?: unknown } | null)?.tabId
  return typeof tabId === 'number' ? tabId : undefined
}

export const APPROVAL_TTL_MS = 5 * 60_000
/**
 * How many requests may wait for a human at once, across every origin. Eight
 * is more than any honest flow needs and far fewer than a page can use to
 * bury the sheet the user meant to read.
 */
export const MAX_PENDING = 8
/**
 * How many of those one tab may hold (ES-BV-019).
 *
 * The global cap is shared across every origin, and a page can host
 * cross-origin iframes — so eight iframes on eight attacker origins filled the
 * whole queue and a legitimate dApp got `limit_exceeded` for as long as five
 * minutes. Two per tab is more than any honest flow needs, and it means the
 * queue can only be filled by that many separate tabs the user opened.
 */
export const MAX_PENDING_PER_TAB = 2

/**
 * The kinds that end in a signature, and therefore the only kinds where
 * "approved" can mean "signed".
 *
 * Connecting a site, switching a chain or watching an asset is finished the
 * moment the human says yes — there is no device to wait for and nothing that
 * can refuse afterwards. Holding those open would strand them in `signing`
 * with no signer to settle them.
 */
const SIGNS: ReadonlySet<ApprovalKind> = new Set<ApprovalKind>([
  'sign_message',
  'sign_typed_data',
  'send_transaction',
])

export interface CreateApprovalInput {
  readonly kind: ApprovalKind
  readonly origin: string
  readonly accountId: string | null
  readonly chainId: number | null
  readonly payload: unknown
}

export class ApprovalStore {
  private readonly byId = new Map<string, ApprovalRequest>()
  private readonly waiters = new Map<string, Array<(approved: boolean) => void>>()
  private hydrated = false

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly ttlMs: number = APPROVAL_TTL_MS,
    /**
     * Whether the signed flags say this build is too old to sign (ES-BV-007).
     *
     * The blocking plate moved off the shell so the user can still reach their
     * recovery phrase — which means the refusal has to live where the
     * signature is, not where the screen is. Absent in a harness with no
     * statics, which then signs as it always did.
     */
    private readonly updateRequired: () => boolean = () => false,
  ) {}

  async hydrate(): Promise<void> {
    if (this.hydrated) return
    const { value } = await readDoc(this.platform.storage.session, PENDING_DOC, () =>
      this.platform.now(),
    )
    for (const r of value) {
      // Nobody is holding a `signing` request's promise after a restart — the
      // signer went down with the worker — so it returns to the queue rather
      // than sitting in a state only a live signer can leave.
      this.byId.set(
        r.id,
        r.status === 'signing'
          ? { ...r, status: 'pending', expiresAt: this.platform.now() + this.ttlMs }
          : r,
      )
    }
    this.hydrated = true
    this.expireDue()
  }

  private expireDue(): boolean {
    const now = this.platform.now()
    let changed = false
    for (const r of this.byId.values()) {
      // A request in the signer's hands cannot expire underneath it.
      if (r.status === 'pending' && r.expiresAt <= now) {
        this.byId.set(r.id, { ...r, status: 'expired' })
        this.resolveWaiters(r.id, false)
        changed = true
      }
    }
    return changed
  }

  private resolveWaiters(id: string, approved: boolean): void {
    const ws = this.waiters.get(id)
    if (!ws) return
    this.waiters.delete(id)
    for (const w of ws) w(approved)
  }

  private async persist(): Promise<void> {
    const pending = this.list()
    await writeDoc(this.platform.storage.session, PENDING_DOC, pending)
    this.bus.emit({ type: 'approvals.changed', pending })
  }

  /** Pending requests, oldest first. Expired ones are dropped lazily. */
  list(): ApprovalRequest[] {
    this.expireDue()
    // `signing` stays in the list: the screen has to keep showing the request
    // while the device is being asked, and a refusal puts it back to pending.
    return [...this.byId.values()]
      .filter((r) => r.status === 'pending' || r.status === 'signing')
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  get(id: string): ApprovalRequest | undefined {
    this.expireDue()
    return this.byId.get(id)
  }

  async create(input: CreateApprovalInput): Promise<ApprovalRequest> {
    await this.hydrate()
    /*
      A queue of pending decisions is a queue of windows and notifications, and
      a page that can add to it without limit can bury the one the user
      actually meant to read. The wallet's own flows are exempt: a hostile page
      must not be able to stop someone sending their own funds.
    */
    const external = !input.origin.startsWith('internal:')
    const tabId = tabOf(input.payload)
    /*
      A page can host cross-origin iframes, so the global cap alone let eight
      of them fill the queue and lock out the site the user was actually
      looking at (ES-BV-019). A per-tab cap means only tabs the user opened can
      contribute.
    */
    if (external && tabId !== undefined) {
      const fromTab = this.list().filter(
        (r) => r.status === 'pending' && tabOf(r.payload) === tabId,
      )
      if (fromTab.length >= MAX_PENDING_PER_TAB)
        throw new EngineError(
          'limit_exceeded',
          'This tab already has requests waiting for you. Answer or dismiss one first.',
        )
    }
    if (external && this.list().length >= MAX_PENDING)
      throw new EngineError(
        'limit_exceeded',
        'Too many requests are already waiting for you. Answer or dismiss one first.',
      )
    const now = this.platform.now()
    const req: ApprovalRequest = {
      id: toHex(this.platform.random(16)),
      kind: input.kind,
      origin: input.origin,
      accountId: input.accountId,
      chainId: input.chainId,
      payload: input.payload,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      status: 'pending',
    }
    /*
      Persist first (ES-BV-020).

      The entry went into the map and *then* was written, so a storage failure
      — a quota a page had just filled with an oversized payload — left a
      request in memory that no restart would ever find and that `isPending`
      reported as blocking the origin. If it cannot be written down it did not
      happen.
    */
    this.byId.set(req.id, req)
    try {
      await this.persist()
    } catch (err) {
      this.byId.delete(req.id)
      throw err
    }
    return req
  }

  /** Resolves when the request is decided or expires; `approved: false` on reject/expiry. */
  async waitFor(id: string): Promise<{ approved: boolean; data?: unknown }> {
    const existing = this.get(id)
    if (!existing) throw new EngineError('not_found', `no approval request ${id}`)
    /*
      `signing` counts as approved: the human has said yes and the request is
      in a signer's hands. It matters on the retry path — a refusal returns the
      request to `pending`, the signer loops round to wait again, and the next
      yes can land in the gap between `settle` persisting and `waitFor`
      registering. Reading `signing` as "not approved" turned that race into a
      phantom rejection of a request the person had just approved.
    */
    if (existing.status !== 'pending')
      return {
        approved: existing.status === 'approved' || existing.status === 'signing',
        data: existing.decisionData,
      }
    const approved = await new Promise<boolean>((resolve) => {
      const ws = this.waiters.get(id) ?? []
      ws.push(resolve)
      this.waiters.set(id, ws)
    })
    return { approved, data: this.byId.get(id)?.decisionData }
  }

  /** A pending request matching a predicate (re-attach after a worker restart). */
  findPending(predicate: (r: ApprovalRequest) => boolean): ApprovalRequest | undefined {
    return this.list().find(predicate)
  }

  /**
   * Record the decision — and, when it is a yes, wait for the signature.
   *
   * `approved` used to be set the instant the user pressed the key, which made
   * it mean "a button was pressed" rather than "this is signed". A hardware
   * wallet can still refuse after that press, and because the store accepted
   * exactly one decision forever, a mis-tapped reject on a Ledger destroyed the
   * transaction: the request was already `approved` and would not take another
   * decision. Owner: "I also want to wait for the confirmation from the
   * hardware wallet when applicable, so we can retry if rejected by mistake."
   *
   * So a yes moves the request to `signing` and releases the signer, then this
   * promise stays open until `settle` reports what the signer got. A signature
   * makes it `approved`; a refusal puts it back to `pending`, with a fresh
   * expiry, and rethrows — so the same request can simply be approved again.
   *
   * A no is still final and immediate; nothing has to be waited for.
   */
  async decide(decision: ApprovalDecision): Promise<ApprovalRequest> {
    await this.hydrate()
    const req = this.get(decision.id)
    if (!req) throw new EngineError('not_found', `no approval request ${decision.id}`)
    if (req.status === 'expired') throw new EngineError('expired', 'this request has expired')
    if (req.status === 'signing')
      throw new EngineError('invalid_argument', 'this request is already being signed')
    if (req.status !== 'pending')
      throw new EngineError('already_decided', 'this request was already decided')
    /*
      A stale build may refuse, and may not sign (ES-BV-007). Rejecting is
      always allowed: leaving a queue of requests nobody can answer would be
      its own kind of lock-out.
    */
    if (decision.approve && this.updateRequired())
      throw new EngineError(
        'invalid_argument',
        'BoltVault needs updating before it can sign. Your recovery phrase and export are still available in Settings.',
      )

    if (!decision.approve) {
      const rejected: ApprovalRequest = {
        ...req,
        status: 'rejected',
        ...(decision.data !== undefined ? { decisionData: decision.data } : {}),
      }
      this.byId.set(req.id, rejected)
      this.resolveWaiters(req.id, false)
      await this.persist()
      return rejected
    }

    // Nothing to wait for unless a signature is coming.
    if (!SIGNS.has(req.kind)) {
      const approved: ApprovalRequest = {
        ...req,
        status: 'approved',
        ...(decision.data !== undefined ? { decisionData: decision.data } : {}),
      }
      this.byId.set(req.id, approved)
      this.resolveWaiters(req.id, true)
      await this.persist()
      return approved
    }

    const handed: ApprovalRequest = {
      ...req,
      status: 'signing',
      lastError: null,
      ...(decision.data !== undefined ? { decisionData: decision.data } : {}),
    }
    this.byId.set(req.id, handed)
    await this.persist()
    // Release the signer only once the request is recorded as in flight.
    this.resolveWaiters(req.id, true)
    return handed
  }

  /**
   * What the signer got. Called by whoever performed the signing, always —
   * an unsettled request would leave `decide` hanging and the screen with it.
   *
   * `retryable` separates the two ways a signature can fail to happen, and the
   * difference is a security one. A device refusing — the wrong button on a
   * Ledger — is the case this whole state exists for, and returns the request
   * to `pending` so it can be approved again. BoltVault refusing is final: a
   * blocked assessment must not come back as a request the user can approve
   * once more, or a block becomes a prompt to keep trying.
   */
  async settle(id: string, ok: boolean, message?: string, retryable = true): Promise<void> {
    const req = this.byId.get(id)
    if (!req || req.status !== 'signing') return
    if (ok) {
      this.byId.set(id, { ...req, status: 'approved', lastError: null })
    } else if (retryable) {
      // Back to the queue, with the full window again and the reason attached:
      // the user is about to be asked to approve it a second time and should
      // be told why the first attempt did not take.
      this.byId.set(id, {
        ...req,
        status: 'pending',
        expiresAt: this.platform.now() + this.ttlMs,
        lastError: message ?? 'The device refused to sign.',
      })
    } else {
      this.byId.set(id, { ...req, status: 'rejected', lastError: message ?? null })
    }
    await this.persist()
  }

  /** Reject every pending request for an origin (tab closed, site disconnected). */
  async rejectAll(predicate: (r: ApprovalRequest) => boolean): Promise<void> {
    for (const r of this.list().filter(predicate)) await this.decide({ id: r.id, approve: false })
  }

  /** Drop decided/expired requests older than the TTL (housekeeping). */
  prune(): void {
    const cutoff = this.platform.now() - this.ttlMs
    for (const [id, r] of this.byId) {
      if (r.status !== 'pending' && r.createdAt < cutoff) this.byId.delete(id)
    }
  }
}
