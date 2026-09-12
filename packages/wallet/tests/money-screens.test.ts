/**
 * Two owner-reported defects that only a screen's own source can pin.
 *
 * Read as text rather than imported, for the reason `moments.test.ts` gives:
 * a screen pulls in the whole UI and these suites run in plain node where
 * Reanimated cannot load. A pixel baseline would catch neither of these —
 * the first because a missing line looks like a layout choice, the second
 * because "1 token" is a perfectly plausible string.
 *
 *  1. Swap never said which account was spending. Send and Bridge both name it
 *     under the title (the milestone log, craft pass 2026-09-06); Swap stated
 *     its chain and stopped. What is pinned is that all three use the SAME
 *     descriptor and the same caption treatment, so the next person to touch one
 *     of them cannot invent a second way of saying it.
 *  2. A wallet holding nothing read "1 token". The count is of rows, and an
 *     unfunded wallet still carries a row per token with zero in it. What is
 *     pinned is that the count is gated on the screen's ONE emptiness
 *     computation — the same `unfunded` that drives the funding item in the
 *     rotor — and not on a second test that can drift from it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8')

const SEND = read('screens/Send.tsx')
const SWAP = read('screens/Swap.tsx')
const BRIDGE = read('screens/Bridge.tsx')
const HOME = read('screens/Home.tsx')
const ACTIVITY = read('screens/Activity.tsx')
const ACCOUNT_ROW = read('components/accounts/AccountRow.tsx')

describe('the account under the title', () => {
  for (const [screen, source] of [
    ['Send', SEND],
    ['Swap', SWAP],
    ['Bridge', BRIDGE],
  ] as const) {
    it(`${screen} names the account with the shared descriptor`, () => {
      expect(source).toContain("id: 'from.account'")
      expect(source).toContain("message: 'from {a}'")
      // The label, then the name or the shortened address — one expression, three screens.
      expect(source).toContain('${active.label} · ${accountName ?? shortAddress(active.address)}')
    })
  }

  it('Swap says it at caption scale, under the title and above the chain', () => {
    const title = SWAP.indexOf("id: 'swap.title'")
    const account = SWAP.indexOf("id: 'from.account'")
    const chain = SWAP.indexOf('<ChainCaption')
    expect(title).toBeGreaterThan(-1)
    expect(account).toBeGreaterThan(title)
    expect(chain).toBeGreaterThan(account)
    expect(SWAP).toContain('<Body tone="mute" size="caption" numberOfLines={1} testID="swap-account">')
  })
})

describe('an unfunded wallet counts nothing', () => {
  it('computes emptiness once and gates the token count on it', () => {
    const computations = HOME.match(/const unfunded =/g) ?? []
    expect(computations).toHaveLength(1)
    expect(HOME).toContain('{portfolio.snapshot && !unfunded ? (')
  })

  it('still shows the count for a wallet that holds something', () => {
    // The gate is the emptiness test and nothing else: a snapshot with a
    // balance in it keeps every word it had.
    expect(HOME).toContain("id: 'home.tokens.one'")
    expect(HOME).toContain("id: 'home.tokens.many'")
  })
})

describe('a name where an address would go', () => {
  it('the seat is given a name to prefer over the label', () => {
    expect(HOME).toContain('const seatName = useName(active?.address)')
    expect(HOME).toContain('name={seatName}')
  })

  it('every slot that shows one falls back to the shortened address', () => {
    expect(ACCOUNT_ROW).toContain('name ?? shortAddress(account.address)')
    expect(ACTIVITY).toContain('toName ?? shortAddress(counterparty)')
  })

  it('Activity asks for the open row only, never for the whole list', () => {
    expect(ACTIVITY).toMatch(/const toName = useName\(/)
    expect(ACTIVITY).not.toMatch(/useNames\(\s*entries/)
  })

  /*
    ATT-BV-026. A row's `to` is what the transaction was addressed to, which
    for an ERC-20 send is the token contract — so the detail sheet printed the
    token under "To" and then resolved a reverse name for it. A scam token that
    sets its own reverse record to `usdc.etn` had the wallet print
    "To: usdc.etn" after every transfer of it: a contract identity rendered as
    a person's name, which §3.6 and §8.1 both say the wallet does not do.
  */
  it('Activity names the counterparty, never the contract the call went to', () => {
    // The recipient comes out of the calldata, the way the firewall reads it.
    expect(ACTIVITY).toContain("recipientOf({ to: open.to, data: open.data ?? '0x' })")
    // …and a contract that is itself the target is never handed to the resolver.
    expect(ACTIVITY).toMatch(/useName\(isContractItself \? undefined :/)
  })
})
