/** The Field's contract — identical on both renderers (master plan §7.6). */
export interface FieldProps {
  /** Account address; seeds the field so each account has its own light. */
  readonly address: string
  /** 0..1, set to 1 on each Electroneum block; the component decays it. */
  readonly pulse?: number
  /** Holder-tier warmth 0..1 (§8.18); light-only. */
  readonly warmth?: number
  /** 0..1 overall intensity; popup runs lower than the tab. */
  readonly intensity?: number
  /** Quiet custody mode: dims to 15%, ignores touch (§7.9). */
  readonly quiet?: boolean
  /** Still frame, no time evolution (§7.6 reduced motion). */
  readonly reducedMotion?: boolean
  /** Frame cap; popup 30, tab/mobile 60. */
  readonly fps?: number
  /**
   * Which background. 'grid' is the wave mesh from the style bible; 'circuit'
   * is the board ported from the docs landing page. Same uniforms, so this
   * only picks a fragment shader. 'off' draws nothing at all.
   */
  readonly scene?: 'grid' | 'circuit' | 'off'
  readonly width: number
  readonly height: number
  readonly testID?: string
}
