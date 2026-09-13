/**
 * A masked field stays masked on Android (ES-BV-071).
 *
 * `Input` asked every `sensitive` single-line field for Android's
 * `visible-password` keyboard, on the stated premise that it meant "a secret,
 * do not predict it". It does not: it is `TYPE_TEXT_VARIATION_VISIBLE_PASSWORD`,
 * "a password, shown in clear", and React Native's own manager notes that it
 * "will supersede secureTextEntry". Since every password field in the wallet
 * passes both `secure` and `sensitive`, all of them rendered the password in
 * plain glyphs on a phone — fourteen fields, including onboarding, unlock and
 * every reveal and export gate. The only two that escaped did so by accident,
 * because they had never been marked `sensitive`.
 *
 * Nothing in CI runs the Android text input, so this is the only place the rule
 * can be held. Keep it.
 */
import { describe, expect, it } from 'vitest'
import { sensitiveKeyboardType } from '../src/inputRules'

describe('sensitiveKeyboardType', () => {
  it('never asks for the visible keyboard on a masked field', () => {
    // The regression itself: every password field in the wallet is this shape.
    expect(sensitiveKeyboardType({ sensitive: true, secure: true })).toBeUndefined()
    expect(sensitiveKeyboardType({ sensitive: 'code', secure: true })).toBeUndefined()
  })

  it('still asks for it where the text is meant to be read while typing', () => {
    // Quiz answers and export codes are shown on purpose; the flag keeps the
    // keyboard from learning them.
    expect(sensitiveKeyboardType({ sensitive: true })).toBe('visible-password')
    expect(sensitiveKeyboardType({ sensitive: 'code' })).toBe('visible-password')
    expect(sensitiveKeyboardType({ sensitive: true, secure: false })).toBe('visible-password')
  })

  it('leaves a multiline phrase box alone, where it would fight the return key', () => {
    expect(sensitiveKeyboardType({ sensitive: true, multiline: true })).toBeUndefined()
  })

  it('says nothing about a field that is not sensitive at all', () => {
    expect(sensitiveKeyboardType({})).toBeUndefined()
    expect(sensitiveKeyboardType({ secure: true })).toBeUndefined()
    expect(sensitiveKeyboardType({ sensitive: false, secure: true })).toBeUndefined()
  })
})
