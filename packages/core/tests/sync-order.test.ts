/**
 * Sync conflict resolution (master plan §6): "last-writer-wins per key using
 * per-device sequence numbers (no vector clocks); deletes are tombstones."
 *
 * The property that matters is convergence: two devices that see the same set
 * of records must pick the same winner, whatever order the records arrive in
 * and whatever their clocks say.
 */
import { describe, expect, it } from 'vitest'
import { isTombstone, nextSeq, recordWins, type RecordStamp, type SyncRecord } from '../src/pairing.js'

const stamp = (seq: number, authorDeviceId: string): RecordStamp => ({ seq, authorDeviceId })

describe('last-writer-wins by per-device sequence number', () => {
  it('takes the first record for a key it has never seen', () => {
    expect(recordWins(stamp(1, 'a'), null)).toBe(true)
  })

  it('prefers the higher sequence number', () => {
    expect(recordWins(stamp(9, 'a'), stamp(8, 'b'))).toBe(true)
    expect(recordWins(stamp(7, 'a'), stamp(8, 'b'))).toBe(false)
  })

  it('never re-applies a record it has already applied', () => {
    expect(recordWins(stamp(4, 'a'), stamp(4, 'a'))).toBe(false)
  })

  it('breaks a tie the same way on both devices, so they converge', () => {
    // Concurrent edits, same counter. Whichever side evaluates it, 'b' wins.
    expect(recordWins(stamp(5, 'b'), stamp(5, 'a'))).toBe(true)
    expect(recordWins(stamp(5, 'a'), stamp(5, 'b'))).toBe(false)
  })

  it('reaches the same answer whatever order the records arrive in', () => {
    const records = [stamp(3, 'a'), stamp(7, 'b'), stamp(7, 'a'), stamp(2, 'c')]
    const settle = (order: RecordStamp[]): RecordStamp | null => {
      let current: RecordStamp | null = null
      for (const r of order) if (recordWins(r, current)) current = r
      return current
    }
    const forwards = settle(records)
    const backwards = settle([...records].reverse())
    const shuffled = settle([records[2]!, records[0]!, records[3]!, records[1]!])
    expect(forwards).toEqual(backwards)
    expect(forwards).toEqual(shuffled)
    expect(forwards).toEqual(stamp(7, 'b'))
  })

  /*
    The old rule compared the author's wall clock. A device whose clock was an
    hour fast won every merge until the other device caught up in real time, and
    a clock that stepped backwards made a device unable to overwrite its own
    earlier record at all.
  */
  it('does not care what the clocks say', () => {
    const slowButLater = stamp(10, 'a')
    const fastButEarlier = stamp(9, 'b')
    expect(recordWins(slowButLater, fastButEarlier)).toBe(true)
  })
})

describe('the sequence counter', () => {
  it('steps past anything the device has already seen', () => {
    expect(nextSeq(4, 9)).toBe(10)
    expect(nextSeq(9, 4)).toBe(10)
    expect(nextSeq(0, 0)).toBe(1)
  })

  it('keeps two devices comparable as they take turns', () => {
    let a = 0
    let b = 0
    // A writes, B sees it and writes, A sees that and writes again.
    a = nextSeq(a, 0)
    b = nextSeq(b, a)
    a = nextSeq(a, b)
    expect(b).toBeGreaterThan(1)
    expect(a).toBeGreaterThan(b)
  })
})

describe('tombstones', () => {
  const rec = (value: unknown): SyncRecord => ({ collection: 'addressBook', key: '0xabc', value, seq: 1, authorDeviceId: 'a', authorLabel: 'Laptop', at: 0 })

  it('tells "deleted" apart from "never had it" and from a falsy value', () => {
    expect(isTombstone(rec(null))).toBe(true)
    expect(isTombstone(rec({ label: 'Mum' }))).toBe(false)
    // A delete is the only null. These are values, and must survive the round trip.
    expect(isTombstone(rec(0))).toBe(false)
    expect(isTombstone(rec(''))).toBe(false)
    expect(isTombstone(rec(false))).toBe(false)
  })

  it('is ordered like any other record, so a delete can be undone by a later write', () => {
    const deleted = stamp(5, 'a')
    const rewritten = stamp(6, 'b')
    expect(recordWins(rewritten, deleted)).toBe(true)
    expect(recordWins(deleted, rewritten)).toBe(false)
  })
})
