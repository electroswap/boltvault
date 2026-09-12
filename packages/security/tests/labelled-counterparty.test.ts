/**
 * A counterparty's name in the sheet's own sentences (§8.1, §3.6).
 *
 * `who()` has always read `ctx.labels` first, and nothing ever put a person's
 * name in there — only token symbols — so every statement about somebody named
 * `bolt.etn` said the short hex instead. The engine fills the map from the
 * reverse resolver now, which makes two things worth pinning here:
 *
 *  - a label reaches the sentence, so the plumbing has somewhere to arrive;
 *  - the label is still bounded on the way out. `untrusted` is the only thing
 *    between a resolver's answer and a line of the sheet, and a name is the one
 *    string on that sheet a stranger writes.
 *
 * The address block under the statements is untouched by any of this: §3.6
 * shows the whole forty characters to check against, and a name is never
 * allowed to stand in for that.
 */
import { encodeFunctionData, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { ERC20_ABI } from '../src/abis'
import { assess, emptyContext } from '../src/assess'
import { untrusted } from '../src/explain'
import type { SignRequest } from '../src/types'

const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const THEM = '0x2222222222222222222222222222222222222222' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex

const transfer = (): SignRequest => ({
  kind: 'transaction',
  tx: { from: ME, to: TOKEN, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [THEM, 10n ** 18n] }), value: 0n, chainId: 52014 },
})

const run = (labels: Record<string, string>) =>
  assess({
    origin: 'internal:send',
    chainId: 52014,
    account: ME,
    request: transfer(),
    context: emptyContext({ tokens: { [TOKEN.toLowerCase()]: { symbol: 'FIX', decimals: 18 } }, labels }),
  })

describe('a named counterparty', () => {
  it('is named in the statement instead of shortened', () => {
    // Six and six, checksummed (ES-BV-033): four-and-four is the shape a
    // poisoning generator grinds for in minutes.
    expect(run({}).statements[0]?.text).toBe('Send 1 FIX to 0x222222…222222')
    expect(run({ [THEM.toLowerCase()]: 'bolt.etn' }).statements[0]?.text).toBe('Send 1 FIX to bolt.etn')
  })

  it('is bounded on the way out, however long it arrived', () => {
    const long = 'a'.repeat(200)
    const text = run({ [THEM.toLowerCase()]: long }).statements[0]?.text ?? ''
    expect(text).toBe(`Send 1 FIX to ${untrusted(long)}`)
    expect(text.length).toBeLessThan(60)
  })
})
