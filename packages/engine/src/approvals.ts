/**
 * ApprovalStore — the human-decision queue (master plan §2.4, §3.3).
 *
 * Only the engine creates requests. Each has a random 128-bit id, expires five
 * minutes after creation, and accepts exactly one decision. Pending requests
 * are persisted in *session* storage so a service-worker restart mid-sign
 * neither loses nor duplicates them; in-memory waiters (the provider layer's
 * awaiting promise) are re-attached by id after a restart.
 */
import type { Platform } from '@boltvault/platform'
import { toHex } from '@boltvault/platform'
import { z } from 'zod'
import { EngineError } from './errors'
import type { EventBus } from './host'
import { ApprovalRequestSchema, type ApprovalDecision, type ApprovalKind, type ApprovalRequest } from './schema'
import { readDoc, writeDoc, type DocSpec } from './storage'

const PENDING_DOC: DocSpec<ApprovalRequest[]> = {
  key: 'approvals.pending',
  version: 1,
  schema: z.array(ApprovalRequestSchema),
  defaultValue: () => [],
}

export const APPROVAL_TTL_MS = 5 * 60_000

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
  ) {}

  async hydrate(): Promise<void> {
    if (this.hydrated) return
    const { value } = await readDoc(this.platform.storage.session, PENDING_DOC, () => this.platform.now())
    for (const r of value) this.byId.set(r.id, r)
    this.hydrated = true
    this.expireDue()
  }

  private expireDue(): boolean {
    const now = this.platform.now()
    let changed = false
    for (const r of this.byId.values()) {
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
    return [...this.byId.values()].filter((r) => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
  }

  get(id: string): ApprovalRequest | undefined {
    this.expireDue()
    return this.byId.get(id)
  }

  async create(input: CreateApprovalInput): Promise<ApprovalRequest> {
    await this.hydrate()
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
    this.byId.set(req.id, req)
    await this.persist()
    return req
  }

  /** Resolves when the request is decided or expires; `approved: false` on reject/expiry. */
  async waitFor(id: string): Promise<{ approved: boolean; data?: unknown }> {
    const existing = this.get(id)
    if (!existing) throw new EngineError('not_found', `no approval request ${id}`)
    if (existing.status !== 'pending') return { approved: existing.status === 'approved', data: existing.decisionData }
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

  /** Record the one decision for a request. */
  async decide(decision: ApprovalDecision): Promise<ApprovalRequest> {
    await this.hydrate()
    const req = this.get(decision.id)
    if (!req) throw new EngineError('not_found', `no approval request ${decision.id}`)
    if (req.status === 'expired') throw new EngineError('expired', 'this request has expired')
    if (req.status !== 'pending') throw new EngineError('already_decided', 'this request was already decided')
    const decided: ApprovalRequest = { ...req, status: decision.approve ? 'approved' : 'rejected', ...(decision.data !== undefined ? { decisionData: decision.data } : {}) }
    this.byId.set(req.id, decided)
    this.resolveWaiters(req.id, decision.approve)
    await this.persist()
    return decided
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
