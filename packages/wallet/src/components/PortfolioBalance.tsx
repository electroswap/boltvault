/**
 * The portfolio total: the hero readout, an eye that hides it, and the day's
 * change underneath.
 *
 * Home used to put the +/- on the same line as the dollars, which left no
 * room for the eye immediately to the right of the figure. The change sits
 * under the amount now, so the mini-console grows by a caption row and the
 * full Portfolio reads the same way.
 */
import { Body, Column, Icon, Pressable, RollingReadout, Row, metrics, paint } from '@boltvault/ui'
import type { ReactNode } from 'react'
import { t } from '../i18n'

export interface PortfolioBalanceProps {
  readonly value: string
  readonly change: string | null
  readonly hidden: boolean
  readonly onToggle: () => void
  readonly reducedMotion?: boolean
  /** Opens the full Portfolio; omitted on the Portfolio screen itself. */
  readonly onPress?: () => void
  readonly trailing?: ReactNode
  readonly extra?: ReactNode
  readonly pressTestID?: string
}

export function PortfolioBalance({
  value,
  change,
  hidden,
  onToggle,
  reducedMotion = false,
  onPress,
  trailing,
  extra,
  pressTestID,
}: PortfolioBalanceProps) {
  const amount = (
    <RollingReadout
      value={value}
      hero
      reducedMotion={reducedMotion || hidden}
      accessibilityLabel={hidden ? t({ id: 'portfolio.balance.hidden', message: 'Balance hidden' }) : value}
      testID="total"
    />
  )
  const changeLine =
    change || extra ? (
      <Row gap="$3" flexWrap="wrap" alignItems="center">
        {change ? (
          <Body
            tone={change.startsWith('+') ? 'surge' : change.startsWith('−') ? 'burn' : 'mute'}
            size="caption"
            fontWeight="600"
            numberOfLines={1}
          >
            {change} {t({ id: 'home.today', message: 'today' })}
          </Body>
        ) : null}
        {extra}
      </Row>
    ) : null
  const eye = (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={
        hidden
          ? t({ id: 'portfolio.balance.show', message: 'Show balances' })
          : t({ id: 'portfolio.balance.hide', message: 'Hide balances' })
      }
      testID="hide-balances"
      style={{
        width: metrics.hit,
        height: metrics.hit,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={hidden ? 'eyeOff' : 'eye'} size={24} color={paint.mute} />
    </Pressable>
  )

  return (
    <Column gap={2} testID="portfolio-balance">
      <Row alignItems="center">
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={t({ id: 'home.portfolio.a11y', message: 'Open your portfolio' })}
            testID={pressTestID}
            /*
              The hit target holds even while the total is still arriving.

              Its width is the readout's, and before a balance lands the
              readout is a few characters wide — 39 px on a popup, under the
              44 px law (§7.5). It surfaced as an INTERMITTENT screenshot
              failure, because whether the shot caught the loading state
              depended on timing; a floor makes it neither intermittent nor a
              failure. A funded wallet's total is far wider than this, so
              nothing moves in the normal case.
            */
            style={{ flexShrink: 1, minWidth: metrics.hit, minHeight: metrics.hit, justifyContent: 'center' }}
          >
            {amount}
          </Pressable>
        ) : (
          amount
        )}
        {eye}
        {trailing ? (
          onPress ? (
            <Pressable
              onPress={onPress}
              accessible={false}
              style={{ flex: 1, minHeight: metrics.hit, alignItems: 'flex-end', justifyContent: 'center' }}
            >
              {trailing}
            </Pressable>
          ) : (
            <Row flex={1} justifyContent="flex-end">
              {trailing}
            </Row>
          )
        ) : null}
      </Row>
      {changeLine && onPress ? (
        <Pressable onPress={onPress} accessible={false}>
          {changeLine}
        </Pressable>
      ) : (
        changeLine
      )}
    </Column>
  )
}
