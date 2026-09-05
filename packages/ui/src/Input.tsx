/**
 * Input — a text field in a well (darker than its plate). Secure entry for
 * passwords, multiline for recovery phrases, `mono` for addresses, `bare`
 * and `big` for the amount inside a swap terminal (no well of its own,
 * numerals in the readout face).
 */
import { forwardRef, useState } from 'react'
import { TextInput, type TextInputProps } from 'react-native'
import { Body, Column } from './primitives'
import { edge, edgeStrong, fonts, metrics, paint, radius } from './tokens'

export interface InputProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label?: string
  readonly placeholder?: string
  readonly secure?: boolean
  readonly multiline?: boolean
  readonly mono?: boolean
  /** No well and no border: the field sits inside a terminal that is already a well. */
  readonly bare?: boolean
  /** Readout numerals (Oxanium 28) for amounts. */
  readonly big?: boolean
  readonly error?: string | null
  readonly hint?: string | null
  readonly autoFocus?: boolean
  readonly onSubmit?: () => void
  readonly testID?: string
  readonly autoCapitalize?: TextInputProps['autoCapitalize']
  readonly disabled?: boolean
}

export const Input = forwardRef<TextInput, InputProps>(function Input({ value, onChange, label, placeholder, secure, multiline, mono, bare, big, error, hint, autoFocus, onSubmit, testID, autoCapitalize = 'none', disabled }, ref) {
  const [focused, setFocused] = useState(false)
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
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={paint.mute}
        secureTextEntry={secure}
        multiline={multiline}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
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
          borderColor: error ? paint.burn : focused ? edgeStrong : edge,
          backgroundColor: bare ? 'transparent' : paint.well,
          color: paint.ink,
          fontFamily: big ? fonts.readout : mono ? fonts.mono : fonts.text,
          fontWeight: big ? '600' : '400',
          fontSize: big ? 28 : 15,
          letterSpacing: big ? -0.85 : 0,
          lineHeight: multiline ? 22 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
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
