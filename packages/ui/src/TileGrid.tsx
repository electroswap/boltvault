/**
 * TileGrid — measures its own width and hands back a tile size and a column
 * count for a target tile (popup ≈ 100 px → 3 columns, tab ≈ 150 px → 5–6).
 * Replaces hardcoded viewport widths in the Rack, a collection and a piece.
 */
import { useState, type ReactNode } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'

export interface TileLayout {
  readonly size: number
  readonly cols: number
  readonly width: number
}

export interface TileGridProps {
  /** The tile size to aim for; the grid picks the column count that comes closest without going under. */
  readonly target: number
  readonly gap?: number
  readonly minCols?: number
  readonly maxCols?: number
  /** Used for the first paint, before the layout pass. */
  readonly fallbackWidth: number
  readonly children: (layout: TileLayout) => ReactNode
  readonly testID?: string
}

export function tileLayout(
  width: number,
  target: number,
  gap: number,
  minCols: number,
  maxCols: number,
): TileLayout {
  const cols = Math.max(minCols, Math.min(maxCols, Math.floor((width + gap) / (target + gap))))
  const size = Math.max(1, Math.floor((width - gap * (cols - 1)) / cols))
  return { size, cols, width }
}

export function TileGrid({
  target,
  gap = 8,
  minCols = 2,
  maxCols = 6,
  fallbackWidth,
  children,
  testID,
}: TileGridProps) {
  const [width, setWidth] = useState(fallbackWidth)
  const onLayout = (e: LayoutChangeEvent): void => {
    const w = Math.floor(e.nativeEvent.layout.width)
    if (w > 0 && w !== width) setWidth(w)
  }
  return (
    <View onLayout={onLayout} style={{ width: '100%' }} testID={testID}>
      {children(tileLayout(width, target, gap, minCols, maxCols))}
    </View>
  )
}
