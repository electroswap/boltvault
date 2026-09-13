/**
 * Onboarding's decisions, pinned.
 *
 * Each case here is a defect the flow shipped with: a password of twelve
 * identical characters passing, a 13-word phrase passing the button and failing
 * in the engine, a raw engine string on screen, a URL naming a step that needs
 * state it cannot have, and a progress bar that counted the same number of
 * steps whichever path you took.
 */
import { describe, expect, it } from 'vitest'
import { clampEntryStep, engineErrorCopy, mnemonicHint, mnemonicLengthOk, passwordStrength, progressFor } from '../src/screens/onboarding/rules'

describe('passwordStrength', () => {
  it('refuses anything under twelve characters', () => {
    expect(passwordStrength('short').score).toBe(0)
    expect(passwordStrength('elevenchars').score).toBe(0)
  })

  it('refuses twelve characters that are barely any characters', () => {
    // The hole: length alone scored these as usable.
    expect(passwordStrength('aaaaaaaaaaaa').score).toBe(0)
    expect(passwordStrength('abababababab').score).toBe(0)
    expect(passwordStrength('aaaabbbbcccc').score).toBe(0)
  })

  it('accepts a plain twelve-character password once it is varied', () => {
    expect(passwordStrength('abcdefghijkl').score).toBe(1)
  })

  it('rates a long passphrase strongest', () => {
    expect(passwordStrength('correct horse battery staple').score).toBe(3)
    expect(passwordStrength('a'.repeat(19) + 'bcdef').score).toBe(3)
  })

  it('rates a mixed medium-length password in between', () => {
    expect(passwordStrength('Abcdef123!xyzw').score).toBe(2)
  })
})

describe('the recovery-phrase gate', () => {
  it('accepts only the lengths BIP-39 defines', () => {
    for (const n of [12, 15, 18, 21, 24]) expect(mnemonicLengthOk(Array(n).fill('abandon').join(' '))).toBe(true)
    // These used to pass the button and fail in the engine.
    for (const n of [11, 13, 16, 20, 23, 25]) expect(mnemonicLengthOk(Array(n).fill('abandon').join(' '))).toBe(false)
  })

  it('is unbothered by the whitespace a paste brings', () => {
    expect(mnemonicLengthOk(`  ${Array(12).fill('ABANDON').join('   ')}\n`)).toBe(true)
  })

  it('says nothing about an empty field, and counts otherwise', () => {
    expect(mnemonicHint('')).toBeNull()
    expect(mnemonicHint('abandon abandon')).toContain('2 words')
    expect(mnemonicHint(Array(12).fill('abandon').join(' '))).toBe('12 words')
  })
})

describe('engineErrorCopy', () => {
  it('turns the engine’s own wording into something actionable', () => {
    expect(engineErrorCopy(new Error('that is not a valid recovery phrase'))).toMatch(/spelling and the order/)
    expect(engineErrorCopy(new Error('a vault already exists'))).toMatch(/already has a vault/)
    expect(engineErrorCopy(new Error('prf-unsupported'))).toMatch(/PRF/)
  })

  it('still says what happened when it does not recognise the error', () => {
    expect(engineErrorCopy(new Error('the disk caught fire'))).toContain('the disk caught fire')
  })
})

describe('clampEntryStep', () => {
  it('allows steps that need nothing from a previous one', () => {
    for (const s of ['intro', 'welcome', 'password', 'import', 'watch']) expect(clampEntryStep(s)).toBe(s)
  })

  it('refuses steps that would render empty', () => {
    // `tab.html?screen=onboarding&p={"step":"words"}` must not show a blank grid.
    for (const s of ['words', 'quiz', 'preview', 'passkey', 'done', 'nonsense', undefined]) expect(clampEntryStep(s)).toBeNull()
  })
})

describe('progressFor', () => {
  it('counts each path by its own length', () => {
    expect(progressFor('create', 'words')).toEqual({ now: 1, max: 3 })
    expect(progressFor('create', 'password')).toEqual({ now: 3, max: 3 })
    /*
      Two steps now, not three. The address-preview step between the phrase and
      the password is gone: it showed six addresses from two derivation trees
      under "Which addresses do you recognise?", offered no way to answer, and
      nothing consumed an answer anyway — import has always taken BIP-44 index
      0. The tree choice moved to the accounts sheet, where picking one adds
      the account it names.
    */
    expect(progressFor('import', 'import')).toEqual({ now: 1, max: 2 })
    expect(progressFor('import', 'password')).toEqual({ now: 2, max: 2 })
    expect(progressFor('watch', 'watch')).toEqual({ now: 1, max: 2 })
    // The path ends on `password`: the "this is Electroneum" page that used to
    // close every one of them is gone, and a bar that filled on a screen whose
    // only control dismissed it was counting a step nobody takes.
    expect(progressFor('watch', 'password')).toEqual({ now: 2, max: 2 })
  })

  it('does not count the intro or the passkey offer', () => {
    expect(progressFor('create', 'intro')).toBeNull()
    // Skipped entirely on a device with neither factor, so counting it would make the bar jump.
    expect(progressFor('create', 'passkey')).toBeNull()
  })
})
