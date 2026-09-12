/**
 * The three slides before the fork (§8.1).
 *
 * Onboarding used to open on a three-way decision — create, import, watch —
 * with two sentences of context. This is the part that earns the decision.
 *
 * Slides one and two are drawn (`IntroArt`). Slide three is **the product
 * itself**, composed from the same primitives Home uses rather than a picture
 * of them: the style bible's argument for how mocks must be drawn is that a
 * mock is believable only when held to the product's materials, and the real
 * thing is trivially believable. It also cannot go stale.
 *
 * Paging is a horizontal `ScrollView` with `pagingEnabled`, and a page is the
 * MEASURED width in pixels — never a percentage, which resolves against the
 * content box under Yoga and the padding box in CSS, drifting the pages out of
 * step (the erratum `Rim` and `Rotor` both carry).
 *
 * No auto-advance. A surface that moves on while somebody is reading it is
 * worse than one that never moves, and it would make the screenshot baselines
 * non-deterministic.
 */
import { Body, Column, CurrentFill, IconButton, IntroArt, Key, Plate, Row, ScrollView, Signature, useWindowDimensions } from '@boltvault/ui'
import { useRef, useState, type ComponentRef } from 'react'
import { t } from '../../i18n'

/*
  Typed structurally rather than imported from react-native: `packages/wallet`
  composes only `@boltvault/ui` and never reaches for the platform directly —
  `.dependency-cruiser.cjs` makes that an error, not a preference.

  Every hop is optional, and the readers below check. On Android, pressing
  "Next" crashed the app outright with `Cannot read property 'layout' of null`:
  a layout event arrives there with a null `nativeEvent`, which the web body
  never produces and so the harness never saw. A handler that assumes the
  shape of an event it did not construct is a crash waiting for a platform.
*/
type LayoutEvent = { nativeEvent?: { layout?: { width?: number } } | null }
type ScrollEvent = { nativeEvent?: { contentOffset?: { x?: number } } | null }

/** A miniature of the wallet, built from the real thing. */
function ProductSlide({ width }: { width: number }) {
  const w = Math.min(width * 0.74, 260)
  return (
    <Plate role="raised" width={w} gap="$2" padding={12}>
      <Row gap="$2" alignItems="center">
        <Signature address="0x1f90a1b2c3d4e5f60718293a4b5c6d7e8f907b63" size={26} />
        <Column flex={1} minWidth={0} alignItems="flex-start" gap={1}>
          <Body size="caption" fontWeight="600" numberOfLines={1}>
            {t({ id: 'ob.slide3.account', message: 'Account 1' })}
          </Body>
          <Body tone="mute" size="caption" fontSize={10} lineHeight={12} numberOfLines={1}>
            0x1F90…7B63
          </Body>
        </Column>
      </Row>
      {/* The two rows a preview shows: what leaves, and what arrives. */}
      <Body tone="mute" size="caption" fontSize={10} lineHeight={13}>
        {t({ id: 'ob.slide3.moves', message: 'This transaction moves' })}
      </Body>
      {[
        { key: 'out', asset: 'USDC', amount: t({ id: 'ob.slide3.out', message: '− 250' }), tone: 'burn' as const },
        { key: 'in', asset: 'ETN', amount: t({ id: 'ob.slide3.in', message: '+ 0.41' }), tone: 'surge' as const },
      ].map((r) => (
        <Row key={r.key} justifyContent="space-between" alignItems="center">
          <Body size="caption" fontSize={11} lineHeight={14}>
            {r.asset}
          </Body>
          <Body tone={r.tone} size="caption" fontWeight="600">
            {r.amount}
          </Body>
        </Row>
      ))}
      <Column height={1} backgroundColor="$edge" />
      <Body tone="ember" size="caption" fontSize={11} lineHeight={14} numberOfLines={2}>
        {t({ id: 'ob.slide3.warn', message: 'Unlimited approval — BoltVault will ask you to make it exact.' })}
      </Body>
    </Plate>
  )
}

interface Slide {
  readonly id: string
  readonly title: string
  readonly body: string
}

export function IntroCarousel({ onDone, onSkip, reducedMotion = false }: { onDone: () => void; onSkip: () => void; reducedMotion?: boolean }) {
  const { width: screenWidth } = useWindowDimensions()
  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const scroller = useRef<ComponentRef<typeof ScrollView> | null>(null)

  const slides: Slide[] = [
    { id: 'keys', title: t({ id: 'ob.slide1.title', message: 'Your keys stay here' }), body: t({ id: 'ob.slide1.body', message: 'Your recovery phrase is sealed with your password on this device. Nothing leaves it unless you export it.' }) },
    { id: 'chains', title: t({ id: 'ob.slide2.title', message: 'Electroneum, and nine chains beside it' }), body: t({ id: 'ob.slide2.body', message: 'One phrase, one wallet, every balance in one place. Swap and bridge without leaving it.' }) },
    { id: 'firewall', title: t({ id: 'ob.slide3.title', message: 'See what a transaction moves' }), body: t({ id: 'ob.slide3.body', message: 'BoltVault previews the balance changes before you sign, and refuses what it cannot verify.' }) },
  ]
  const last = index >= slides.length - 1

  const go = (next: number): void => {
    const clamped = Math.min(Math.max(next, 0), slides.length - 1)
    setIndex(clamped)
    if (width > 0) scroller.current?.scrollTo({ x: clamped * width, y: 0, animated: !reducedMotion })
  }

  const onScrollEnd = (e: ScrollEvent): void => {
    const x = e?.nativeEvent?.contentOffset?.x
    if (width <= 0 || typeof x !== 'number') return
    setIndex(Math.min(Math.max(Math.round(x / width), 0), slides.length - 1))
  }

  const onPageLayout = (e: LayoutEvent): void => {
    const w = e?.nativeEvent?.layout?.width
    if (typeof w !== 'number' || w <= 0) return
    setWidth((p) => (Math.abs(p - w) < 0.5 ? p : w))
  }

  /*
    Sized from the HEIGHT as well as the width.

    Width alone gave a 248 px illustration in a 400×600 popup, which left the
    body copy clipped mid-sentence once the header, dots and key had taken
    their share. The phone has room; the popup does not, and the copy is the
    part that has to survive.
  */
  const { height: screenHeight } = useWindowDimensions()
  const art = Math.round(Math.max(120, Math.min(screenWidth * 0.62, screenHeight * 0.3, 260)))

  return (
    <Column flex={1} testID="ob-intro">
      <Row justifyContent="space-between" alignItems="center" minHeight={44}>
        {index > 0 ? <IconButton icon="back" label={t({ id: 'back', message: 'Back' })} onPress={() => go(index - 1)} testID="ob-intro-back" /> : <Column width={44} />}
        <Key label={t({ id: 'ob.intro.skip', message: 'Skip' })} kind="secondary" size="compact" onPress={onSkip} testID="ob-intro-skip" />
      </Row>

      <Column flex={1} onLayout={onPageLayout}>
        <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScrollEnd} onScrollEndDrag={onScrollEnd}>
          {slides.map((s, i) => (
            <Column key={s.id} width={width > 0 ? width : undefined} alignItems="center" justifyContent="center" gap="$4" paddingHorizontal={4} testID={`ob-slide-${s.id}`}>
              <Column minHeight={art} alignItems="center" justifyContent="center">
                {i === 2 ? <ProductSlide width={width || art} /> : <IntroArt slide={i === 0 ? 1 : 2} size={art} reducedMotion={reducedMotion} testID={`ob-art-${s.id}`} />}
              </Column>
              <Column gap="$2" alignItems="center" paddingHorizontal={8}>
                <Body size="title" textAlign="center">
                  {s.title}
                </Body>
                <Body tone="mute" textAlign="center">
                  {s.body}
                </Body>
              </Column>
            </Column>
          ))}
        </ScrollView>
      </Column>

      {/*
        Dots, and only dots — decorative, `aria-hidden`, no pointer events. A
        44 px target each (the hit law's minimum) would be a third of a 400 px
        popup spent on decoration, and every slide is reachable by swipe, by the
        key below and by Tab, since all three stay in the document.
      */}
      <Row gap={6} justifyContent="center" paddingVertical="$3" pointerEvents="none" aria-hidden testID="ob-intro-dots">
        {slides.map((s, i) => (
          <Column key={s.id} width={i === index ? 18 : 6} height={6} borderRadius={3} overflow="hidden" backgroundColor={i === index ? undefined : 'rgba(143,153,196,0.35)'}>
            {i === index ? <CurrentFill radius={3} /> : null}
          </Column>
        ))}
      </Row>

      <Key label={last ? t({ id: 'ob.intro.start', message: 'Get started' }) : t({ id: 'ob.intro.next', message: 'Next' })} onPress={() => (last ? onDone() : go(index + 1))} testID="ob-intro-next" />
    </Column>
  )
}
