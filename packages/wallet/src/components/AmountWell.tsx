/**
 * AmountWell — the one amount field (Send, Swap, Bridge): a label row with an
 * optional control at its right, the amount big and bare beside the token
 * pill, then what it is worth on the left and what you hold on the right
 * with a MAX key. A read-only well shows the amount as a readout instead of
 * a field (Bridge's receive side). Swap's receive well is an input too —
 * typing there is exact-output — and `disabled` is for the cases that input
 * cannot honour (fee-on-transfer). Every screen that takes an amount uses
 * it, so the eye learns the shape once.
 */
import { Body, Column, Icon, Input, MaxKey, Plate, Row, paint, type IconName } from '@boltvault/ui'
import { useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n'

export interface AmountWellProps {
  readonly label: string
  readonly value: string
  readonly onChange?: (value: string) => void
  readonly readOnly?: boolean
  /**
   * The field stays an input so the well still looks like a well, but nothing
   * can be typed. Swap uses this when a fee-on-transfer token cannot honour
   * an exact output — the web interface disables the same panel.
   */
  readonly disabled?: boolean
  /** The token pill (or a chain select) at the amount's right. */
  readonly tokenPill?: ReactNode
  /** A control at the label row's right (a chain select, a percentage). */
  readonly right?: ReactNode
  /** What the amount is worth, e.g. "$0.00". */
  readonly fiat?: string | null
  /** What you hold, e.g. "1,248 USDC" — or, with `balanceIcon="clock"`, when it lands. */
  readonly balance?: string | null
  readonly balanceIcon?: IconName
  readonly onMax?: () => void
  readonly error?: string | null
  /** The token's decimal places, so the field cannot take digits it must round away. */
  readonly decimals?: number
  /**
   * An override for the well's hairline, two pixels wide.
   *
   * The interface marks a swap whose pair has locked liquidity by turning both
   * terminals' borders green (`SwapSection` takes `theme.success` in place of
   * `theme.surface3`, and keeps it through hover and focus). Owner: "I like the
   * lock UI treatment that the UI applies." This is that seam — the caller says
   * which colour, the well stays generic, and Send and Bridge are untouched.
   *
   * It draws at the well's usual 1 px.
   *
   * It was 2 — "make the green border another pixel thicker when there's
   * locked liquidity" — back when the colour was the surge green at 55% alpha
   * and needed the extra weight to register at all. Now that it is the flat
   * colour the interface uses, the same two pixels read as heavy: owner, "with
   * the brighter green border now the border around the input/output is too
   * thick, reduce by 1px." One pixel also puts the terminals on exactly the
   * border the details card carries, which is why the three stopped looking
   * like the same box.
   */
  readonly accent?: `#${string}` | `rgba(${string})` | null
  /**
   * The amount one step louder, and the well a little taller to carry it.
   *
   * The swap console is the one well that stands beside the web interface —
   * the owner reads the two on the same phone — and the interface sets its
   * amount at 36 px, stepping to 28 only below its `sm` breakpoint. Measured
   * off the owner's two screenshots our 28 px readout came out a tenth shorter
   * than the page's, which is the difference they were pointing at. Extra
   * vertical air on this size keeps the token picker in the middle of the
   * well and MAX on the bottom row. Send and Bridge stay exactly as they were.
   */
  readonly louder?: boolean
  readonly autoFocus?: boolean
  readonly testID?: string
  readonly inputTestID?: string
  readonly maxTestID?: string
  readonly balanceTestID?: string
}

export function AmountWell({ label, value, onChange, readOnly = false, disabled = false, tokenPill, right, fiat, balance, balanceIcon = 'wallet', onMax, error, decimals, accent, louder = false, autoFocus, testID, inputTestID, maxTestID, balanceTestID }: AmountWellProps) {
  const empty = !value || value === '0' || value === '—'
  const typed = useRef(false)
  const prevValue = useRef(value)
  const [pinStart, setPinStart] = useState(0)
  /*
    Pin on any fill that did not come from this well's own keystrokes.

    MAX used to be the only bump, which hid the same bug on Swap's other
    terminal: typing an exact-in amount paints a long decimal into "You
    receive" (and exact-out into "You pay"), the field parks its caret at
    the end, and the units scroll off the leading edge. The numbers before
    the point stay in view when we pin both wells the same way.
  */
  if (value !== prevValue.current) {
    const wasTyped = typed.current
    typed.current = false
    prevValue.current = value
    if (!wasTyped) setPinStart((n) => n + 1)
  }
  const fillMax = onMax
    ? () => {
        setPinStart((n) => n + 1)
        onMax()
      }
    : undefined
  const handleChange = onChange
    ? (next: string) => {
        typed.current = true
        onChange(next)
      }
    : undefined
  return (
    <Plate role="well" gap={louder ? 4 : 2} paddingVertical={louder ? 16 : 8} paddingHorizontal={12} {...(accent ? { borderColor: accent } : {})} testID={testID}>
      <Row justifyContent="space-between" alignItems="center" minHeight={right ? 32 : 18}>
        <Body tone="mute" size="caption">
          {label}
        </Body>
        {right ?? null}
      </Row>
      <Row gap="$2" alignItems="center" minHeight={louder ? 52 : 40} flex={louder ? 1 : undefined}>
        <Column flex={1} minWidth={0}>
          {readOnly || !handleChange ? (
            <Body fontFamily="$readout" fontSize={louder ? 32 : 28} lineHeight={louder ? 38 : 34} fontWeight="600" letterSpacing={louder ? -1.0 : -0.85} numberOfLines={1} color={empty ? '$mute' : '$ink'} testID={inputTestID}>
              {value || '0'}
            </Body>
          ) : (
            <Input value={value} onChange={handleChange} placeholder="0" bare big {...(louder ? { louder: true } : {})} numeric {...(decimals !== undefined ? { maxDecimals: decimals } : {})} autoFocus={autoFocus} pinStart={pinStart} disabled={disabled} testID={inputTestID} />
          )}
        </Column>
        {tokenPill ?? null}
      </Row>
      <Row justifyContent="space-between" alignItems="center" minHeight={22} gap="$2">
        <Body tone="mute" size="caption" numberOfLines={1} flexShrink={1}>
          {fiat ?? ''}
        </Body>
        <Row gap={6} alignItems="center" flexShrink={0}>
          {balance ? (
            <Row gap={4} alignItems="center" testID={balanceTestID}>
              <Icon name={balanceIcon} size={12} color={paint.mute} />
              <Body tone="mute" size="caption" numberOfLines={1}>
                {balance}
              </Body>
            </Row>
          ) : null}
          {fillMax ? <MaxKey label={t({ id: 'max.caps', message: 'MAX' })} onPress={fillMax} testID={maxTestID} /> : null}
        </Row>
      </Row>
      {error ? (
        <Body tone="burn" size="caption" testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Body>
      ) : null}
    </Plate>
  )
}
