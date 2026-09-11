/**
 * Approvals (master plan §8.13): every allowance the account has granted,
 * grouped by token; unlimited ones are the fat fuse. Revoke runs through the
 * same sheet as everything else (`internal:approvals`).
 */
import { Body, Chip, Column, Key, Plate, Row, ScrollView, metrics, paint, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AllowanceView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'
import { formatAmount } from '../format'

const ETN = 52014

export function Allowances({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const [rows, setRows] = useState<AllowanceView[]>([])
  const [at, setAt] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  const scan = (): void => {
    if (!active) return
    setScanning(true)
    setError(null)
    // Electroneum first, then every enabled chain (§8.13); rows carry their chain.
    engine.settings
      .get()
      .then(async (s) => {
        const all: AllowanceView[] = []
        for (const chainId of [ETN, ...s.enabledChains]) {
          const r = await engine.allowances.scan({ accountId: active.id, chainId }).catch(() => [] as AllowanceView[])
          all.push(...r)
        }
        setRows(all)
        setAt(Date.now())
        setScanning(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setScanning(false)
      })
  }

  useEffect(() => {
    if (!active) return
    let alive = true
    engine.allowances.cached({ accountId: active.id, chainId: ETN }).then((c) => {
      if (!alive) return
      setRows(c.rows)
      setAt(c.at)
      if (Date.now() - c.at > 60_000) scan()
    }, () => undefined)
    const off = engine.events.subscribe((e) => {
      if (e.type === 'allowances.changed' && e.accountId === active.id) {
        setRows(e.rows)
        setAt(Date.now())
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, active?.id])

  const unlimited = rows.filter((r) => r.amount === 'unlimited' || r.amount === 'all')
  const byToken = new Map<string, AllowanceView[]>()
  for (const r of rows) byToken.set(r.token.toLowerCase(), [...(byToken.get(r.token.toLowerCase()) ?? []), r])

  const revoke = (r: AllowanceView): void => {
    if (!active) return
    engine.allowances.revoke({ accountId: active.id, chainId: r.chainId, token: r.token, spender: r.spender, standard: r.standard }).then((res) => router.navigate('sign', { requestId: res.requestId }), (err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="allowances">
      <PageHeader title={t({ id: 'allow.title', message: 'Approvals' })} />
      <Plate role="raised" gap="$1" testID="allow-summary">
        <Body size="title" tone={unlimited.length ? 'burn' : 'ink'}>
          {unlimited.length ? t({ id: 'allow.summary.unlimited', message: '{n} unlimited', values: { n: unlimited.length } }) : t({ id: 'allow.summary.none', message: 'No unlimited approvals' })}
        </Body>
        <Body tone="mute" size="caption">
          {rows.length ? t({ id: 'allow.summary.body', message: '{n} contracts can move tokens from this account.', values: { n: rows.length } }) : t({ id: 'allow.summary.empty', message: 'Nothing can move your tokens without a signature.' })}
        </Body>
        <Row gap="$2" alignItems="center">
          <Key label={scanning ? t({ id: 'allow.scanning', message: 'Checking…' }) : t({ id: 'allow.rescan', message: 'Check again' })} kind="secondary" size="compact" disabled={scanning} onPress={scan} testID="allow-scan" />
          {at ? (
            <Body tone="mute" size="caption">
              {new Date(at).toLocaleTimeString()}
            </Body>
          ) : null}
        </Row>
      </Plate>
      {[...byToken.entries()].map(([token, list]) => (
        <Plate key={token} gap="$2" testID={`allow-token-${token}`}>
          <Body size="title">{list[0]?.tokenSymbol ?? shortAddress(token)}</Body>
          {list.map((r) => (
            <Column key={`${r.spender}:${r.standard}`} gap={4}>
              <Row justifyContent="space-between" alignItems="center" gap="$2">
                <Column flex={1}>
                  <Row gap="$2" alignItems="center">
                    <Body numberOfLines={1}>{r.spenderName ?? shortAddress(r.spender)}</Body>
                    {!r.known ? (
                      <Chip borderColor={paint.ember}>
                        <Body tone="ember" size="caption">
                          {t({ id: 'allow.unknown', message: 'Unknown' })}
                        </Body>
                      </Chip>
                    ) : null}
                  </Row>
                  <Body tone="mute" size="caption">
                    {r.standard === 'permit2' ? 'Permit2' : r.standard === 'erc721' ? t({ id: 'allow.operator', message: 'Collection operator' }) : t({ id: 'allow.erc20', message: 'Token allowance' })}
                    {r.expiration ? ` · ${t({ id: 'allow.until', message: 'until {d}', values: { d: new Date(r.expiration * 1000).toLocaleDateString() } })}` : ''}
                  </Body>
                </Column>
                <Body tone={r.amount === 'unlimited' || r.amount === 'all' ? 'burn' : 'ink'} size="caption" testID={`allow-amount-${r.spender}`}>
                  {/* `amount` is a raw uint256. Scale it, or say plainly that we cannot. */}
                  {r.amount === 'unlimited'
                    ? t({ id: 'allow.unlimited', message: 'Unlimited' })
                    : r.amount === 'all'
                      ? t({ id: 'allow.all', message: 'Every item' })
                      : r.decimals === null
                        ? t({ id: 'allow.raw', message: '{n} base units', values: { n: r.amount } })
                        : formatAmount(r.amount, r.decimals)}
                </Body>
                <Key label={t({ id: 'allow.revoke', message: 'Revoke' })} kind="danger" size="compact" onPress={() => revoke(r)} testID={`allow-revoke-${r.spender}`} />
              </Row>
            </Column>
          ))}
        </Plate>
      ))}
      {error ? <Body tone="burn">{error}</Body> : null}
    </ScrollView>
  )
}
