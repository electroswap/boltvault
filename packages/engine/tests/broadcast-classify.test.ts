/**
 * What a broadcast error means, read from the error rather than from its
 * printed form (ES-BV-063).
 *
 * The classifier matched words against `message`, and the pinned RPC library
 * composes `message` from meta lines that include the endpoint URL and the
 * request body. The bundled default endpoint for Avalanche is on a host with
 * the word "network" in it, so on that chain every definitive rejection —
 * insufficient funds, intrinsic gas too low, an invalid sender — read as a
 * transport failure. The row then sat `pending` with a hash the node never
 * had, the nonce stayed reserved, and the next send waited behind a hole.
 *
 * The fix reads the library's own error names for "no answer came back", and
 * matches node phrases only against the fields that carry the node's words.
 */
import { HttpRequestError, RpcRequestError, TimeoutError } from 'viem'
import { describe, expect, it } from 'vitest'
import { broadcastReason, possiblySent } from '../src/namespaces/provider'

/** The bundled Avalanche endpoint, which is the whole reason this finding exists. */
const AVAX = 'https://api.avax.network/ext/bc/C/rpc'

/** What the library really throws when a node answers with a JSON-RPC error. */
const rpcAnswer = (message: string, url = AVAX): unknown =>
  new RpcRequestError({ body: { method: 'eth_sendRawTransaction' }, url, error: { code: -32000, message } })

describe('a node that answered', () => {
  it('is not a transport failure just because its URL contains the word network', () => {
    const err = rpcAnswer('insufficient funds for gas * price + value')
    // The composed message really does carry the endpoint; that is the trap.
    expect((err as Error).message).toContain('avax.network')
    expect(possiblySent(err)).toBe(false)
  })

  it('is still not one for the other definitive rejections', () => {
    expect(possiblySent(rpcAnswer('intrinsic gas too low'))).toBe(false)
    expect(possiblySent(rpcAnswer('invalid sender'))).toBe(false)
    expect(possiblySent(rpcAnswer('exceeds block gas limit'))).toBe(false)
  })

  it('is read as possibly sent when it says it has seen this transaction', () => {
    expect(possiblySent(rpcAnswer('already known'))).toBe(true)
    expect(possiblySent(rpcAnswer('nonce too low'))).toBe(true)
    expect(possiblySent(rpcAnswer('replacement transaction underpriced'))).toBe(true)
  })
})

describe('a request that never got an answer', () => {
  it('is possibly sent, by the library’s own name for it', () => {
    expect(possiblySent(new TimeoutError({ body: {}, url: AVAX }))).toBe(true)
    // An HTTP layer that produced no JSON-RPC body at all: the node may well
    // have taken the bytes and failed to reply.
    expect(possiblySent(new HttpRequestError({ url: AVAX, body: {}, status: 502 }))).toBe(true)
  })

  it('is possibly sent for a bare transport error the library never wrapped', () => {
    expect(possiblySent(new TypeError('fetch failed'))).toBe(true)
    expect(possiblySent(new Error('The operation was aborted.'))).toBe(true)
  })

  it('is not possibly sent for a plain error that merely mentions a URL', () => {
    // A word in a hostname is not a claim about delivery.
    expect(possiblySent(new Error('bad request to https://api.avax.network/ext/bc/C/rpc'))).toBe(false)
  })
})

describe('what the row is told', () => {
  it('records the node’s words, not the endpoint and the request body', () => {
    const reason = broadcastReason(rpcAnswer('insufficient funds for gas * price + value'))
    expect(reason).toBe('insufficient funds for gas * price + value')
    expect(reason).not.toContain('avax.network')
  })

  it('falls back to the first line of a plain error', () => {
    expect(broadcastReason(new Error('something broke\nand then some'))).toBe('something broke')
    expect(broadcastReason(null)).toBe('broadcast failed')
  })
})
