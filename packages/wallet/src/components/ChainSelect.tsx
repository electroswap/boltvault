/**
 * The one chain selector (style bible › chain selector): a pill — the chain's
 * mark, its name, a chevron — that opens the one chain sheet: left-aligned
 * rows with the mark, the name, a caption, the balance you hold there, a
 * check on the chosen one; a chain that is turned off says so and offers
 * Networks. Home, Portfolio, Send, Receive, Add token and Bridge all use it,
 * always as the first control under the header (or the first row of the
 * balance plate) — or, on Portfolio, in the header itself at `size="sm"`,
 * beside the title, which is the placement the owner asked for there. Never
 * anywhere else, and never a second selector.
 */
import {
  Body,
  ChainMark,
  Column,
  Icon,
  Key,
  Pill,
  Pressable,
  Row,
  Sheet,
  paint,
} from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { formatFiat } from '../format'
import { t } from '../i18n'

export type ChainChoice = number | 'all'

export interface ChainOption {
  readonly id: ChainChoice
  readonly name: string
  readonly caption?: string | null
  /** Right-hand value: the balance held on that chain, or anything else short. */
  readonly value?: string | null
  readonly disabled?: boolean
  readonly reason?: string | null
  readonly action?: {
    readonly label: string
    readonly onPress: () => void
    readonly testID?: string
  }
}

/** The pill. `size="md"` in a plate's first row; `size="sm"` beside a title. */
export function ChainSelectPill({
  chainId,
  label,
  onPress,
  size = 'md',
  testID,
}: {
  chainId: ChainChoice | null
  label: string
  onPress: () => void
  size?: 'sm' | 'md'
  testID?: string
}) {
  const icon =
    chainId === 'all' ? (
      <Icon name="globe" size={size === 'sm' ? 14 : 16} color={paint.arc} />
    ) : chainId !== null ? (
      <ChainMark chainId={chainId} size={size === 'sm' ? 14 : 16} />
    ) : undefined
  return (
    <Pill
      label={label}
      icon={icon}
      chevron
      tone="ink"
      size={size}
      onPress={onPress}
      accessibilityLabel={t({
        id: 'chain.select.a11y',
        message: 'Chain: {c}',
        values: { c: label },
      })}
      testID={testID}
    />
  )
}

/** The chain's mark and name as a plain caption — for screens that only state their chain. */
export function ChainCaption({
  chainId,
  name,
  testID,
}: {
  chainId: number
  name: string
  testID?: string
}) {
  return (
    <Row gap={6} alignItems="center" testID={testID}>
      <ChainMark chainId={chainId} size={14} />
      <Body tone="mute" size="caption" numberOfLines={1}>
        {name}
      </Body>
    </Row>
  )
}

export function ChainSheet({
  open,
  onClose,
  title,
  options,
  selected,
  onSelect,
  footer,
  reducedMotion = false,
  testID = 'chain-sheet',
  rowTestID = (id) => `chain-${id}`,
}: {
  open: boolean
  onClose: () => void
  title: string
  options: readonly ChainOption[]
  selected: ChainChoice | null
  onSelect: (id: ChainChoice) => void
  footer?: React.ReactNode
  reducedMotion?: boolean
  testID?: string
  rowTestID?: (id: ChainChoice) => string
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      reducedMotion={reducedMotion}
      {...(footer ? { footer } : {})}
      testID={testID}
    >
      <Column gap={2}>
        {options.map((o) => {
          const isSelected = o.id === selected
          const off = o.disabled === true
          return (
            <Pressable
              key={String(o.id)}
              onPress={off ? undefined : () => onSelect(o.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: off }}
              accessibilityLabel={o.name}
              testID={rowTestID(o.id)}
              style={{ minHeight: 52, justifyContent: 'center', opacity: off ? 0.6 : 1 }}
            >
              <Row
                gap="$3"
                alignItems="center"
                paddingHorizontal={4}
                paddingVertical={6}
                borderRadius={12}
                backgroundColor={isSelected ? '$glass' : 'transparent'}
              >
                {o.id === 'all' ? (
                  <Row
                    width={28}
                    height={28}
                    borderRadius={14}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor="$glassRaised"
                  >
                    <Icon name="globe" size={16} color={paint.arc} />
                  </Row>
                ) : (
                  <ChainMark chainId={o.id} size={28} />
                )}
                <Column flex={1} minWidth={0} alignItems="flex-start">
                  <Body fontWeight={isSelected ? '600' : '400'} numberOfLines={1}>
                    {o.name}
                  </Body>
                  {off && o.reason ? (
                    <Body tone="mute" size="caption" numberOfLines={1}>
                      {o.reason}
                    </Body>
                  ) : o.caption ? (
                    <Body tone="mute" size="caption" numberOfLines={1}>
                      {o.caption}
                    </Body>
                  ) : null}
                </Column>
                {off && o.action ? (
                  <Pill
                    label={o.action.label}
                    size="sm"
                    onPress={o.action.onPress}
                    testID={o.action.testID}
                  />
                ) : (
                  <>
                    {o.value ? (
                      <Body tone={isSelected ? 'ink' : 'mute'} size="caption">
                        {o.value}
                      </Body>
                    ) : null}
                    <Row width={20} alignItems="center" justifyContent="center">
                      {isSelected ? <Icon name="check" size={18} color={paint.arc} /> : null}
                    </Row>
                  </>
                )}
              </Row>
            </Pressable>
          )
        })}
      </Column>
    </Sheet>
  )
}

/** A "Manage networks" key for a chain sheet's footer. */
export function ManageNetworksKey({
  onPress,
  testID = 'chain-networks',
}: {
  onPress: () => void
  testID?: string
}) {
  return (
    <Key
      label={t({ id: 'home.scope.manage', message: 'Manage networks' })}
      kind="secondary"
      size="compact"
      onPress={onPress}
      testID={testID}
    />
  )
}

/** What the account holds on each chain, from the last-good portfolio document (no refresh). */
export function useChainBalances(accountId: string | null): ReadonlyMap<number, string> {
  const engine = useEngine()
  const [map, setMap] = useState<ReadonlyMap<number, string>>(new Map())
  useEffect(() => {
    if (!accountId) {
      setMap(new Map())
      return
    }
    let alive = true
    /*
      Merged, never replaced. Snapshots are per chain scope now, so the events
      arriving here speak for different sets of chains — Home's "All chains"
      rebuild, then Send's single chain. Replacing the map with each one made
      every other chain's balance vanish and come back as the surfaces took
      turns refreshing.
    */
    const apply = (
      snapshot: {
        rows: ReadonlyArray<{ chainId: number; fiat: number | null }>
        currency: 'USD' | 'ETN'
      } | null,
    ): void => {
      if (!alive || !snapshot) return
      const sums = new Map<number, number>()
      for (const r of snapshot.rows) {
        if (r.fiat === null) continue
        sums.set(r.chainId, (sums.get(r.chainId) ?? 0) + r.fiat)
      }
      setMap((prev) => {
        const next = new Map(prev)
        for (const [chainId, v] of sums) next.set(chainId, formatFiat(v, snapshot.currency))
        return next
      })
    }
    engine.portfolio.cached({ accountId }).then(apply, () => undefined)
    const off = engine.events.subscribe((e) => {
      if (e.type === 'portfolio.snapshot' && e.snapshot.accountId === accountId) apply(e.snapshot)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, accountId])
  return map
}
