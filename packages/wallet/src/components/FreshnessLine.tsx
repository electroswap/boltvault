/**
 * One line under a screen's header: a sweep while a fresh read is in
 * flight, "As of 3 min ago" while the screen shows the last visit's data,
 * nothing when it is current (plan A2).
 */
import { Column, Refreshing, Stale } from '@boltvault/ui'
import type { Freshness } from '../hooks/useCached'
import { t } from '../i18n'

const STALE_AFTER_MS = 60_000

export function agoLabel(observedAt: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - observedAt) / 1000))
  if (s < 90) return t({ id: 'fresh.moment', message: 'As of a moment ago' })
  const m = Math.round(s / 60)
  if (m < 90) return t({ id: 'fresh.minutes', message: 'As of {m} min ago', values: { m } })
  const h = Math.round(m / 60)
  if (h < 36) return t({ id: 'fresh.hours', message: 'As of {h} h ago', values: { h } })
  return t({ id: 'fresh.days', message: 'As of {d} days ago', values: { d: Math.round(h / 24) } })
}

export function FreshnessLine({ freshness, observedAt, refreshing, reducedMotion = false, testID }: { freshness: Freshness; observedAt: number | null; refreshing: boolean; reducedMotion?: boolean; testID?: string }) {
  const stale = freshness === 'cached' && observedAt !== null && Date.now() - observedAt > STALE_AFTER_MS
  return (
    <Column gap="$1" testID={testID}>
      <Refreshing active={refreshing} reducedMotion={reducedMotion} />
      {stale && !refreshing && observedAt !== null ? <Stale label={agoLabel(observedAt)} /> : null}
    </Column>
  )
}
