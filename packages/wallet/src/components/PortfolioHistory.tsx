/**
 * The portfolio line on Home (master plan §8.2 "History chart").
 *
 * What it draws, stated exactly: the totals this wallet has *seen*, on the
 * chains currently in scope. Quantities come from the chain, but a total is a
 * sum of display prices (§2.8), and this device asks nobody what its total
 * used to be — so a point exists only where the wallet was open and a refresh
 * landed. The line is therefore a record of looking, not a statement of
 * account, and the caption says so rather than letting a smooth curve imply a
 * continuous history nobody has.
 *
 * Motion: none. `LineChart` is one static SVG path, so there is nothing to
 * stop for a reader who has asked for less movement — the same picture is
 * drawn either way, and the only thing `reducedMotion` changes here is the
 * live-looking end dot, which is a beacon rather than information. The Field
 * owns the frame budget (§2.2, §7.7) and this must never ask for a frame.
 *
 * Where it belongs: `packages/ui` as a `PortfolioLine` (or as options on
 * `LineChart` — a gap-aware series and a "high/low/span" footer are not
 * portfolio-specific). It lives here only because this pass may not write to
 * that package.
 */
import { Body, Column, LineChart, Row, useWindowDimensions, type ChartPoint } from '@boltvault/ui'
import type { PortfolioPoint } from '@boltvault/engine'
import { displayFiat } from '../format'
import { t } from '../i18n'

/** Below this there is no shape to show, and a chart of one reading is a decoration. */
const MIN_POINTS = 3
const DAY_MS = 86_400_000

export interface PortfolioHistoryProps {
  readonly points: readonly PortfolioPoint[]
  readonly currency: 'USD' | 'ETN'
  /** Hide the high/low captions; the line still draws from the real series. */
  readonly hidden?: boolean
  /** The popup is short; the tab and the phone can give the line more room. */
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly inset: number
  readonly reducedMotion?: boolean
  readonly testID?: string
}

/** How long the series covers, in the words a person would use. */
function spanLabel(from: number, to: number): string {
  const ms = Math.max(to - from, 0)
  const days = Math.round(ms / DAY_MS)
  if (ms < DAY_MS) {
    const hours = Math.max(1, Math.round(ms / 3_600_000))
    return hours === 1 ? t({ id: 'home.history.hour', message: 'the last hour' }) : t({ id: 'home.history.hours', message: 'the last {n} hours', values: { n: hours } })
  }
  return days <= 1 ? t({ id: 'home.history.day', message: 'the last day' }) : t({ id: 'home.history.days', message: 'the last {n} days', values: { n: days } })
}

export function PortfolioHistory({ points, currency, hidden = false, body, inset, reducedMotion = false, testID }: PortfolioHistoryProps) {
  const { width } = useWindowDimensions()
  /*
    Unpriced readings are dropped rather than plotted as zero. A moment when
    no price source answered is not a moment the portfolio was worth nothing,
    and drawing it as a cliff would be the chart telling a lie the rest of the
    product takes care not to tell.
  */
  const priced = points.filter((p): p is PortfolioPoint & { total: number } => typeof p.total === 'number' && Number.isFinite(p.total))
  if (priced.length < MIN_POINTS) return null

  const series: ChartPoint[] = priced.map((p) => ({ t: p.at, v: p.total }))
  const first = priced[0]
  const last = priced[priced.length - 1]
  if (!first || !last) return null
  const values = priced.map((p) => p.total)
  const high = Math.max(...values)
  const low = Math.min(...values)
  const stroke = last.total > first.total ? 'surge' : last.total < first.total ? 'burn' : 'mute'
  const wide = body === 'extension-tab'
  const chartWidth = Math.min(width, wide ? 640 : width) - inset * 2 - 24
  /*
    §8.2 puts the history chart on tab and mobile, and the popup's size budget
    (§2.2) is why. It is still drawn there, because the popup is the Home most
    people open — but at the smallest height that still reads as a shape, and
    with the caption on one line rather than two, so it costs about the height
    of a single row rather than a section.
  */
  const height = body === 'extension-popup' ? 52 : 96

  return (
    <Column gap={6} testID={testID}>
      <LineChart
        points={series}
        width={Math.max(chartWidth, 120)}
        height={height}
        stroke={stroke}
        area
        baseline={first.total}
        endDot={!reducedMotion}
        reducedMotion={reducedMotion}
        testID={testID ? `${testID}-line` : undefined}
      />
      <Row justifyContent="space-between" alignItems="center" gap="$2">
        <Body tone="mute" size="caption" numberOfLines={1} flexShrink={1}>
          {/*
            Named as a record of what was seen, not as a market history. The
            wallet has no price feed it treats as authoritative and does not
            pretend to know what the total was while it was shut.
          */}
          {t({ id: 'home.history.caption', message: 'What you have been holding, over {span}', values: { span: spanLabel(first.at, last.at) } })}
        </Body>
        <Body tone="mute" size="caption" numberOfLines={1} testID={testID ? `${testID}-range` : undefined}>
          {t({ id: 'home.history.range', message: '{low} – {high}', values: { low: displayFiat(low, currency, hidden), high: displayFiat(high, currency, hidden) } })}
        </Body>
      </Row>
    </Column>
  )
}
