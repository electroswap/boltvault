/**
 * Lock % display (design T5.5). `lockPct` is a 0..1 fraction (e.g. 0.87 = 87%
 * of supply locked). null/undefined means no data → em dash.
 */
export function lockPctDisplay(lockPct: number | null | undefined): string {
  if (lockPct == null) return '—'
  const clamped = Math.min(100, Math.max(0, lockPct * 100))
  return `${Math.round(clamped)}% locked`
}
