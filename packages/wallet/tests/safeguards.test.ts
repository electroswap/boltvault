/**
 * The two spend-policy safeguards Settings › Spending names (master plan §3.4
 * point 6, §3.6).
 *
 * Both were claimed and neither happened: the first-time rule arrives at `info`
 * severity, which is no delay and is filtered out of the signing sheet
 * entirely, and the large-send rule arrives at `warn`, which is 1.5 s of a
 * greyed button and no re-authentication. What is pinned here is that the
 * sheet's decision comes from the rule CODE and not from the severity, so
 * re-tuning severities in the firewall cannot quietly remove either one again.
 */
import { describe, expect, it } from 'vitest'
import { COOLING_MS, needsCooling, needsStepUp, recipientOf } from '../src/state/safeguards'

const TO = '0x1111111111111111111111111111111111111111'
const TOKEN = '0x2222222222222222222222222222222222222222'
const FROM = '0x3333333333333333333333333333333333333333'

describe('spend-policy safeguards', () => {
  it('cools for the ten seconds §3.6 asks for', () => {
    expect(COOLING_MS).toBe(10_000)
  })

  it('decides from the rule code, whatever severity carried it', () => {
    expect(needsCooling(['RECIPIENT_FIRST_TIME'])).toBe(true)
    expect(needsStepUp(['LARGE_SEND'])).toBe(true)
    expect(needsCooling(['RECIPIENT_IS_CONTRACT', 'LARGE_SEND'])).toBe(false)
    expect(needsStepUp(['RECIPIENT_FIRST_TIME'])).toBe(false)
    expect(needsCooling([])).toBe(false)
    expect(needsStepUp([])).toBe(false)
  })
})

describe('recipientOf', () => {
  it('reads a plain send from `to`', () => {
    expect(recipientOf({ to: TO, data: '0x' })).toBe(TO)
  })

  it('reads an ERC-20 transfer from its first argument, not the token contract', () => {
    // transfer(address,uint256) — `to` is the token, the recipient is arg 0.
    const data = `0xa9059cbb${'0'.repeat(24)}${TO.slice(2)}${'0'.repeat(63)}1`
    expect(recipientOf({ to: TOKEN, data })).toBe(TO.toLowerCase())
  })

  it('reads an ERC-20 transferFrom from its SECOND argument', () => {
    const data = `0x23b872dd${'0'.repeat(24)}${FROM.slice(2)}${'0'.repeat(24)}${TO.slice(2)}${'0'.repeat(63)}1`
    expect(recipientOf({ to: TOKEN, data })).toBe(TO.toLowerCase())
  })

  it('falls back to `to` for calldata it cannot read, rather than guessing', () => {
    expect(recipientOf({ to: TOKEN, data: '0xdeadbeef' })).toBe(TOKEN)
    // A truncated transfer is not a transfer this can read.
    expect(recipientOf({ to: TOKEN, data: '0xa9059cbb0000' })).toBe(TOKEN)
  })

  it('has nothing to show for a contract deployment', () => {
    expect(recipientOf({ to: null, data: '0x60806040' })).toBeNull()
  })
})
