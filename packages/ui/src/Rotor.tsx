/**
 * Rotor — the strip under the console that turns (plan B3).
 *
 * Home used to give this one slot and a priority cascade: a backup gate, else
 * an ops notice, else a bridge, else a pending transaction, else *one* of the
 * things you own that need attention. Everything below the winner was invisible
 * until the winner was dealt with, and the holder tier — the one entry that is
 * always true and the only one that is an invitation rather than a chore — had
 * nowhere to live at all and ended up crammed beside the address.
 *
 * So the slot turns. Each entry gets the full width and its own moment: swipe,
 * press an arrow, or wait and it advances on its own. With one entry there are
 * no arrows and nothing moves.
 *
 * There are no dots. They were a row of their own under the entry, and that row
 * was 11 px — which was exactly how much Home overflowed by once this replaced
 * the old single slot, so the strip cost the whole screen its scroll position
 * to say something an 11 px row says badly anyway. Position is a hairline along
 * the bottom edge instead: absolutely positioned, so it costs no layout height
 * at all, and painted with the current like the share bar under a `BusBar`. The
 * arrows are the affordance; the hairline is the answer to "how far through".
 *
 * The arrows also have to be 44 px wide — the hit law (§7.5) has no smaller
 * size — but the row is already at least 48 px tall, so they cost horizontal
 * space and no vertical space at all. That is the whole trick: everything the
 * pager needs lives inside the height the entry already had.
 *
 * Paging is a horizontal `ScrollView` with `pagingEnabled`, which is real on
 * both platforms — native gets momentum snapping, react-native-web gets CSS
 * scroll snap — rather than a transform we would have to gesture ourselves. It
 * costs one measurement: a page is exactly the measured width, because a
 * percentage would resolve against the *content* box under Yoga and the pages
 * would drift out of step (the same erratum documented in `Rim`).
 *
 * It also means every entry is in the document whether or not it is the one on
 * screen, so Tab reaches them all and a screen reader is never shown a strip
 * with five sixths of it missing.
 */
import { useEffect, useRef, useState } from 'react'
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Body, Column, Plate, Row } from './primitives'
import { CurrentFill } from './Rim'
import { Pressable } from './List'
import { metrics, paint } from './tokens'

export interface RotorItem {
  readonly id: string
  readonly icon: IconName
  /** A `paint` colour for the glyph — the entry's urgency, never carried by colour alone. */
  readonly tone: string
  readonly text: string
  /** A quieter second line: the nudge, the detail, the "what next". */
  readonly sub?: string | null
  readonly onPress?: () => void
  readonly testID?: string
}

export interface RotorProps {
  readonly items: readonly RotorItem[]
  /** How long each entry holds before the next one comes round. */
  readonly intervalMs?: number
  /** No auto-advance and no animated scroll; the dots still work. */
  readonly reducedMotion?: boolean
  readonly testID?: string
}

const DWELL_MS = 6_000

export function Rotor({ items, intervalMs = DWELL_MS, reducedMotion = false, testID }: RotorProps) {
  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const scroller = useRef<ScrollView | null>(null)
  const count = items.length
  /*
    Held after a touch: a strip that moves on while somebody is reading it is
    worse than one that never moves. Any interaction stops the rotation for the
    rest of this mount, which on a popup is the rest of the visit.
  */
  const [held, setHeld] = useState(false)

  const onLayout = (e: LayoutChangeEvent): void => {
    const w = e.nativeEvent.layout.width
    setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w))
  }

  // Entries come and go as things are claimed and collected; never point past the end.
  useEffect(() => {
    setIndex((i) => (i < count ? i : Math.max(0, count - 1)))
  }, [count])

  useEffect(() => {
    if (held || reducedMotion || count < 2 || width <= 0) return
    const id = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % count
        scroller.current?.scrollTo({ x: next * width, y: 0, animated: true })
        return next
      })
    }, intervalMs)
    return () => clearInterval(id)
  }, [held, reducedMotion, count, width, intervalMs])

  if (count === 0) return null

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    if (width <= 0) return
    const at = Math.round(e.nativeEvent.contentOffset.x / width)
    setIndex(Math.min(Math.max(at, 0), count - 1))
  }

  // Wraps in both directions: with a handful of entries, "past the end" should
  // come back round rather than dead-end on a control that still looks live.
  const step = (delta: number): void => {
    setHeld(true)
    const next = (index + delta + count) % count
    setIndex(next)
    if (width > 0) scroller.current?.scrollTo({ x: next * width, y: 0, animated: !reducedMotion })
  }

  const paged = count > 1
  return (
    <Plate role="card" padding={0} overflow="hidden" minHeight={metrics.hit} justifyContent="center" testID={testID}>
      <Row alignItems="stretch">
        {/* Measured here, inside the arrows, so a page is the width an entry actually gets. */}
        <Column flex={1} minWidth={0} onLayout={onLayout}>
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={paged}
            onTouchStart={() => setHeld(true)}
            onScrollBeginDrag={() => setHeld(true)}
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={onScrollEnd}
            // A single entry must not be draggable at all, or the strip rubber-bands for no reason.
            contentContainerStyle={paged ? undefined : { width: '100%' }}
          >
            {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={item.onPress}
                disabled={!item.onPress}
                accessibilityRole={item.onPress ? 'button' : undefined}
                accessibilityLabel={item.sub ? `${item.text}. ${item.sub}` : item.text}
                testID={item.testID}
                style={{ width: width > 0 ? width : undefined, minHeight: metrics.hit, justifyContent: 'center', paddingVertical: 8, paddingLeft: 12, paddingRight: paged ? 4 : 12 }}
              >
                <Row gap="$2" alignItems="center">
                  <Icon name={item.icon} size={16} color={item.tone} />
                  <Column flex={1} minWidth={0} alignItems="flex-start" gap={1}>
                    <Body size="caption" numberOfLines={1}>
                      {item.text}
                    </Body>
                    {item.sub ? (
                      <Body tone="mute" size="caption" fontSize={11} lineHeight={13} numberOfLines={1}>
                        {item.sub}
                      </Body>
                    ) : null}
                  </Column>
                </Row>
              </Pressable>
            ))}
          </ScrollView>
        </Column>
        {/*
          One arrow, not two.

          A 44 px control is the smallest the hit law allows, so a second one
          costs another 44 px out of a 400 px popup — and it came out of the
          entry's second line, which is the line worth protecting: three of the
          six entries were clipping their sub with a pair of arrows and none are
          with one. Forward wraps, so five presses reach anything from anywhere,
          and a finger still swipes both ways.
        */}
        {paged ? <Arrow icon="refresh" label="Next" onPress={() => step(1)} testID={testID ? `${testID}-next` : undefined} /> : null}
      </Row>
      {paged ? (
        /*
          Where you are, as a hairline along the bottom edge.

          Absolutely positioned, so it adds nothing to the strip's height — the
          row of dots this replaced added 11 px, which was precisely what tipped
          Home into scrolling. `count` flex children rather than a percentage
          offset: percentages on an absolutely positioned child resolve against
          the parent's content box under Yoga and its padding box in CSS (see
          `Rim`), and flex is the same on both.
        */
        <Row style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 }} pointerEvents="none" aria-hidden>
          {items.map((item, i) => (
            <View key={item.id} style={{ flex: 1, height: 2, overflow: 'hidden' }}>
              {i === index ? <CurrentFill radius={1} /> : null}
            </View>
          ))}
        </Row>
      ) : null}
    </Plate>
  )
}

/**
 * The pager control: 44 px because the hit law says so, and free because the
 * row is already taller than that.
 *
 * `refresh` rather than `chevronRight`, which is what it was first. A right
 * chevron means "open this" in twelve other places in this app, and it would
 * have sat exactly where the entry's own drill-in chevron used to be — so
 * somebody wanting to open their dividends would press it and be shown the next
 * notice instead. A cycle glyph cannot be read that way, and it is the same
 * gesture the strip makes on its own.
 */
function Arrow({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={{ width: metrics.hit, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={16} color={paint.mute} />
    </Pressable>
  )
}
