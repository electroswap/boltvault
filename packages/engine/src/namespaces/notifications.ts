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
import { type NotificationView } from '../schema'

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
    /**
     * Whose wallet is in front. Notes about holdings belong to one account, and
     * without this the inbox was one shared list: a "dividends to claim" notice
     * raised for one account appeared under every other account, including
     * accounts holding none of that collection.
     */
    private readonly activeAccountId: () => Promise<string | null> = async () => null,
  ) {}

  /** Drop the decrypted inbox on lock, so unlocking re-reads it. */
  forget(): void {
    this.items = null
  }

  private async hydrate(): Promise<NotificationView[]> {
    if (this.items) return this.items
    const stored = (await this.inbox.get(INBOX_ID)) ?? []
    // Entries written before notes carried an account cannot be attributed, and
    // the whole reason for this change is that unattributed notes were shown to
    // the wrong wallet. Drop them once; they are re-raised by the next scan.
    const kept = stored.filter((n) => n.accountId !== undefined)
    this.items = collapse(kept)
    /*
      Write the tidy-up back rather than re-doing it on every read.

      An inbox that accumulated day-stamped rows before this rule existed would
      otherwise keep them on disk indefinitely, filtered out on the way past —
      which is fine until something reads the store without going through here.
      Best effort: a locked vault refuses the write and the read-time collapse
      still holds.
    */
    if (this.items.length !== stored.length) void this.persist(this.items).catch(() => undefined)
    return this.items
  }

  /** Notes for this account, plus the ones that belong to the wallet itself. */
  private mine(items: readonly NotificationView[], accountId: string | null): NotificationView[] {
    return items.filter((n) => n.accountId === null || n.accountId === accountId)
  }

  private async persist(items: NotificationView[]): Promise<void> {
    this.items = items.slice(0, MAX)
    await this.inbox.set(INBOX_ID, this.items)
    this.bus.emit({ type: 'notifications.changed', unread: this.items.filter((n) => !n.read).length })
  }

  async list(): Promise<NotificationView[]> {
    return this.mine(await this.hydrate(), await this.activeAccountId())
  }

  async unread(): Promise<number> {
    return this.mine(await this.hydrate(), await this.activeAccountId()).filter((n) => !n.read).length
  }

  /**
   * Append once per id (a repeat is a no-op, read or not). Newest first.
   *
   * `renew` is for the standing conditions — dividends to claim, rewards to
   * collect. Those are not events that happened once; they are a state that is
   * still true, and they were being raised again every day under a
   * day-stamped id. Nothing deduped across days, so a week of not claiming
   * left seven identical "Dividends to claim" rows stacked in Needs attention
   * (owner: "Multiple 'Dividends to claim' on Activity tab"). With `renew` the
   * standing note is one row that is brought back up to date and unread,
   * carrying the current amount, instead of a new row beside the old ones.
   */
  async push(input: { id: string; kind: NotificationView['kind']; title: string; body: string; target?: string | null; accountId?: string | null; renew?: boolean }): Promise<boolean> {
    const items = await this.hydrate()
    // Ids are scoped too: the same dividends notice for two accounts is two
    // notes, not one that the second account silently swallows as a duplicate.
    const accountId = input.accountId !== undefined ? input.accountId : await this.activeAccountId()
    const id = accountId === null ? input.id : `${accountId}:${input.id}`
    const note: NotificationView = { id, kind: input.kind, title: input.title, body: input.body, target: input.target ?? null, at: this.platform.now(), read: false, accountId }
    if (items.some((n) => n.id === id)) {
      if (input.renew !== true) return false
      await this.persist([note, ...items.filter((n) => n.id !== id)])
      return true
    }
    await this.persist([note, ...items])
    return true
  }

  /** Mark some (or all) as read. */
  async markRead(ids?: readonly string[]): Promise<void> {
    const items = await this.hydrate()
    const set = ids ? new Set(ids) : null
    if (!items.some((n) => !n.read && (!set || set.has(n.id)))) return
    await this.persist(items.map((n) => (!set || set.has(n.id) ? { ...n, read: true } : n)))
  }

  /** Clears only what this account can see; another account's inbox is not ours to empty. */
  async clear(): Promise<void> {
    const accountId = await this.activeAccountId()
    const items = await this.hydrate()
    await this.persist(items.filter((n) => !(n.accountId === null || n.accountId === accountId)))
  }
}

/**
 * Kinds that describe a condition rather than an event, and so may only ever
 * hold one row per account. An alert crossing a threshold is news each time it
 * happens; "you have dividends to claim" is the same sentence until you claim.
 */
const STANDING: ReadonlySet<NotificationView['kind']> = new Set<NotificationView['kind']>(['collect', 'dividends'])

/**
 * At most one standing note per account and kind, newest kept.
 *
 * Runs on every read so an inbox that already accumulated day-stamped
 * duplicates heals itself on the next open, rather than needing the user to
 * clear it.
 */
function collapse(items: readonly NotificationView[]): NotificationView[] {
  const seen = new Set<string>()
  const out: NotificationView[] = []
  for (const n of items) {
    if (!STANDING.has(n.kind)) {
      out.push(n)
      continue
    }
    const stream = `${n.accountId ?? '-'}:${n.kind}`
    if (seen.has(stream)) continue
    seen.add(stream)
    out.push(n)
  }
  return out
}

export function notificationsNamespace(n: NotificationsService): NamespaceSpec {
  return {
    list: { handler: () => n.list() },
    unread: { handler: () => n.unread() },
    markRead: { input: z.object({ ids: z.array(z.string()).optional() }).optional(), handler: (arg) => n.markRead((arg as { ids?: string[] } | undefined)?.ids) },
    clear: { handler: () => n.clear() },
  }
}
