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
   * Bump this after a programmatic fill (MAX) to drop the caret at the start.
   *
   * A long decimal otherwise leaves the caret at the end, and the field
   * scrolls to show the last digits instead of the units. The numbers before
   * the point are the ones that matter; the user can move the caret when they
   * mean to edit.
   */
  readonly pinStart?: number
}

export const Input = forwardRef<TextInput, InputProps>(function Input({ value, onChange, label, placeholder, secure, multiline, bare, big, louder, numeric, error, hint, autoFocus, onSubmit, testID, autoCapitalize = 'none', disabled, sensitive, pinStart }, ref) {
  const [focused, setFocused] = useState(false)
  const inner = useRef<TextInput>(null)
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined)
  useLayoutEffect(() => {
    if (!pinStart) return
    setSelection({ start: 0, end: 0 })
    const node = inner.current
    if (!node) return
    node.setNativeProps?.({ selection: { start: 0, end: 0 } })
    if (Platform.OS === 'web') {
      const el = node as unknown as HTMLInputElement
      el.setSelectionRange?.(0, 0)
      el.scrollLeft = 0
    }
  }, [pinStart])
  const handleChange = (next: string): void => {
    setSelection(undefined)
    if (!numeric) {
      onChange(next)
      return
    }
    // Digits and at most one separator; a leading dot becomes "0.".
    const cleaned = next.replace(/[^0-9.,]/g, '').replace(/,/g, '.')
    const [head = '', ...rest] = cleaned.split('.')
    const joined = rest.length > 0 ? `${head}.${rest.join('')}` : head
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
        onFocus={() => setFocused(true)}
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
