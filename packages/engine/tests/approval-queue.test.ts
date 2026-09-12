/**
 * A full approval queue gives up its oldest page request (ES-BV-019).
 *
 * The global cap of eight threw `limit_exceeded` at whatever arrived next, so
 * four attacker tabs with two hidden requests each filled the queue and every
 * *later* request was turned away for up to the approval TTL — including the
 * one from the site the user was actually looking at, and the wallet's own
 * sends. Refusing the newest is the wrong end to refuse.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, expect, it } from 'vitest'
import { ApprovalStore } from '../src/approvals'
import { EventBus } from '../src/host'

const store = () => new ApprovalStore(createMemoryPlatform({ now: 1_700_000_000_000 }), new EventBus())

const from = (origin: string, tabId?: number) => ({
  kind: 'sign_message' as const,
  origin,
  accountId: 'acct-1',
  chainId: 52014,
  payload: { kind: 'sign_message', ...(tabId === undefined ? {} : { tabId }) },
})

describe('when the queue is full of page requests', () => {
  it('takes the newest and drops the oldest, rather than refusing', async () => {
    const s = store()
    const ids: string[] = []
    // Eight tabs, one request each: the per-tab cap is not what is under test.
    for (let i = 0; i < 8; i += 1) ids.push((await s.create(from(`https://site${i}.example`, i))).id)
    expect(s.list()).toHaveLength(8)

    const ninth = await s.create(from('https://site9.example', 9))
    expect(s.list()).toHaveLength(8)
    // The newest is there…
    expect(s.list().some((r) => r.id === ninth.id)).toBe(true)
    // …and the one that had been waiting longest is not.
    expect(s.list().some((r) => r.id === ids[0])).toBe(false)
    // The evicted page is told, which is a thing pages already handle.
    expect((await s.waitFor(ids[0] as string)).approved).toBe(false)
  })

  it('never pushes out the wallet’s own work for a page', async () => {
    const s = store()
    for (let i = 0; i < 8; i += 1) await s.create(from('internal:send'))
    // Nothing external to give up, so the page is the one that waits.
    await expect(s.create(from('https://site.example', 1))).rejects.toMatchObject({ code: 'limit_exceeded' })
    expect(s.list()).toHaveLength(8)
  })

  it('still holds one tab to its own two', async () => {
    const s = store()
    await s.create(from('https://site.example', 7))
    await s.create(from('https://site.example', 7))
    await expect(s.create(from('https://site.example', 7))).rejects.toMatchObject({ code: 'limit_exceeded' })
  })
})
