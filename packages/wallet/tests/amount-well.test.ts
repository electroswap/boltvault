/**
 * Amount wells pin the caret at the start on a programmatic fill, so the
 * digits before the decimal stay in view.
 *
 * MAX used to be the only bump. Swap's receive well is an input too now
 * (typing there is exact-out), so a quote painting a long decimal into the
 * other terminal parked an invisible caret at the end and scrolled the units
 * off the leading edge. What is pinned is that BOTH wells share the same
 * pin — any fill that did not come from that well's own keystrokes — and
 * that the field itself pins whenever it is numeric and not focused.
 *
 * Read as text rather than imported, for the reason `moments.test.ts` gives:
 * a well pulls in the whole UI and these suites run in plain node.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WELL = readFileSync(fileURLToPath(new URL('../src/components/AmountWell.tsx', import.meta.url)), 'utf8')
const INPUT = readFileSync(fileURLToPath(new URL('../../ui/src/Input.tsx', import.meta.url)), 'utf8')
const SWAP = readFileSync(fileURLToPath(new URL('../src/screens/Swap.tsx', import.meta.url)), 'utf8')

describe('amount wells pin the units', () => {
  it('bumps pinStart on a fill that was not typed, not only on MAX', () => {
    expect(WELL).toContain('const typed = useRef(false)')
    expect(WELL).toContain('if (!wasTyped) setPinStart((n) => n + 1)')
    expect(WELL).toContain('typed.current = true')
    // MAX is still a pin, including when the amount is already the max.
    expect(WELL).toContain('setPinStart((n) => n + 1)')
    expect(WELL).toContain('onMax()')
  })

  it('Swap paints both terminals through AmountWell inputs', () => {
    expect(SWAP).toContain('inputTestID="swap-amount-in"')
    expect(SWAP).toContain('inputTestID="swap-amount-out"')
    expect(SWAP).toContain('onChange={typePay}')
    expect(SWAP).toContain('onChange={typeReceive}')
    // A quote of the other side, not a readout — so the pin has a field to hold.
    expect(SWAP).toContain('tradeType === \'exactIn\' ? amount : priced')
    expect(SWAP).toContain('tradeType === \'exactOut\' ? amount : priced')
    // Quoted fills go through formatInputAmount, which cuts the fraction.
    expect(SWAP).toContain('formatInputAmount(quote.amountInRaw, quote.decimalsIn)')
    expect(SWAP).toContain('formatInputAmount(quote.receiveRaw, quote.decimalsOut)')
  })
})

describe('the amount field pins when it is not being typed', () => {
  it('pins unfocused numeric fields and an explicit pinStart bump', () => {
    expect(INPUT).toContain('function pinCaretToStart')
    expect(INPUT).toContain('el.scrollLeft = 0')
    expect(INPUT).toContain('el.setSelectionRange?.(0, 0)')
    expect(INPUT).toContain('const shouldPin = pinBumped || Boolean(numeric && !focused)')
    expect(INPUT).toContain('[pinStart, value, numeric, focused]')
  })
})
