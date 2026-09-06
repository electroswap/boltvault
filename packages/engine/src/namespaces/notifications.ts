/**
 * The notifications inbox (plan A6): everything the wallet would tell the
 * user — a price alert, a campaign going live, an offer on a piece, rewards
 * to collect — kept as a small persisted list with a read mark, so the
 * Activity tab can carry a badge and a "needs attention" section. OS
 * notifications still go out through `platform.notify`; this is the record.
 */
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import type { SealedMap } from '../sealed'
import type { EventBus, NamespaceSpec } from '../host'
import { NotificationViewSchema, type NotificationView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'

/** One sealed entry; inbox rows name tokens, campaigns and amounts. */
const INBOX_ID = 'all'
const MAX = 100

export class NotificationsService {
  private items: NotificationView[] | null = null

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    /** Sealed under the DEK; empty while locked, so a locked wallet shows no inbox. */
    private readonly inbox: SealedMap<NotificationView[]>,
  ) {}

  /** Drop the decrypted inbox on lock, so unlocking re-reads it. */
  forget(): void {
    this.items = null
  }

  private async hydrate(): Promise<NotificationView[]> {
    if (this.items) return this.items
    this.items = (await this.inbox.get(INBOX_ID)) ?? []
    return this.items
  }

  private async persist(items: NotificationView[]): Promise<void> {
    this.items = items.slice(0, MAX)
    await this.inbox.set(INBOX_ID, this.items)
    this.bus.emit({ type: 'notifications.changed', unread: this.items.filter((n) => !n.read).length })
  }

  async list(): Promise<NotificationView[]> {
    return [...(await this.hydrate())]
  }

  async unread(): Promise<number> {
    return (await this.hydrate()).filter((n) => !n.read).length
  }

  /** Append once per id (a repeat is a no-op, read or not). Newest first. */
  async push(input: { id: string; kind: NotificationView['kind']; title: string; body: string; target?: string | null }): Promise<boolean> {
    const items = await this.hydrate()
    if (items.some((n) => n.id === input.id)) return false
    await this.persist([{ id: input.id, kind: input.kind, title: input.title, body: input.body, target: input.target ?? null, at: this.platform.now(), read: false }, ...items])
    return true
  }

  /** Mark some (or all) as read. */
  async markRead(ids?: readonly string[]): Promise<void> {
    const items = await this.hydrate()
    const set = ids ? new Set(ids) : null
    if (!items.some((n) => !n.read && (!set || set.has(n.id)))) return
    await this.persist(items.map((n) => (!set || set.has(n.id) ? { ...n, read: true } : n)))
  }

  async clear(): Promise<void> {
    await this.persist([])
  }
}

export function notificationsNamespace(n: NotificationsService): NamespaceSpec {
  return {
    list: { handler: () => n.list() },
    unread: { handler: () => n.unread() },
    markRead: { input: z.object({ ids: z.array(z.string()).optional() }).optional(), handler: (arg) => n.markRead((arg as { ids?: string[] } | undefined)?.ids) },
    clear: { handler: () => n.clear() },
  }
}
