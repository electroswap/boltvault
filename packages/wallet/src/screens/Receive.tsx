/**
 * Receive (master plan §8.5): a real QR etched on glass with the chain made
 * unmistakable. The QR encodes `ethereum:<address>@<chainId>` (EIP-681) so an
 * Ethereum scanner cannot mistake it, and "Request amount" builds a transfer
 * URI for a token.
 */
import { Body, Column, Icon, Input, Key, Pill, Plate, QR, Row, ScrollView, Signature, metrics, paint } from '@boltvault/ui'
import { ChainSelectPill, ChainSheet, ManageNetworksKey, useChainBalances } from '../components/ChainSelect'
import { PageHeader } from '../components/PageHeader'
import type { ChainView, TokenView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { parseUnits } from 'viem'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014

export function Receive({ body, token: initialToken, chainId: initialChainId }: { body: 'extension-popup' | 'extension-tab' | 'mobile'; token?: string; chainId?: number }) {
  const engine = useEngine()
  const host = useHost()
  const { active } = useWalletState()
  const router = useRouter()
  const [chain, setChain] = useState<ChainView | null>(null)
  const [tokens, setTokens] = useState<TokenView[]>([])
  const [chainId, setChainId] = useState(initialChainId ?? ETN)
  const [chainOpen, setChainOpen] = useState(false)
  const balances = useChainBalances(active?.id ?? null)
  const [chains, setChains] = useState<ChainView[]>([])
  const [enabled, setEnabled] = useState<number[]>([ETN])
  const [token, setToken] = useState(initialToken ?? 'native')
  const [amount, setAmount] = useState('')
  const [requesting, setRequesting] = useState(!!initialToken && initialToken !== 'native')
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)
  // The device round trip: `null` while nothing has been asked (§8.5).
  const [verify, setVerify] = useState<{ state: 'asking' | 'match' | 'problem'; message?: string } | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.chains.list().then((list) => {
      setChains(list)
      setChain(list.find((c) => c.chainId === chainId) ?? null)
    }, () => undefined)
    engine.settings.get().then((s) => setEnabled([ETN, ...s.enabledChains]), () => undefined)
    engine.tokens.universe({ chainId }).then((u) => setTokens(u.filter((x) => !x.hidden)), () => undefined)
  }, [engine, chainId])

  if (!active) return null
  const address = active.address
  const selected = tokens.find((x) => x.address.toLowerCase() === token.toLowerCase())
  let uri = `ethereum:${address}@${chainId}`
  if (requesting && amount.trim()) {
    try {
      if (token === 'native') uri = `ethereum:${address}@${chainId}?value=${parseUnits(amount, 18).toString()}`
      else if (selected) uri = `ethereum:${selected.address}@${chainId}/transfer?address=${address}&uint256=${parseUnits(amount, selected.decimals).toString()}`
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

  /*
    Share carries the chain in the text, never the address alone (§8.5): the
    same forty nibbles mean a different network on every chain, and the one
    mistake this screen exists to prevent is funds arriving somewhere the
    sender did not mean. Where the body has no share sheet — the extension —
    the link goes to the clipboard instead, which is the same payload by the
    only route the browser offers.
  */
  const chainName = chain?.name ?? 'Electroneum'
  const shareText = t({ id: 'receive.share.text', message: '{label} on {chain} (chain {id}): {address}', values: { label: active.label, chain: chainName, id: chainId, address } })
  const share = async (): Promise<void> => {
    const title = t({ id: 'receive.share.title', message: 'My {chain} address', values: { chain: chainName } })
    if (host.share) {
      await host.share({ title, text: shareText, url: uri }).catch(() => undefined)
      return
    }
    if (!host.copy) return
    await host.copy(`${shareText}\n${uri}`)
    setShared(true)
    setTimeout(() => setShared(false), 1500)
  }

  /*
    "Is the address on my screen the address my device holds?" is the only
    question a hardware account's Receive screen can answer that a software
    one cannot, and the device is the one that can answer it: `verifyAccount`
    asks it to render the address for this path and refuses if it renders a
    different one. A Keystone has no live channel — it shows its own addresses
    on its own screen — so it gets the instruction instead of a key.
  */
  const deviceName = active.kind === 'ledger' ? 'Ledger' : active.kind === 'trezor' ? 'Trezor' : active.kind === 'keystone' ? 'Keystone' : null
  const verifyOnDevice = async (): Promise<void> => {
    if (!active) return
    setVerify({ state: 'asking' })
    try {
      const r = await engine.hardware.verifyAccount({ accountId: active.id })
      setVerify(r.address.toLowerCase() === address.toLowerCase() ? { state: 'match' } : { state: 'problem', message: t({ id: 'receive.verify.differs', message: 'The device answered with a different address. Do not use this one.' }) })
    } catch (err) {
      setVerify({ state: 'problem', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <Column flex={1}>
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14, alignItems: 'stretch' }} testID="receive">
      <PageHeader title={t({ id: 'receive.title', message: 'Receive' })} subtitle={t({ id: 'receive.subtitle', message: 'Only send {c} assets to this address', values: { c: chain?.name ?? 'Electroneum' } })} />
      <Row testID="receive-chain">
        <ChainSelectPill chainId={chainId} label={chain?.name ?? 'Electroneum'} onPress={() => setChainOpen(true)} testID="receive-chain-select" />
      </Row>

      <Plate role="raised" gap="$3" alignItems="center" testID="receive-plate">
        <QR value={uri} size={body === 'extension-popup' ? 200 : 240} testID="receive-qr" />
        <Row gap="$2" alignItems="center">
          <Signature address={address} size={24} />
          <Body size="caption">{active.label}</Body>
        </Row>
        <Body tone="mute" size="caption" textAlign="center" testID="receive-address">
          {address}
        </Body>
        <Row gap="$2" flexWrap="wrap" justifyContent="center">
          <Key label={copied ? t({ id: 'copied', message: 'Copied' }) : t({ id: 'receive.copy', message: 'Copy address' })} size="compact" onPress={copy} testID="receive-copy" />
          <Key
            label={shared ? t({ id: 'receive.share.copied', message: 'Link copied' }) : t({ id: 'receive.share', message: 'Share' })}
            kind="secondary"
            size="compact"
            icon={<Icon name="share" size={16} color={paint.mute} />}
            onPress={share}
            testID="receive-share"
          />
        </Row>
      </Plate>

      {deviceName ? (
        <Plate gap="$2" testID="receive-verify">
          <Body size="title">{t({ id: 'receive.verify.title', message: 'Check it on your {d}', values: { d: deviceName } })}</Body>
          <Body tone="mute" size="caption">
            {t({ id: 'receive.verify.body', message: 'Malware can change an address on its way to the screen. Your {d} holds the keys, so what it shows is the address that can actually spend what arrives — compare the two, character for character.', values: { d: deviceName } })}
          </Body>
          {active.kind === 'keystone' ? (
            <Body tone="mute" size="caption" testID="receive-verify-keystone">
              {t({ id: 'receive.verify.keystone', message: 'A Keystone has no cable to ask over. Open the account on the device itself and compare the address it shows with the one above.' })}
            </Body>
          ) : (
            <>
              <Key
                label={verify?.state === 'asking' ? t({ id: 'receive.verify.asking', message: 'Look at the device…' }) : t({ id: 'receive.verify.key', message: 'Show the address on the device' })}
                kind="secondary"
                size="compact"
                disabled={verify?.state === 'asking'}
                onPress={verifyOnDevice}
                testID="receive-verify-key"
              />
              {verify?.state === 'match' ? (
                <Row gap="$2" alignItems="center" testID="receive-verify-match">
                  <Icon name="check" size={16} color={paint.arc} />
                  <Body tone="arc" size="caption">
                    {t({ id: 'receive.verify.match', message: 'The device shows this address. It is safe to receive here.' })}
                  </Body>
                </Row>
              ) : null}
              {verify?.state === 'problem' ? (
                <Body tone="burn" size="caption" testID="receive-verify-problem">
                  {verify.message}
                </Body>
              ) : null}
            </>
          )}
        </Plate>
      ) : null}

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
                <Pill key={x.address} label={x.symbol} selected={x.address === token} size="sm" onPress={() => setToken(x.address)} />
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
    <ChainSheet
      open={chainOpen}
      onClose={() => setChainOpen(false)}
      title={t({ id: 'receive.chain.title', message: 'Receive on' })}
      options={enabled.map((id) => ({ id, name: chains.find((c) => c.chainId === id)?.name ?? `Chain ${id}`, ...(id === ETN ? { caption: t({ id: 'home.scope.etn.caption', message: 'Your home chain' }) } : {}), value: balances.get(id) ?? null }))}
      selected={chainId}
      onSelect={(id) => {
        if (id !== 'all') {
          setChainId(id)
          setToken('native')
        }
        setChainOpen(false)
      }}
      footer={<ManageNetworksKey onPress={() => { setChainOpen(false); router.navigate('networks') }} testID="receive-networks" />}
      testID="receive-chain-sheet"
      rowTestID={(id) => `receive-chain-${id}`}
    />
    </Column>
  )
}
