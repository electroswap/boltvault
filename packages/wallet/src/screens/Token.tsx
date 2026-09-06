/**
 * Token dossier (master plan §8.3): everything about one (chain, token).
 * Quantity from the chain; market data only where a source exists, and an
 * honest line where it does not. Keys: Send · Receive · Swap.
 */
import { Body, Chip, Column, Icon, Key, Plate, Row, ScrollView, TokenAvatar, metrics, paint, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AllowanceView, ChainView, TokenView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { usePortfolio } from '../hooks/usePortfolio'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'
import { formatChange, formatFiat, formatQuantity } from '../format'

export function Token({ chainId, address, body }: { chainId: number; address: string; body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { active } = useWalletState()
  const portfolio = usePortfolio(active?.id ?? null)
  const { entries } = useActivity(active?.id ?? null, chainId)
  const [token, setToken] = useState<TokenView | null>(null)
  const [chain, setChain] = useState<ChainView | null>(null)
  const [allowances, setAllowances] = useState<AllowanceView[]>([])
  const [bridgeable, setBridgeable] = useState(false)
  const [copied, setCopied] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.tokens.get({ chainId, address }).then(setToken, () => setToken(null))
    engine.chains.list().then((list) => setChain(list.find((c) => c.chainId === chainId) ?? null), () => undefined)
    engine.bridge.routes({ fromChainId: chainId, token: address }).then((rs) => setBridgeable(rs.length > 0), () => setBridgeable(false))
    if (active) engine.allowances.cached({ accountId: active.id, chainId }).then((c) => setAllowances(c.rows.filter((r) => r.token.toLowerCase() === address.toLowerCase())), () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'tokens.changed' && e.chainId === chainId) engine.tokens.get({ chainId, address }).then(setToken, () => undefined)
    })
  }, [engine, chainId, address, active])

  const row = portfolio.snapshot?.rows.find((r) => r.chainId === chainId && r.address.toLowerCase() === address.toLowerCase()) ?? null
  const isNative = address === 'native'
  const symbol = token?.symbol ?? row?.symbol ?? '…'
  const price = row && row.fiat !== null && Number(row.quantity) > 0 ? row.fiat / Number(row.quantity) : null
  const tokenActivity = entries.filter((e) => (e.token ?? (e.value !== '0' && !e.to?.startsWith('0x0000') ? 'native' : null)) === address || (isNative && e.category === 'SEND' && !e.token))
  const explorer = chain?.explorerUrl ? (isNative ? chain.explorerUrl : `${chain.explorerUrl}/token/${address}`) : null

  const copy = async (): Promise<void> => {
    if (!host.copy) return
    await host.copy(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="token">
      <PageHeader title={token?.symbol ?? ''} right={<><Chip>
          <Body tone="mute" size="caption">
            {chain?.name ?? `Chain ${chainId}`}
          </Body>
        </Chip></>} />

      <Row gap="$3" alignItems="center">
        <TokenAvatar chainId={chainId} address={isNative ? '0x0000000000000000000000000000000000000000' : address} logoUri={token?.logoUri ?? row?.logoUri ?? null} size={44} />
        <Column flex={1}>
          <Body size="title" testID="token-symbol">
            {symbol}
          </Body>
          <Body tone="mute" size="caption" numberOfLines={1}>
            {token?.name ?? row?.name ?? ''}
          </Body>
        </Column>
        {token?.source === 'user' || token?.source === 'dapp' ? (
          <Chip>
            <Body tone="mute" size="caption">
              {t({ id: 'token.custom', message: 'Custom' })}
            </Body>
          </Chip>
        ) : null}
      </Row>

      <Plate role="raised" gap="$1" testID="token-balance">
        <Body tone="mute" size="caption">
          {t({ id: 'token.yours', message: 'Yours' })}
        </Body>
        <Body size="title">{row ? `${formatQuantity(row.quantity)} ${symbol}` : `0 ${symbol}`}</Body>
        <Row gap="$3">
          <Body tone="mute" size="caption">
            {row && row.fiat !== null ? formatFiat(row.fiat, portfolio.snapshot?.currency ?? 'USD') : t({ id: 'token.unpriced', message: 'No price available' })}
          </Body>
          {row && formatChange(row.change24h) ? (
            <Body tone={(row.change24h ?? 0) >= 0 ? 'surge' : 'burn'} size="caption">
              {formatChange(row.change24h)} {t({ id: 'home.today', message: 'today' })}
            </Body>
          ) : null}
        </Row>
      </Plate>

      <Row gap="$3" justifyContent="space-between" testID="token-keys">
        <Key label={t({ id: 'key.send', message: 'Send' })} kind="secondary" stacked onPress={() => router.navigate('send', { token: address, chainId })} icon={<Icon name="send" size={20} color={paint.ink} />} testID="token-send" />
        <Key label={t({ id: 'key.receive', message: 'Receive' })} kind="secondary" stacked onPress={() => router.navigate('receive', { token: address, chainId })} icon={<Icon name="receive" size={20} color={paint.ink} />} testID="token-receive" />
        {bridgeable ? <Key label={t({ id: 'key.bridge', message: 'Bridge' })} kind="secondary" stacked onPress={() => router.navigate('bridge', { chainId, token: address })} icon={<Icon name="bridge" size={20} color={paint.ink} />} testID="token-bridge" /> : null}
        <Key label={t({ id: 'key.swap', message: 'Swap' })} kind="secondary" stacked onPress={() => router.setTab('swap', isNative ? undefined : { tokenIn: 'native', tokenOut: address })} icon={<Icon name="swap" size={20} color={paint.ink} />} testID="token-swap" />
      </Row>

      <Plate gap="$1" testID="token-market">
        <Body size="title">{t({ id: 'token.market', message: 'Market' })}</Body>
        {price !== null ? (
          <Row justifyContent="space-between">
            <Body tone="mute" size="caption">
              {t({ id: 'token.price', message: 'Price' })}
            </Body>
            <Body size="caption">{formatFiat(price, portfolio.snapshot?.currency ?? 'USD')}</Body>
          </Row>
        ) : (
          <Body tone="mute" size="caption">
            {chainId === 52014 || chainId === 5201420 ? t({ id: 'token.market.none', message: 'Market data arrives from ElectroSwap once the wallet key is enabled on the API.' }) : t({ id: 'token.market.other', message: 'No safety or market data for tokens outside Electroneum.' })}
          </Body>
        )}
      </Plate>

      {!isNative ? (
        <Plate gap="$2" testID="token-contract">
          <Body size="title">{t({ id: 'token.contract', message: 'Contract' })}</Body>
          <Row justifyContent="space-between" gap="$2">
            <Body tone="mute" size="caption" fontFamily="$mono" flexShrink={1} numberOfLines={1}>
              {address}
            </Body>
            <Key label={copied ? t({ id: 'copied', message: 'Copied' }) : t({ id: 'copy', message: 'Copy' })} kind="secondary" onPress={copy} testID="token-copy" />
          </Row>
          <Row gap="$3">
            <Body tone="mute" size="caption">
              {t({ id: 'token.decimals', message: '{n} decimals', values: { n: token?.decimals ?? row?.decimals ?? 18 } })}
            </Body>
            {explorer && host.openUrl ? (
              <Body tone="arc" size="caption" onPress={() => void host.openUrl?.(explorer)} testID="token-explorer">
                {t({ id: 'token.explorer', message: 'Open in explorer' })}
              </Body>
            ) : null}
          </Row>
          <Row gap="$2" flexWrap="wrap">
            <Key label={token?.pinned ? t({ id: 'token.unpin', message: 'Unpin' }) : t({ id: 'token.pin', message: 'Pin to Home' })} kind="secondary" onPress={() => void engine.tokens.setPrefs({ chainId, address, pinned: !token?.pinned })} testID="token-pin" />
            <Key label={token?.hidden ? t({ id: 'token.show', message: 'Show' }) : t({ id: 'token.hide', message: 'Hide' })} kind="secondary" onPress={() => void engine.tokens.setPrefs({ chainId, address, hidden: !token?.hidden })} testID="token-hide" />
            {token?.source === 'user' || token?.source === 'dapp' ? <Key label={t({ id: 'token.remove', message: 'Remove' })} kind="danger" onPress={() => engine.tokens.removeCustom({ chainId, address }).then(() => router.back())} /> : null}
          </Row>
        </Plate>
      ) : null}

      {allowances.length ? (
        <Plate gap="$2" testID="token-allowances">
          <Body size="title">{t({ id: 'token.allowances', message: 'Allowances' })}</Body>
          {allowances.map((a) => (
            <Row key={`${a.spender}:${a.standard}`} justifyContent="space-between">
              <Body tone="mute" size="caption">
                {a.spenderName ?? shortAddress(a.spender)}
              </Body>
              <Body tone={a.amount === 'unlimited' ? 'burn' : 'mute'} size="caption">
                {a.amount === 'unlimited' ? t({ id: 'allow.unlimited', message: 'Unlimited' }) : a.amount === 'all' ? t({ id: 'allow.all', message: 'Every item' }) : formatQuantity(a.amount)}
              </Body>
            </Row>
          ))}
          <Body tone="arc" size="caption" onPress={() => router.navigate('allowances')}>
            {t({ id: 'token.allowances.manage', message: 'Manage approvals' })}
          </Body>
        </Plate>
      ) : null}

      <Plate gap="$2" testID="token-activity">
        <Body size="title">{t({ id: 'token.activity', message: 'Your activity' })}</Body>
        {tokenActivity.length === 0 ? (
          <Body tone="mute" size="caption">
            {t({ id: 'token.activity.none', message: 'Nothing yet with this token.' })}
          </Body>
        ) : (
          tokenActivity.slice(0, 5).map((e) => (
            <Row key={e.id} justifyContent="space-between">
              <Body size="caption" numberOfLines={1} flexShrink={1}>
                {e.statements[0] ?? e.category}
              </Body>
              <Body tone="mute" size="caption">
                {e.status}
              </Body>
            </Row>
          ))
        )}
      </Plate>
    </ScrollView>
  )
}
