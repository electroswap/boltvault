/**
 * Pill — a choice or a mark (style bible › materials): a token, a duration,
 * a scope, a filter, "Show all". A 44 px pressable around a 28/36 px chip;
 * selected = a filled tint of the arc with an ink label (never a lit rim —
 * style bible › selected). Without `onPress` it is a static mark and gets
 * no button role.
 */
import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import { Icon } from './Icon'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body, Row } from './primitives'
import { edge, glow, metrics, motion, paint } from './tokens'

export interface PillProps {
  readonly label: string
  readonly icon?: ReactNode
  readonly chevron?: boolean
  readonly selected?: boolean
  readonly tone?: 'ink' | 'mute' | 'arc' | 'ember' | 'surge' | 'burn'
  /**
   * `lg` is the swap console's token selector, sized from the web interface's
   * own `CurrencySelect`: a 36 px pill whose symbol is set at 18 px, not at the
   * 13 px every other pill's label uses. Owner: "bigger font for token
   * selectors". Everything else stays where it was.
   */
  readonly size?: 'xs' | 'sm' | 'md' | 'lg'
  /**
   * Bold the label. For a pill whose label is a *name* rather than a setting —
   * the token in a swap or send selector, where the symbol is the subject of
   * the row and everything around it is chrome.
   */
  readonly strong?: boolean
  readonly disabled?: boolean
  readonly onPress?: () => void
  readonly accessibilityLabel?: string
  readonly testID?: string
}

export function Pill({ label, icon, chevron = false, selected = false, tone, size = 'md', strong = false, disabled = false, onPress, accessibilityLabel, testID }: PillProps) {
  // xs is a badge, not a control: it states a fact ('Pays dividends',
  // 'ERC-721') and should not carry the weight of something you can press.
  const height = size === 'xs' ? 20 : size === 'sm' ? 28 : 36
  const labelTone = selected ? 'ink' : (tone ?? 'mute')
  const reduced = useReducedMotionPref()
  const chip = (
    <Animated.View
      style={{
        height,
        paddingHorizontal: size === 'xs' ? 7 : size === 'sm' ? 10 : size === 'lg' ? 10 : 12,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? paint.arcSoft : paint.glassRaised,
        borderColor: selected ? paint.arcEdge : strong ? paint.arcEdge : edge,
        opacity: disabled ? 0.5 : 1,
        /*
          A token selector carries light. `strong` already marks exactly these —
          the swap and send selectors, where the symbol is the subject of the row
          — and on the swap card they were the same flat chip as a filter pill,
          which is what made the screen read as chrome all the way down. Owner:
          "the token selectors have a glow".

          The glow, not a lit rim: two rimmed things inside a rimmed console is
          the "template tell" the bible warns about, and a rim would also fight
          the `selected` treatment, which the bible says is the one and only
          selected style.
        */
        /*
          `boxShadow`, not the `shadow*` quartet.

          Android draws nothing for `shadowColor`/`shadowRadius`/`shadowOpacity`
          on a View — those are iOS and web only; Android's own shadow is
          `elevation`, which is a grey drop shadow under the box rather than a
          coloured halo around it. So the glow this has claimed to draw since it
          was written has never appeared on a phone, which is where the owner
          reads it: "Token selectors should have a small glow like the web
          interface." `boxShadow` is one declaration that renders on all three
          (React Native 0.76+, and CSS on the web), so the halo is the same
          halo everywhere.
        */
        ...(strong && !disabled ? { boxShadow: `0px 0px 12px ${glow.tab}` } : {}),
        transitionProperty: ['backgroundColor', 'borderColor'],
        transitionDuration: reduced ? 0 : motion.micro,
        transitionTimingFunction: 'ease-out',
      }}
    >
      <Row gap={size === 'xs' ? 4 : size === 'lg' ? 8 : 6} alignItems="center">
        {icon}
        <Body size="caption" fontSize={size === 'xs' ? 11 : size === 'lg' ? 18 : undefined} lineHeight={size === 'xs' ? 14 : size === 'lg' ? 22 : undefined} tone={labelTone} fontWeight={strong ? '700' : selected ? '600' : '400'} numberOfLines={1}>
          {label}
        </Body>
        {chevron ? <Icon name="chevronDown" size={size === 'lg' ? 18 : 14} color={selected ? paint.ink : paint.mute} /> : null}
      </Row>
    </Animated.View>
  )
  if (!onPress) return <Row testID={testID}>{chip}</Row>
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      testID={testID}
      /*
        44 in BOTH directions, not just height.

        The pressable has always guaranteed the height and let the width follow
        the chip, which is fine for a pill carrying a label and is not fine for
        one carrying only a mark: the X link on the token dossier measured
        42×44 and failed the hit-target law the screenshot suite asserts. It
        went unseen because that suite photographed the Unlock screen for every
        scenario (see the harness entrypoint's clock note), so the token screen
        was never actually measured.

        `alignItems: 'center'` keeps the chip its own size inside the larger
        box — the docstring's "44 px pressable around a 28/36 px chip" — rather
        than stretching a 36 px chip out to 44.
      */
      style={{ minHeight: metrics.hit, minWidth: metrics.hit, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start' }}
    >
      {chip}
    </Pressable>
  )
}
