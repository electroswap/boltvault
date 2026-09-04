/**
 * Sparkline shaping (design T5.5). Pure: series + trend direction, no canvas.
 * The renderer draws `points`; `trend`/`changePct` drive the label/color.
 */
export type Trend = 'up' | 'down' | 'flat'

/** ±0.05% counts as flat (noise band). */
const FLAT_EPSILON = 0.05

export function sparkline(series: readonly number[]): {
  points: number[]
  trend: Trend
  changePct: number | null
} {
  if (series.length === 0) throw new Error('sparkline: series must be non-empty')
  const first = series[0]!
  const last = series[series.length - 1]!
  const changePct: number | null =
    first === 0 ? null : ((last - first) / first) * 100
  const trend: Trend =
    changePct == null || changePct <= FLAT_EPSILON && changePct >= -FLAT_EPSILON
      ? 'flat'
      : changePct > 0
        ? 'up'
        : 'down'
  return { points: [...series], trend, changePct }
}
