// @boltvault/design — the token contract.
//
// The 8 named colors + type scale + metrics as named consts, plus cssVars()
// which emits the :root block the popup/tab inject once. Tokens are the source
// of truth (design §Chamber Palette/Type/Metrics); porting to Tamagui later
// is a mechanical rename.

export const palette = {
  void: '#05060c',
  glass: '#0c1424',
  arc: '#5ce1ff',
  plasma: '#b794ff',
  ember: '#e8c36a',
  burn: '#ff6b4a',
  ink: '#d7e0f0',
  mute: '#8b9bb4',
} as const

export type PaletteToken = keyof typeof palette

export const metrics = {
  inset: 24,
  filament: 2,
  busBarHeight: 44,
  hit: 44,
} as const

export const fonts = {
  sora: "'Sora', system-ui, -apple-system, sans-serif",
  oxanium: "'Oxanium', 'Sora', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const

/**
 * The CSS custom-property block, injected once into the popup/tab. Replaces the
 * hardcoded :root that used to live in tokens.css. `--bv-<name>` per token.
 */
export function cssVars(): string {
  const c = palette
  return [
    ':root{',
    `--bv-void:${c.void};--bv-glass:${c.glass};--bv-arc:${c.arc};--bv-plasma:${c.plasma};`,
    `--bv-ember:${c.ember};--bv-burn:${c.burn};--bv-ink:${c.ink};--bv-mute:${c.mute};`,
    `--bv-font-sora:${fonts.sora};--bv-font-oxanium:${fonts.oxanium};--bv-font-mono:${fonts.mono};`,
    `--bv-inset:${metrics.inset}px;--bv-filament:${metrics.filament}px;`,
    `--bv-bus-bar-height:${metrics.busBarHeight}px;--bv-hit:${metrics.hit}px;`,
    'color-scheme:dark}',
  ].join('\n')
}
