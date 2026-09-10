/**
 * The inbox (plan A6), and the one rule that keeps it readable: a standing
 * condition holds one row.
 *
 * "Rewards to collect" and "Dividends to claim" are not events that happened,
 * they are states that are still true. They used to be raised under a
 * day-stamped id, so a week of not collecting left a week of identical rows
 * stacked in Needs attention.
 */
import { describe, expect, it } from 'vitest'
import { NotificationsService } from '../src/namespaces/notifications'
import type { NotificationView } from '../src/schema'
import type { SealedMap } from '../src/sealed'

const ACCOUNT = 'acct_1'

function inbox(seed: NotificationView[] = []): SealedMap<NotificationView[]> {
  let held = seed
  return {
    get: async () => held,
    set: async (_id: string, value: NotificationView[]) => {
      held = value
      return true
    },
  } as unknown as SealedMap<NotificationView[]>
}

const bus = { emit: () => undefined } as never
const platform = { now: () => 1_700_000_000_000 } as never

function note(id: string, kind: NotificationView['kind'], at: number, title = 'Rewards to collect'): NotificationView {
  return { id, kind, title, body: '12 DYNO to collect', target: 'positions', at, read: false, accountId: ACCOUNT }
}

describe('the notifications inbox', () => {
  it('keeps only the newest standing note, whatever the old ones were filed under', async () => {
    // Three days of the old day-stamped ids, newest first as the store holds them.
    const service = new NotificationsService(
      platform,
      bus,
      inbox([note(`${ACCOUNT}:collect:${ACCOUNT}:19723`, 'collect', 3), note(`${ACCOUNT}:collect:${ACCOUNT}:19722`, 'collect', 2), note(`${ACCOUNT}:collect:${ACCOUNT}:19721`, 'collect', 1)]),
      async () => ACCOUNT,
    )
    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.at).toBe(3)
  })

  it('does not collapse events, which are news every time they happen', async () => {
    const service = new NotificationsService(platform, bus, inbox([note('a', 'alert', 3, 'BOLT above $1'), note('b', 'alert', 2, 'BOLT below $1')]), async () => ACCOUNT)
    expect(await service.list()).toHaveLength(2)
  })

  it('renews the standing note in place rather than adding beside it', async () => {
    const service = new NotificationsService(platform, bus, inbox(), async () => ACCOUNT)
    expect(await service.push({ id: 'collect:x', kind: 'collect', title: 'Rewards to collect', body: '3 DYNO', renew: true })).toBe(true)
    await service.markRead()
    // Same id, a day later: one row, unread again, carrying the new amount.
    expect(await service.push({ id: 'collect:x', kind: 'collect', title: 'Rewards to collect', body: '12 DYNO', renew: true })).toBe(true)
    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.body).toBe('12 DYNO')
    expect(list[0]?.read).toBe(false)
  })

  it('still swallows a repeat that is not a renewal', async () => {
    const service = new NotificationsService(platform, bus, inbox(), async () => ACCOUNT)
    expect(await service.push({ id: 'live:pool', kind: 'live', title: 'Live', body: 'now' })).toBe(true)
    expect(await service.push({ id: 'live:pool', kind: 'live', title: 'Live', body: 'now' })).toBe(false)
    expect(await service.list()).toHaveLength(1)
  })

  it('keeps one standing note per account, not one overall', async () => {
    const other: NotificationView = { ...note('other:collect', 'collect', 9), accountId: 'acct_2' }
    const service = new NotificationsService(platform, bus, inbox([note(`${ACCOUNT}:collect`, 'collect', 8), other]), async () => ACCOUNT)
    // This account sees its own; the other account's is held, not discarded.
    expect(await service.list()).toHaveLength(1)
    const both = new NotificationsService(platform, bus, inbox([note(`${ACCOUNT}:collect`, 'collect', 8), other]), async () => 'acct_2')
    expect((await both.list())[0]?.accountId).toBe('acct_2')
  })
})
