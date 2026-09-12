/**
 * StatCell and StatStrip — numbers that sit together (style bible › type):
 * a mute 13 px label over an Oxanium 20 px value, in cells of equal width,
 * on a well or bare. Collection stats, farm cards, campaign limits.
 */
import { Body, Column, Plate, Readout, Row } from './primitives'

export interface StatCell {
  readonly label: string
  readonly value: string
  readonly caption?: string
  readonly tone?: 'ink' | 'arc' | 'ember' | 'surge' | 'burn' | 'mute'
  readonly testID?: string
}

const COLOR = {
  ink: '$ink',
  arc: '$arc',
  ember: '$ember',
  surge: '$surge',
  burn: '$burn',
  mute: '$mute',
} as const

export function StatCellView({
  label,
  value,
  caption,
  tone = 'ink',
  small = false,
  testID,
}: StatCell & { small?: boolean }) {
  return (
    <Column gap={2} minWidth={0} testID={testID}>
      <Body tone="mute" size="caption" numberOfLines={1}>
        {label}
      </Body>
      {small ? (
        <Body fontWeight="600" numberOfLines={1} color={COLOR[tone]}>
          {value}
        </Body>
      ) : (
        <Readout stat numberOfLines={1} color={COLOR[tone]}>
          {value}
        </Readout>
      )}
      {caption ? (
        <Body tone="mute" size="caption" fontSize={12} lineHeight={16} numberOfLines={1}>
          {caption}
        </Body>
      ) : null}
    </Column>
  )
}

export interface StatStripProps {
  readonly cells: readonly StatCell[]
  /** Cells per row; default 3, or every cell on one row when there are fewer. */
  readonly columns?: number
  /** No well: the strip sits on its plate. */
  readonly bare?: boolean
  /** Sora 15 values instead of Oxanium 20 (list cards). */
  readonly small?: boolean
  readonly testID?: string
}

export function StatStrip({ cells, columns, bare = false, small = false, testID }: StatStripProps) {
  const cols = Math.max(1, Math.min(columns ?? 3, cells.length))
  const rows: StatCell[][] = []
  for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols))
  const body = (
    <Column gap="$3" testID={testID}>
      {rows.map((r, i) => (
        <Row key={i} gap="$3" alignItems="flex-start">
          {r.map((c) => (
            <Column key={c.label} flex={1} minWidth={0}>
              <StatCellView {...c} small={small} />
            </Column>
          ))}
        </Row>
      ))}
    </Column>
  )
  if (bare) return body
  return (
    <Plate role="well" padding="$3">
      {body}
    </Plate>
  )
}
