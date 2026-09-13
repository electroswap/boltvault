/**
 * A revoke that worked, reported as a failure (ES-BV-085).
 *
 * A beta tester revoked a Permit2 allowance, was shown an error, and then found
 * the allowance gone and the transaction mined. Two separate faults produced
 * that, and both are pinned here.
 *
 * **The verdict was wrong.** The send threw
 * `rpc.electroneum.com: backing off for another 850s` — our own governor, not
 * the node. `possiblySent` matched none of it, so the row was written `failed`;
 * and `nodeKnows`, the guard that exists to stop precisely that, asked the
 * chain over the same governor, was refused three more times, and returned
 * "the node has never heard of it" when what it meant was "I could not ask".
 * A local cooldown is evidence about us, never about the transaction.
 *
 * **The message was the library's.** `lastError` is rendered verbatim on the
 * approval sheet, and it held the composed viem message: the endpoint URL, the
 * entire signed transaction as hex, a details line and a version string. The
 * tester was shown all four, and the one thing worth saying — that it might
 * still land — was not among them.
 */
import { describe, expect, it } from 'vitest'
import { possiblySent, sendFailureText } from '../src/namespaces/provider'

/** `RateLimited` as governor.ts throws it: our own refusal to make the call. */
function rateLimited(): Error {
  const e = new Error('rpc.electroneum.com: backing off for another 850s')
  e.name = 'RateLimited'
  return e
}

/**
 * What the tester was actually shown, in the shape the library builds it:
 * `message` composed with the endpoint and the signed bytes, `details` holding
 * the cause's own words.
 */
function viemWrapped(details: string): Error {
  const e = new Error(
    [
      'HTTP request failed.',
      '',
      'URL: https://rpc.electroneum.com/',
      'Request body: [{"method":"eth_sendRawTransaction","params":["0x02f8b382cb2e8201ec843b9aca00843b9aca0e82886494c20d0253"]}]',
      '',
      `Details: ${details}`,
      'Version: viem@2.56.3',
    ].join('\n'),
  )
  e.name = 'HttpRequestError'
  Object.assign(e, { details, shortMessage: 'HTTP request failed.' })
  return e
}

describe('a send that our own governor refused', () => {
  it('is possibly sent, not definitively refused', () => {
    expect(possiblySent(rateLimited())).toBe(true)
  })

  it('is possibly sent through the library wrapper too, which is how it actually arrives', () => {
    const wrapped = viemWrapped('rpc.electroneum.com: backing off for another 850s')
    Object.assign(wrapped, { cause: rateLimited() })
    expect(possiblySent(wrapped)).toBe(true)
  })

  it('tells the person it may still go through, and points at Activity', () => {
    const text = sendFailureText(rateLimited())
    expect(text).toMatch(/may still go through/i)
    expect(text).toMatch(/Activity/)
  })
})

describe('what the approval sheet is given to render', () => {
  const wrapped = viemWrapped('rpc.electroneum.com: backing off for another 850s')

  it('never carries the endpoint, the signed bytes or the library version', () => {
    const text = sendFailureText(wrapped)
    expect(text).not.toContain('https://rpc.electroneum.com')
    expect(text).not.toContain('Request body')
    expect(text).not.toContain('0x02f8b382cb2e')
    expect(text).not.toContain('viem@')
  })

  it('is one sentence, not a stack of meta lines', () => {
    expect(sendFailureText(wrapped)).not.toContain('\n')
  })

  /*
    The other half of the trade: when the node genuinely refuses, its own words
    are the most useful thing anyone can be told, so they survive.
  */
  it('keeps the node’s words when the node is the one refusing', () => {
    /*
      Named `RpcRequestError`, not `HttpRequestError`: a node that answers with
      a JSON-RPC error has been reached, and only the names in
      `TRANSPORT_FAILURES` mean the request never got an answer. Building this
      fixture the other way was my own mistake first, and it asserted that a
      definitive refusal is "possibly sent" — the opposite of the property.
    */
    const refused = new Error('insufficient funds for gas * price + value')
    refused.name = 'RpcRequestError'
    Object.assign(refused, {
      details: 'insufficient funds for gas * price + value',
      shortMessage: 'An internal error was received.',
    })
    expect(possiblySent(refused)).toBe(false)
    expect(sendFailureText(refused)).toContain('insufficient funds')
  })

  it('does not fall back to the composed message when there are no node words', () => {
    const bare = new Error(
      'HTTP request failed.\n\nURL: https://rpc.electroneum.com/\nRequest body: [{"x":1}]\nVersion: viem@2.56.3',
    )
    const text = sendFailureText(bare)
    expect(text).not.toContain('Request body')
    expect(text).not.toContain('viem@')
  })
})
