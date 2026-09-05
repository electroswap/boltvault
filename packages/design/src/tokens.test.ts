import { describe, expect, it } from 'vitest'
import { palette, cssVars, metrics, fonts } from './tokens'

describe('design tokens', () => {
  it('has the 8 named colors', () => {
    expect(Object.keys(palette)).toHaveLength(8)
    expect(palette.arc).toBe('#5ce1ff')
    expect(palette.void).toBe('#05060c')
    expect(palette.plasma).toBe('#b794ff')
  })
  it('cssVars emits a :root block with --bv-arc', () => {
    const css = cssVars()
    expect(css).toContain('--bv-arc:#5ce1ff')
    expect(css).toContain('--bv-void:#05060c')
    expect(css).toContain('color-scheme:dark')
  })
  it('bus-bar + hit targets are the 44px law', () => {
    expect(metrics.busBarHeight).toBe(44)
    expect(metrics.hit).toBe(44)
    expect(metrics.filament).toBe(2)
    expect(metrics.inset).toBe(24)
  })
  it('fonts reference the self-hosted faces', () => {
    expect(fonts.sora).toContain('Sora')
    expect(fonts.oxanium).toContain('Oxanium')
  })
})
