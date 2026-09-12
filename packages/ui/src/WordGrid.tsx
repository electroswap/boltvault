/**
 * WordGrid — the recovery phrase as a numbered 3-column grid. Numbers are
 * allowed here because the phrase *is* a sequence (§7.2). Rendered only in
 * quiet custody mode, never in the popup (§3.2).
 */
import { Body, Column, Row } from './primitives'
import { edgeStrong, paint } from './tokens'

export interface WordGridProps {
  readonly words: readonly string[]
  /** Positions (1-based) to blank out for the quiz. */
  readonly blanks?: readonly number[]
  readonly testID?: string
}

export function WordGrid({ words, blanks = [], testID }: WordGridProps) {
  const rows: Array<Array<{ n: number; w: string }>> = []
  for (let i = 0; i < words.length; i += 3)
    rows.push(words.slice(i, i + 3).map((w, j) => ({ n: i + j + 1, w })))
  return (
    <Column gap="$2" testID={testID}>
      {rows.map((row, r) => (
        <Row key={r} gap="$2">
          {row.map(({ n, w }) => {
            const blank = blanks.includes(n)
            return (
              <Row
                key={n}
                flex={1}
                minHeight={44}
                paddingHorizontal="$3"
                borderRadius={10}
                borderWidth={1}
                borderColor={blank ? paint.arc : edgeStrong}
                backgroundColor={paint.glassSolid}
                gap="$2"
              >
                <Body tone="mute" size="caption">
                  {n}
                </Body>
                <Body fontSize={15} tone={blank ? 'arc' : 'ink'} testID={`word-${n}`}>
                  {blank ? '·····' : w}
                </Body>
              </Row>
            )
          })}
        </Row>
      ))}
    </Column>
  )
}
