/**
 * Receive (master plan §8.5): a real QR etched on glass with the chain made
 * unmistakable. The QR encodes `ethereum:<address>@<chainId>` (EIP-681) so an
 * Ethereum scanner cannot mistake it, and "Request amount" builds a transfer
 * URI for a token.
 */
import { Body, Chip, Column, Icon, Input, Key, Plate, QR, Row, ScrollView, Signature, metrics, paint } from '@boltvault/ui'
import type { ChainView, TokenView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { parseUnits } from 'viem'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014

export function Receive({ body, token: initialToken }: { body: 'extension-popup' | 'extension-tab' | 'mobile'; token?: string }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { active } = useWalletState()
  const [chain, setChain] = useState<ChainView | null>(null)
  const [tokens, setTokens] = useState<TokenView[]>([])
  const [token, setToken] = useState(initialToken ?? 'native')
  const [amount, setAmount] = useState('')
  const [requesting, setRequesting] = useState(!!initialToken && initialToken !== 'native')
  const [copied, setCopied] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.chains.list().then((list) => setChain(list.find((c) => c.chainId === ETN) ?? null), () => undefined)
    engine.tokens.universe({ chainId: ETN }).then((u) => setTokens(u.filter((x) => !x.hidden)), () => undefined)
  }, [engine])

  if (!active) return null
  const address = active.address
  const selected = tokens.find((x) => x.address.toLowerCase() === token.toLowerCase())
  let uri = `ethereum:${address}@${ETN}`
  if (requesting && amount.trim()) {
    try {
      if (token === 'native') uri = `ethereum:${address}@${ETN}?value=${parseUnits(amount, 18).toString()}`
      else if (selected) uri = `ethereum:${selected.address}@${ETN}/transfer?address=${address}&uint256=${parseUnits(amount, selected.decimals).toString()}`
    } catch {
      // keep the plain address until the amount parses
    }
  }

  const copy = async (): Promise<void> => {
    if (!host.copy) return
    await host.copy(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14, alignItems: 'stretch' }} testID="receive">
      <Row justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'receive.title', message: 'Receive' })}</Body>
      </Row>

      <Plate role="raised" gap="$3" alignItems="center" testID="receive-plate">
        <QR value={uri} size={body === 'extension-popup' ? 200 : 240} testID="receive-qr" />
        <Chip>
          <Body tone="arc" size="caption" testID="receive-chain">
            {chain ? `${chain.name} · ${chain.chainId}` : `Electroneum · ${ETN}`}
          </Body>
        </Chip>
        <Row gap="$2" alignItems="center">
          <Signature address={address} size={24} />
          <Body size="caption">{active.label}</Body>
        </Row>
        <Body tone="mute" size="caption" fontFamily="$mono" textAlign="center" testID="receive-address">
          {address}
        </Body>
        <Key label={copied ? t({ id: 'copied', message: 'Copied' }) : t({ id: 'receive.copy', message: 'Copy address' })} onPress={copy} testID="receive-copy" />
      </Plate>

      <Plate gap="$2" testID="receive-request">
        <Row justifyContent="space-between">
          <Body size="title">{t({ id: 'receive.request', message: 'Request an amount' })}</Body>
          <Body tone="arc" size="caption" onPress={() => setRequesting((v) => !v)} testID="receive-request-toggle">
            {requesting ? t({ id: 'hide', message: 'Hide' }) : t({ id: 'show', message: 'Show' })}
          </Body>
        </Row>
        {requesting ? (
          <Column gap="$2">
            <Row gap="$2" flexWrap="wrap">
              {tokens.slice(0, 6).map((x) => (
                <Chip key={x.address} onPress={() => setToken(x.address)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={x.address === token ? paint.arc : undefined}>
                  <Body tone={x.address === token ? 'arc' : 'mute'} size="caption">
                    {x.symbol}
                  </Body>
                </Chip>
              ))}
            </Row>
            <Input value={amount} onChange={setAmount} placeholder="0" hint={t({ id: 'receive.request.hint', message: 'The code above updates with the amount.' })} testID="receive-amount" />
          </Column>
        ) : null}
      </Plate>

      <Body tone="mute" size="caption">
        {t({ id: 'receive.warning', message: 'This is Electroneum Smart Chain (52014). Send ETN here from an exchange that supports the smart chain. Do not send from the old Electroneum app.' })}
      </Body>
    </ScrollView>
  )
}
