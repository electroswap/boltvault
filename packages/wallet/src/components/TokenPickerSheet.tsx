/**
 * The token picker (plan B4): a fixed search field, 52 px rows with the
 * balance and its value, sorted held-by-value → held-by-quantity → pinned →
 * the list. A pasted address the list does not know resolves through
 * `tokens.search` and can be picked straight away.
 */
import { Body, Column, Input, Pressable, Row, Sheet, TokenAvatar } from '@boltvault/ui'
import type { PortfolioRow, TokenView } from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { formatFiat, formatQuantity } from '../format'
import { t } from '../i18n'

const ETN = 52014

export function TokenPickerSheet({ open, onClose, title, tokens, rows, currency, exclude, onPick, reducedMotion = false }: { open: boolean; onClose: () => void; title: string; tokens: readonly TokenView[]; rows: readonly PortfolioRow[]; currency: 'USD' | 'ETN'; exclude?: string; onPick: (address: string) => void; reducedMotion?: boolean }) {
  const engine = useEngine()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<TokenView[]>([])
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const held = useMemo(() => new Map(rows.map((r) => [r.address.toLowerCase(), r])), [rows])
  const q = query.trim().toLowerCase()
  const listed = useMemo(() => {
    const rank = (x: TokenView): [number, number] => {
      const r = held.get(x.address.toLowerCase())
      if (r && Number(r.quantity) > 0) return r.fiat !== null ? [0, -r.fiat] : [1, -Number(r.quantity)]
      return x.pinned ? [2, 0] : [3, 0]
    }
    return [...tokens]
      .filter((x) => !exclude || x.address.toLowerCase() !== exclude.toLowerCase())
      .filter((x) => !q || x.symbol.toLowerCase().includes(q) || x.name.toLowerCase().includes(q) || x.address.toLowerCase() === q)
      .sort((a, b) => {
        const [ra, sa] = rank(a)
        const [rb, sb] = rank(b)
        return ra !== rb ? ra - rb : sa - sb
      })
  }, [tokens, held, q, exclude])

  // A pasted address nobody lists: ask the chain for its name and offer it.
  useEffect(() => {
    if (!/^0x[0-9a-f]{40}$/.test(q) || listed.length > 0) {
      setFound([])
      return
    }
    let alive = true
    engine.tokens.search({ chainId: ETN, query: q }).then((r) => alive && setFound(r), () => alive && setFound([]))
    return () => {
      alive = false
    }
  }, [engine, q, listed.length])

  const shown = listed.length > 0 ? listed : found
  return (
    <Sheet open={open} onClose={onClose} title={title} reducedMotion={reducedMotion} header={<Input value={query} onChange={setQuery} placeholder={t({ id: 'swap.pick.search', message: 'Search by name or paste an address' })} autoFocus testID="swap-pick-search" />} testID="swap-picker">
      <Column gap={2}>
        {shown.map((x) => {
          const r = held.get(x.address.toLowerCase())
          return (
            <Pressable key={x.address} onPress={() => onPick(x.address)} accessibilityRole="button" accessibilityLabel={x.symbol} style={{ minHeight: 52, justifyContent: 'center' }} testID={`swap-pick-${x.symbol}`}>
              <Row gap="$3" alignItems="center" paddingVertical={6}>
                <TokenAvatar chainId={ETN} address={x.address} symbol={x.symbol} logoUri={x.logoUri} size={32} />
                <Column flex={1} minWidth={0} alignItems="flex-start">
                  <Row gap="$2" alignItems="center">
                    <Body fontWeight="600">{x.symbol}</Body>
                    {x.source === 'lookup' ? (
                      <Body tone="ember" size="caption">
                        {t({ id: 'swap.pick.new', message: 'Not on the list' })}
                      </Body>
                    ) : null}
                  </Row>
                  <Body tone="mute" size="caption" numberOfLines={1}>
                    {x.name}
                  </Body>
                </Column>
                {r && Number(r.quantity) > 0 ? (
                  <Column alignItems="flex-end">
                    <Body>{formatQuantity(r.quantity)}</Body>
                    {r.fiat !== null ? (
                      <Body tone="mute" size="caption">
                        {formatFiat(r.fiat, currency)}
                      </Body>
                    ) : null}
                  </Column>
                ) : null}
              </Row>
            </Pressable>
          )
        })}
        {shown.length === 0 ? (
          <Body tone="mute" size="caption" testID="swap-pick-empty">
            {/^0x[0-9a-f]{40}$/.test(q) ? t({ id: 'swap.pick.lookup', message: 'Looking that address up…' }) : t({ id: 'swap.pick.none', message: 'Nothing matches. Paste a token address to add it.' })}
          </Body>
        ) : null}
      </Column>
    </Sheet>
  )
}
