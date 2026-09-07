/**
 * Input — a text field in a well (darker than its plate). Secure entry for
 * passwords, multiline for recovery phrases, `bare` and `big` for the
 * amount inside a swap terminal (no well of its own, numerals in the
 * readout face). Focus is a quiet arc edge — never the browser's outline.
 */
import { forwardRef, useState } from 'react'
import { TextInput, type TextInputProps } from 'react-native'
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
}

export const Input = forwardRef<TextInput, InputProps>(function Input({ value, onChange, label, placeholder, secure, multiline, bare, big, numeric, error, hint, autoFocus, onSubmit, testID, autoCapitalize = 'none', disabled }, ref) {
  const [focused, setFocused] = useState(false)
  const handleChange = (next: string): void => {
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
        ref={ref}
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={paint.mute}
        secureTextEntry={secure}
        multiline={multiline}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
        {...(numeric ? { inputMode: 'decimal' as const, keyboardType: 'decimal-pad' as const } : {})}
        autoCorrect={false}
        spellCheck={false}
        editable={!disabled}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        testID={testID}
        accessibilityLabel={label ?? placeholder}
        style={{
          minHeight: multiline ? 96 : big ? 40 : metrics.hit + 4,
          paddingHorizontal: bare ? 0 : 14,
          paddingVertical: multiline ? 12 : 0,
          borderRadius: radius.well,
          borderWidth: bare ? 0 : 1,
          borderColor: error ? paint.burn : focused ? paint.arcEdge : edge,
          backgroundColor: bare ? 'transparent' : paint.well,
          color: paint.ink,
          fontFamily: big ? fonts.readout : fonts.text,
          fontWeight: big ? '600' : '400',
          fontSize: big ? 28 : 15,
          letterSpacing: big ? -0.85 : 0,
          lineHeight: multiline ? 22 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
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
