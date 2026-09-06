/**
 * The reconnecting Port (plan A1): listeners outlive a Port, a dropped Port
 * is replaced with backoff, a post with no Port connects on the spot, and a
 * Port that throws on post is replaced once.
 */
import { describe, expect, it } from 'vitest'
import { reconnectingPortChannel, type PortLike } from '../src/port-channel'

class FakePort implements PortLike {
  readonly sent: unknown[] = []
  readonly messageListeners = new Set<(m: unknown) => void>()
  readonly disconnectListeners = new Set<() => void>()
  throwOnPost = false
  onMessage = { addListener: (cb: (m: unknown) => void) => void this.messageListeners.add(cb), removeListener: (cb: (m: unknown) => void) => void this.messageListeners.delete(cb) }
  onDisconnect = { addListener: (cb: () => void) => void this.disconnectListeners.add(cb), removeListener: (cb: () => void) => void this.disconnectListeners.delete(cb) }
  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error('Attempting to use a disconnected port object')
    this.sent.push(message)
  }
  disconnect(): void {
    for (const l of this.disconnectListeners) l()
  }
  receive(m: unknown): void {
    for (const l of this.messageListeners) l(m)
  }
}

function harness() {
  const ports: FakePort[] = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  let now = 1_000
  const channel = reconnectingPortChannel(
    () => {
      const p = new FakePort()
      ports.push(p)
      return p
    },
    { setTimeout: (fn, ms) => timers.push({ fn, ms }), now: () => now },
  )
  const fire = (): void => {
    const t = timers.shift()
    if (!t) throw new Error('no timer')
    now += t.ms
    t.fn()
  }
  return { channel, ports, timers, fire, tick: (ms: number) => void (now += ms) }
}

describe('reconnectingPortChannel', () => {
  it('connects lazily on the first post and fans messages out to listeners kept on the channel', () => {
    const h = harness()
    const got: unknown[] = []
    h.channel.onMessage((m) => got.push(m))
    expect(h.ports).toHaveLength(0)
    h.channel.post({ id: 1 })
    expect(h.ports).toHaveLength(1)
    expect(h.ports[0]?.sent).toEqual([{ id: 1 }])
    h.ports[0]?.receive({ id: 1, ok: true })
    expect(got).toEqual([{ id: 1, ok: true }])
  })

  it('a dropped Port tells disconnect listeners, reconnects with backoff, and the same listeners hear the new Port', () => {
    const h = harness()
    const got: unknown[] = []
    let drops = 0
    h.channel.onMessage((m) => got.push(m))
    h.channel.onDisconnect(() => {
      drops += 1
    })
    h.channel.post('a')
    h.ports[0]?.disconnect()
    expect(drops).toBe(1)
    expect(h.timers.map((t) => t.ms)).toEqual([50])
    h.fire()
    expect(h.ports).toHaveLength(2)
    h.ports[1]?.receive('from-new')
    expect(got).toEqual(['from-new'])
    // The old Port is inert once replaced.
    h.ports[0]?.receive('from-old')
    expect(got).toEqual(['from-new'])
  })

  it('a connect that keeps throwing climbs the backoff ladder, gives up after 30 s, and a later post reconnects on the spot', () => {
    const timers: Array<{ fn: () => void; ms: number }> = []
    const ports: FakePort[] = []
    let now = 0
    let ok = true
    const channel = reconnectingPortChannel(
      () => {
        if (!ok) throw new Error('no worker')
        const p = new FakePort()
        ports.push(p)
        return p
      },
      { setTimeout: (fn, ms) => timers.push({ fn, ms }), now: () => now },
    )
    channel.post('a')
    ok = false
    ports[0]?.disconnect()
    const delays: number[] = []
    while (timers.length && delays.length < 40) {
      const t = timers.shift()
      if (!t) break
      delays.push(t.ms)
      now += t.ms
      t.fn()
    }
    expect(delays.slice(0, 5)).toEqual([50, 200, 800, 2_000, 2_000])
    expect(now).toBeGreaterThan(30_000)
    expect(timers).toHaveLength(0)
    ok = true
    channel.post('b')
    expect(ports).toHaveLength(2)
    expect(ports[1]?.sent).toEqual(['b'])
  })

  it('a Port that throws on post is replaced once and the post retried', () => {
    const h = harness()
    h.channel.post('a')
    const dead = h.ports[0]
    if (!dead) throw new Error('no port')
    dead.throwOnPost = true
    h.channel.post('b')
    expect(h.ports).toHaveLength(2)
    expect(h.ports[1]?.sent).toEqual(['b'])
  })

  it('unsubscribing removes a listener from every future Port', () => {
    const h = harness()
    const got: unknown[] = []
    const off = h.channel.onMessage((m) => got.push(m))
    h.channel.post('a')
    off()
    h.ports[0]?.receive('m')
    h.ports[0]?.disconnect()
    h.fire()
    h.ports[1]?.receive('n')
    expect(got).toEqual([])
  })
})
