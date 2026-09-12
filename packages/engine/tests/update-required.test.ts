/**
 * A stale build stops signing and nothing else (ES-BV-007).
 *
 * `UpdateRequired` was a non-dismissible overlay over every screen, so an
 * operational mistake — a `minVersion` of "9.0.0" published by accident, or a
 * misused signing key — locked every install out of Backup, Reveal and Export
 * until a corrected file with a newer `issuedAt` was published and fetched.
 * The `issuedAt` anti-rollback means re-serving the previous file does not
 * undo it, and an offline device stays blocked. A non-custodial wallet must
 * never put the user's recovery phrase behind a remote switch.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { FlagsSchema } from '@boltvault/core'
import { describe, expect, it } from 'vitest'
import { ApprovalStore } from '../src/approvals'
import { EventBus } from '../src/host'

describe('a build the signed flags call too old', () => {
  const boot = (stale: boolean) =>
    new ApprovalStore(
      createMemoryPlatform({ now: 1_700_000_000_000 }),
      new EventBus(),
      undefined,
      () => stale,
    )

  const request = {
    kind: 'send_transaction' as const,
    origin: 'https://app.example.com',
    accountId: 'acct-1',
    chainId: 52014,
    payload: { kind: 'send_transaction' },
  }

  it('will not sign', async () => {
    const store = boot(true)
    const req = await store.create(request)
    await expect(store.decide({ id: req.id, approve: true })).rejects.toMatchObject({
      code: 'invalid_argument',
    })
  })

  it('still lets the user refuse, so the queue does not become its own lock-out', async () => {
    const store = boot(true)
    const req = await store.create(request)
    expect((await store.decide({ id: req.id, approve: false })).status).toBe('rejected')
  })

  it('signs as usual when the flags are content with this build', async () => {
    const store = boot(false)
    const req = await store.create(request)
    expect((await store.decide({ id: req.id, approve: true })).status).toBe('signing')
  })
})

describe('the minimum version a flags file may name', () => {
  const flags = (minVersion: unknown): unknown => ({
    v: 1,
    issuedAt: 1,
    minVersion,
    disabled: {},
    notice: null,
  })

  it('is a semver string and a short one (ES-BV-007)', () => {
    expect(FlagsSchema.safeParse(flags({ extension: '1.2.3' })).success).toBe(true)
    expect(FlagsSchema.safeParse(flags({ extension: '1.2.3-rc.1' })).success).toBe(true)
    // It is rendered on the blocking plate, and compared against a version.
    expect(FlagsSchema.safeParse(flags({ extension: 'x'.repeat(200) })).success).toBe(false)
    expect(FlagsSchema.safeParse(flags({ extension: 'not a version' })).success).toBe(false)
    expect(FlagsSchema.safeParse(flags({ extension: '9' })).success).toBe(false)
  })
})
