/**
 * Input — a text field on a recessed plate. Secure entry for passwords,
 * multiline for recovery phrases, `mono` for addresses.
 */
import { forwardRef } from 'react'
import { TextInput, type TextInputProps } from 'react-native'
import { Body, Column } from './primitives'
import { edge, fonts, metrics, paint } from './tokens'

export interface InputProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label?: string
  readonly placeholder?: string
  readonly secure?: boolean
  readonly multiline?: boolean
  readonly mono?: boolean
  readonly error?: string | null
  readonly hint?: string | null
  readonly autoFocus?: boolean
  readonly onSubmit?: () => void
  readonly testID?: string
  readonly autoCapitalize?: TextInputProps['autoCapitalize']
  readonly disabled?: boolean
}

export const Input = forwardRef<TextInput, InputProps>(function Input({ value, onChange, label, placeholder, secure, multiline, mono, error, hint, autoFocus, onSubmit, testID, autoCapitalize = 'none', disabled }, ref) {
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
        testID={testID}
        accessibilityLabel={label ?? placeholder}
        style={{
          minHeight: multiline ? 96 : metrics.hit + 4,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 0,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: error ? paint.burn : edge,
          backgroundColor: paint.glassSolid,
          color: paint.ink,
          fontFamily: mono ? fonts.mono : fonts.text,
          fontSize: 15,
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
