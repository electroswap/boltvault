/**
 * Token details › Transactions, on the screen side (§8.3).
 *
 * The number helpers are imported and exercised directly. The screen's own
 * invariants are read as TEXT, for the reason `money-screens.test.ts` gives: a
 * screen pulls in the whole UI and these suites run in plain node, where
 * Reanimated cannot load. Each of them is a rule that a reasonable person
 * would "tidy" back into a bug, so the reason lives beside the assertion.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { agoParts, formatTradeValue } from '../src/format'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8')

describe('agoParts', () => {
  const now = 1_789_400_000_000
  const at = (secondsAgo: number): number => Math.floor(now / 1000) - secondsAgo

  it('rounds to whole units, so two shots moments apart read the same', () => {
    expect(agoParts(at(0), now)).toEqual({ unit: 'now', value: 0 })
    expect(agoParts(at(59), now)).toEqual({ unit: 'now', value: 0 })
    expect(agoParts(at(60), now)).toEqual({ unit: 'm', value: 1 })
    expect(agoParts(at(150), now)).toEqual({ unit: 'm', value: 2 })
    expect(agoParts(at(3_600), now)).toEqual({ unit: 'h', value: 1 })
    expect(agoParts(at(86_400), now)).toEqual({ unit: 'd', value: 1 })
    expect(agoParts(at(90_000), now)).toEqual({ unit: 'd', value: 1 })
  })

  it('never counts backwards from a clock that disagrees with the chain', () => {
    // An indexer a few seconds ahead of the device must not read "-3m ago".
    expect(agoParts(at(-30), now)).toEqual({ unit: 'now', value: 0 })
  })

  it('is a pure function of its arguments, so a baseline can pin it', () => {
    expect(agoParts(at(150), now)).toEqual(agoParts(at(150), now))
  })
})

describe('formatTradeValue', () => {
  it('keeps a small trade visible rather than rounding it to nothing', () => {
    // The whole point of a feed is the small trades as much as the large.
    expect(formatTradeValue(0.42)).not.toBe('$0')
    expect(formatTradeValue(0.42)).not.toBe('$0.00')
    expect(formatTradeValue(0.5522)).toContain('0.55')
  })

  it('reads a normal trade in plain dollars', () => {
    expect(formatTradeValue(14.197)).toBe('$14.20')
    expect(formatTradeValue(909.75)).toBe('$909.75')
  })

  it('compacts past ten thousand, where the digits stop carrying a decision', () => {
    expect(formatTradeValue(28_052.8)).toBe('$28.1K')
  })

  it('says so when there is no value, rather than inventing a zero', () => {
    expect(formatTradeValue(null)).toBe('—')
    expect(formatTradeValue(Number.NaN)).toBe('—')
  })
})

describe('the Token screen wires the tab lazily', () => {
  const src = read('screens/Token.tsx')

  it('gates the transactions key on whether the tab was ever opened', () => {
    // This is the owner's "not fetched until the tab is clicked": `useCached`
    // does nothing at all while its key is null.
    expect(src).toContain("key: market && txOpened ? cacheKey('explore', 'tokentx', chainId, address) : null")
  })

  it('does NOT gate that key on the tab currently being shown', () => {
    /*
      The bug this prevents, and the reason the flag is separate from `tab`:
      a key that swings back to null on the way to Info resets the hook, and on
      the way back in it seeds `refreshing` and then short-circuits on
      `maxAgeMs` without clearing it — a loader sweeping forever over a list
      that is not loading. If someone "simplifies" these two into one, this
      fails and says why.
    */
    expect(src).not.toContain("tab === 'transactions' ? cacheKey('explore', 'tokentx'")
    expect(src).toContain('const [txOpened, setTxOpened] = useState')
    // One-way: nothing ever sets it back to false.
    expect(src).not.toContain('setTxOpened(false)')
  })

  it('opens on Info and puts the control directly under the chart', () => {
    expect(src).toContain("useState<TokenTab>(initialTab ?? 'info')")
    const chartEnds = src.indexOf('testID="token-price-block"')
    const tabs = src.indexOf('testID="token-tabs"')
    const balance = src.indexOf('testID="token-balance"')
    expect(chartEnds).toBeGreaterThan(-1)
    // Below the chart, and above everything the Info tab now owns.
    expect(tabs).toBeGreaterThan(chartEnds)
    expect(tabs).toBeLessThan(balance)
  })

  it('renders no tab control off Electroneum, where there is no indexer to ask', () => {
    expect(src).toContain('const showTransactions = market && tab === ')
  })
})

describe('the transactions panel', () => {
  const src = read('components/TokenTransactions.tsx')

  it('lets the text column shrink, or the value on the right eats the line', () => {
    // react-native-web's View is flexShrink: 0; the Activity rows carry the
    // same comment for the same reason.
    expect(src).toContain('<Column flex={1} minWidth={0}>')
  })

  it('holds the row above the 44 px hit target the screenshot suite asserts', () => {
    expect(src).toMatch(/minHeight=\{(4[4-9]|[5-9]\d)\}/)
  })

  it('drives its loader from freshness, not from the refreshing flag', () => {
    // `refreshing` can stick true after a cached read short-circuits; freshness
    // cannot. A sweep over a settled list is the bug that produces.
    expect(src).toContain("state.freshness === 'loading'")
    expect(src).not.toContain('active={state.refreshing}')
  })

  it('says it cannot fetch, and offers no on-chain fallback', () => {
    expect(src).toContain('We\u2019re not able to fetch that information right now.')
    expect(src).toContain("state.freshness === 'error'")
  })

  it('tells an empty feed apart from one that has not arrived', () => {
    // Gated on a value being present, so a pending list never reads as empty.
    expect(src).toContain('view && rows.length === 0')
  })

  it('shows the .etn name when the API supplied one, and the address otherwise', () => {
    expect(src).toContain('row.accountName ?? shortAddress(row.account)')
  })
})
