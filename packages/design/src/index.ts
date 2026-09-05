// @boltvault/design — the face contract.
//
// Tokens (the source of truth), the icon set, and the shared React
// primitives that every surface uses. Rendering tech is plain React + inline
// styles (RN-ready per design D2); porting to Tamagui later is a mechanical
// rename of the tokens/primitive names.

export { palette, metrics, fonts, cssVars, type PaletteToken } from './tokens'
export * from './icons'
export {
  Breaker,
  BusBar,
  Terminal,
  Chip,
  Sheet,
  EmptyState,
  Filament,
  Gauge,
  Rack,
  type RackItem,
  type TestId,
} from './primitives'
export { TokenAvatar, pickLogo, defaultImageProbe, type TokenAvatarProps, type LogoProbe } from './TokenAvatar'
