import { describe, expect, it } from 'vitest'
import { COLOR, FONT, METRIC, TOKENS, COLOR_NAMES, type ColorName } from '../src/tokens'
import { secretStoreDecision, wrapStrategy, type MobilePlatform } from '../src/secret-store'
import {
  CANONICAL_ONBOARDING,
  buildFlow,
  isParitySuperset,
  OPTIONAL_STEPS,
  type OnboardingStep,
} from '../src/onboarding'

describe('design tokens (T8.1 — the face contract)', () => {
  it('exposes the exact 8 named colors (6 + ink + mute)', () => {
    expect(COLOR_NAMES).toHaveLength(8)
    expect(COLOR.void).toBe('#05060c')
    expect(COLOR.glass).toBe('#0c1424')
    expect(COLOR.arc).toBe('#5ce1ff')
    expect(COLOR.plasma).toBe('#b794ff')
    expect(COLOR.ember).toBe('#e8c36a')
    expect(COLOR.burn).toBe('#ff6b4a')
    expect(COLOR.ink).toBe('#d7e0f0')
    expect(COLOR.mute).toBe('#8b9bb4')
  })

  it('exposes the fonts (Sora primary, Oxanium, IBM Plex Mono)', () => {
    expect(FONT.sora).toBe('Sora')
    expect(FONT.oxanium).toBe('Oxanium')
    expect(FONT.mono).toBe('IBM Plex Mono')
  })

  it('exposes the metrics (bus bar + hit target are the signature)', () => {
    expect(METRIC.busBarHeight).toBe(44)
    expect(METRIC.hit).toBe(44)
    expect(METRIC.inset).toBe(24)
    expect(METRIC.filament).toBe(2)
    expect(METRIC.blockTimeMs).toBe(5000)
  })

  it('TOKENS is the combined source of truth for the RN app', () => {
    expect(TOKENS.color).toBe(COLOR)
    expect(TOKENS.font).toBe(FONT)
    expect(TOKENS.metric).toBe(METRIC)
  })
})

describe('secret store (T8.1 — Enclave/Keystore wrap)', () => {
  it('iOS → Secure Enclave + Keychain, hardware-backed when SE present', () => {
    const d = secretStoreDecision('ios', { hasSecureEnclave: true, hasStrongBox: false })
    expect(d.keyStore).toBe('secure-enclave')
    expect(d.vaultAtRest).toBe('keychain')
    expect(d.hardwareBacked).toBe(true)
  })

  it('iOS without SE still uses the enclave store (hardwareBacked reports presence)', () => {
    const d = secretStoreDecision('ios', { hasSecureEnclave: false, hasStrongBox: false })
    expect(d.keyStore).toBe('secure-enclave')
    expect(d.hardwareBacked).toBe(false)
  })

  it('Android with StrongBox → strongbox-keystore', () => {
    const d = secretStoreDecision('android', { hasSecureEnclave: false, hasStrongBox: true })
    expect(d.keyStore).toBe('strongbox-keystore')
    expect(d.vaultAtRest).toBe('android-keystore-file')
  })

  it('Android without StrongBox → plain keystore (still hardware-backed)', () => {
    const d = secretStoreDecision('android', { hasSecureEnclave: false, hasStrongBox: false })
    expect(d.keyStore).toBe('keystore')
    expect(d.hardwareBacked).toBe(true)
  })

  it('the mobile wrap strategy is always a hardware wrap', () => {
    const platforms: MobilePlatform[] = ['ios', 'android']
    for (const p of platforms) expect(wrapStrategy(p)).toBe('hardware-wrap')
  })
})

describe('onboarding parity (T8.2)', () => {
  it('the canonical sequence is the contract', () => {
    expect(CANONICAL_ONBOARDING).toContain('welcome')
    expect(CANONICAL_ONBOARDING[CANONICAL_ONBOARDING.length - 1]).toBe('done')
  })

  it('buildFlow(create) is a parity superset', () => {
    const flow = buildFlow({ label: 'create', creation: 'create', withHardware: false })
    expect(isParitySuperset(flow)).toBe(true)
    expect(flow.steps).toContain('create-vault')
  })

  it('buildFlow(import) is a parity superset', () => {
    const flow = buildFlow({ label: 'import', creation: 'import', withHardware: false })
    expect(isParitySuperset(flow)).toBe(true)
    expect(flow.steps).toContain('import-mnemonic')
  })

  it('buildFlow with hardware pairing is a parity superset (optional step allowed)', () => {
    const flow = buildFlow({ label: 'hw', creation: 'create', withHardware: true })
    expect(isParitySuperset(flow)).toBe(true)
    expect(flow.steps).toContain('hardware-pair')
  })

  it('a flow missing a canonical step is NOT parity', () => {
    const bad = { label: 'short', steps: ['welcome', 'done'] as readonly OnboardingStep[] }
    expect(isParitySuperset(bad)).toBe(false)
  })

  it('optional steps are exactly create/import/hardware-pair', () => {
    expect(OPTIONAL_STEPS).toEqual(['create-vault', 'import-mnemonic', 'hardware-pair'])
  })
})
