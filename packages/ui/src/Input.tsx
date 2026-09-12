/**
 * Input — a text field in a well (darker than its plate). Secure entry for
 * passwords, multiline for recovery phrases, `bare` and `big` for the
 * amount inside a swap terminal (no well of its own, numerals in the
 * readout face). Focus is a quiet arc edge — never the browser's outline.
 */
import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import {
  Platform,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputProps,
  type TextInputSelectionChangeEventData,
} from 'react-native'
import { Body, Column } from './primitives'
import { edge, fonts, metrics, paint, radius } from './tokens'

/** react-native-web draws the browser's focus ring unless told not to; the field's own border carries focus. */
const OUTLINE_OFF = { outlineWidth: 0, outlineStyle: 'none' } as unknown as Record<string, never>

export interface InputProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label?: string
  readonly placeholder?: string
  readonly secure?: boolean
  readonly multiline?: boolean
  /** No well and no border: the field sits inside a terminal that is already a well. */
  readonly bare?: boolean
  /** Readout numerals (Oxanium 28) for amounts. */
  readonly big?: boolean
  /**
   * The amount one step louder (Oxanium 32), for the swap console.
   *
   * The web interface sets its swap amount at 36 px and steps down to 28 on a
   * phone (`StyledNumericalInput`), against a body face; our readout face at
   * the same 28 measured a tenth shorter than the page beside it, which is the
   * gap the owner photographed. Only `big` fields have a size to choose.
   */
  readonly louder?: boolean
  /**
   * An amount field. Rejects anything that is not a number as it is typed —
   * owner: "Swap input is accepting non digit chars" — and asks the phone for
   * a decimal keypad. Kept as sanitising rather than a pattern check so a
   * paste of "1,234.5 ETN" becomes "1234.5" instead of being refused whole.
   */
  readonly numeric?: boolean
  readonly error?: string | null
  readonly hint?: string | null
  readonly autoFocus?: boolean
  readonly onSubmit?: () => void
  readonly testID?: string
  readonly autoCapitalize?: TextInputProps['autoCapitalize']
  readonly disabled?: boolean
  /**
   * A field holding something that must not be remembered by anything but the
   * person typing it: a recovery-phrase word, a passphrase, a quiz answer, an
   * export code, a password.
   *
   * `secureTextEntry` hides the glyphs and `autoCorrect`/`spellCheck` keep the
   * keyboard from learning — but none of them stops the OS from *offering the
   * field to an autofill service*, and that is a different pipe. On Android a
   * third-party autofill provider or keyboard is handed the field unless
   * `importantForAutofill` says otherwise; on iOS a password-shaped field
   * without a `textContentType` gets "Save password?" and the phrase lands in
   * the keychain of whatever offered. `oneTimeCode` is the deliberate choice
   * for quiz words and export codes: it is the one content type iOS will not
   * try to store or reuse.
   */
  readonly sensitive?: boolean | 'code'
  /**
   * With `numeric`, the most decimal places the value can carry (ES-BV-048).
   *
   * A token holds a fixed number of places, and typing past them used to be
   * accepted and then rounded — half up, so the amount signed could be larger
   * than the amount typed. The field simply stops accepting digits it cannot
   * represent, which is the same thing every exchange's amount box does.
   */
  readonly maxDecimals?: number
  /**
   * Bump this after a programmatic fill (MAX, a quote painting the other well)
   * to drop the caret at the start even while the field is focused.
   *
   * A long decimal otherwise leaves the caret at the end, and the field
   * scrolls to show the last digits instead of the units. The numbers before
   * the point are the ones that matter; the user can move the caret when they
   * mean to edit. Unfocused numeric fields pin on their own whenever the
   * value changes — see the layout effect below.
   */
  readonly pinStart?: number
}

function pinCaretToStart(node: TextInput | null): void {
  if (!node) return
  node.setNativeProps?.({ selection: { start: 0, end: 0 } })
  if (Platform.OS === 'web') {
    const el = node as unknown as HTMLInputElement
    el.setSelectionRange?.(0, 0)
    el.scrollLeft = 0
  }
}

export const Input = forwardRef<TextInput, InputProps>(function Input({ value, onChange, label, placeholder, secure, multiline, bare, big, louder, numeric, error, hint, autoFocus, onSubmit, testID, autoCapitalize = 'none', disabled, sensitive, maxDecimals, pinStart }, ref) {
  const [focused, setFocused] = useState(false)
  const inner = useRef<TextInput>(null)
  const prevPin = useRef(pinStart)
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined)
  useLayoutEffect(() => {
    const pinBumped = pinStart !== prevPin.current
    prevPin.current = pinStart
    /*
      Pin whenever the units would otherwise scroll off the leading edge.

      A quote painting the other swap well does not bump `pinStart` from a
      keypress — and often does not focus that well either — but the native
      field still parks an invisible caret at the end, so a long decimal
      hides everything before the point. Unfocused numeric fields therefore
      pin on every value change. `pinStart` is the same pin while focused
      (MAX, a quote that landed on the field you are looking at).
    */
    const shouldPin = pinBumped || Boolean(numeric && !focused)
    if (!shouldPin) return
    setSelection({ start: 0, end: 0 })
    pinCaretToStart(inner.current)
    if (Platform.OS !== 'web') return
    let innerId = 0
    const outerId = requestAnimationFrame(() => {
      pinCaretToStart(inner.current)
      innerId = requestAnimationFrame(() => pinCaretToStart(inner.current))
    })
    return () => {
      cancelAnimationFrame(outerId)
      cancelAnimationFrame(innerId)
    }
  }, [pinStart, value, numeric, focused])
  const handleChange = (next: string): void => {
    setSelection(undefined)
    if (!numeric) {
      onChange(next)
      return
    }
    // Digits and at most one separator; a leading dot becomes "0.".
    const cleaned = next.replace(/[^0-9.,]/g, '').replace(/,/g, '.')
    const [head = '', ...rest] = cleaned.split('.')
    const tail = rest.join('')
    // A token with no decimal places takes no separator at all.
    if (maxDecimals === 0) {
      onChange(head)
      return
    }
    const capped = maxDecimals === undefined ? tail : tail.slice(0, maxDecimals)
    const joined = rest.length > 0 ? `${head}.${capped}` : head
    onChange(joined === '.' ? '0.' : joined)
  }
  return (
    <Column gap="$1">
      {label ? (
        <Body tone="mute" size="caption">
          {label}
        </Body>
      ) : null}
      <TextInput
        ref={(node) => {
          inner.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        value={value}
        onChangeText={handleChange}
        selection={selection}
        onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
          const sel = e.nativeEvent.selection
          if (sel.start === 0 && sel.end === 0) return
          setSelection(undefined)
        }}
        placeholder={placeholder}
        placeholderTextColor={paint.mute}
        secureTextEntry={secure}
        multiline={multiline}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
        {...(numeric
          ? { inputMode: 'decimal' as const, keyboardType: 'decimal-pad' as const }
          : {})}
        autoCorrect={false}
        spellCheck={false}
        {...(sensitive
          ? ({
              autoComplete: 'off',
              // iOS: `none` for a phrase word, `oneTimeCode` for the codes —
              // the one type it will neither store nor offer back.
              textContentType: sensitive === 'code' ? 'oneTimeCode' : 'none',
              // Android: keep the field out of every autofill service.
              importantForAutofill: 'no',
              autoCorrect: false,
              /*
                A keyboard that does not learn. `visible-password` is Android's
                own "this is a secret, do not predict it" type; on a multiline
                phrase field it would also fight the return key, so it is only
                asked for on the single-line ones.
              */
              ...(multiline ? {} : { keyboardType: 'visible-password' as const }),
            } as Partial<TextInputProps>)
          : {})}
        editable={!disabled}
        onSubmitEditing={onSubmit}
        onFocus={() => {
          setFocused(true)
          // Let the tap place the caret; a controlled {0,0} from the unfocused
          // pin would otherwise insert at the start of a quoted amount.
          setSelection(undefined)
        }}
        onBlur={() => setFocused(false)}
        testID={testID}
        accessibilityLabel={label ?? placeholder}
        style={{
          minHeight: multiline ? 96 : big ? (louder ? 44 : 40) : metrics.hit + 4,
          paddingHorizontal: bare ? 0 : 14,
          paddingVertical: multiline ? 12 : 0,
          borderRadius: radius.well,
          borderWidth: bare ? 0 : 1,
          borderColor: error ? paint.burn : focused ? paint.arcEdge : edge,
          backgroundColor: bare ? 'transparent' : paint.well,
          color: paint.ink,
          fontFamily: big ? fonts.readout : fonts.text,
          fontWeight: big ? '600' : '400',
          fontSize: big ? (louder ? 32 : 28) : 15,
          letterSpacing: big ? (louder ? -1.0 : -0.85) : 0,
          lineHeight: multiline ? 22 : undefined,
          textAlign: 'left',
          textAlignVertical: multiline ? 'top' : 'center',
          ...(big ? { overflow: 'hidden' as const } : {}),
          ...OUTLINE_OFF,
        }}
      />
      {error ? (
        <Body tone="burn" size="caption" testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Body>
      ) : hint ? (
        <Body tone="mute" size="caption">
          {hint}
        </Body>
      ) : null}
    </Column>
  )
})
