/**
 * A farm (master plan §8.8): built around the Coil — the outer ring is the
 * duration multiplier with the dates to 2.0× and 2.5× engraved, the inner
 * ring the BOLT stair, the glow the rewards waiting. The position plate
 * ticks the pending DYNO per block (the one honest per-block motion).
 * Deposit shows the pair ratio, the BOLT boost stair and the dilution plate
 * before a second deposit; Withdraw is a slider with a live preview;
 * Collect discharges the coil into the readout.
 */
import { Body, Chip, Coil, Input, Key, Plate, Row, ScrollView, Sheet, Slider, Toggle, metrics, paint } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { FarmDepositQuote, FarmView, FarmWithdrawQuote } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { useEngine } from '../engine/EngineProvider'
import { useChainHead } from '../hooks/useChainHead'
import { formatFiat, formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'
type SheetKind = 'deposit' | 'withdraw' | null

function dateLabel(ms: number | null): string | null {
  if (ms === null) return null
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function Farm({ body, chainId, farmId, reducedMotion = false }: { body: BodyKind; chainId: number; farmId: number; reducedMotion?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const head = useChainHead(chainId)
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['farm'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [farm, setFarm] = useState<FarmView | null>(null)
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [lastEdited, setLastEdited] = useState<0 | 1>(0)
  const [bolt, setBolt] = useState('')
  const [quote, setQuote] = useState<FarmDepositQuote | null>(null)
  const [percent, setPercent] = useState(50)
  const [asNative, setAsNative] = useState(true)
  const [wq, setWq] = useState<FarmWithdrawQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The position ticks with the head: rewards really do accrue per block (§8.8).
  useEffect(() => {
    let alive = true
    engine.farm.farm({ chainId, farmId, ...(active ? { accountId: active.id } : {}) }).then((f) => alive && setFarm(f), (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [engine, chainId, farmId, active, head?.blockNumber, flow?.status])

  // Deposit quote as the user types; the other side follows the pool's ratio.
  useEffect(() => {
    if (sheet !== 'deposit' || !active) return
    const typed = lastEdited === 0 ? amount0 : amount1
    if (!typed.trim() && !bolt.trim()) {
      setQuote(null)
      return
    }
    let alive = true
    const id = setTimeout(() => {
      engine.farm.quoteDeposit({ accountId: active.id, chainId, farmId, ...(lastEdited === 0 ? { amount0 } : { amount1 }), ...(bolt.trim() ? { bolt } : {}) }).then(
        (q) => {
          if (!alive) return
          setQuote(q)
          if (farm) {
            if (lastEdited === 0) setAmount1(q.amount1Raw === '0' ? '' : formatRaw(q.amount1Raw, farm.decimals1).replace(/,/g, ''))
            else setAmount0(q.amount0Raw === '0' ? '' : formatRaw(q.amount0Raw, farm.decimals0).replace(/,/g, ''))
          }
        },
        () => alive && setQuote(null),
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [engine, sheet, active, chainId, farmId, lastEdited === 0 ? amount0 : amount1, bolt, lastEdited])

  useEffect(() => {
    if (sheet !== 'withdraw' || !active) return
    let alive = true
    engine.farm.quoteWithdraw({ accountId: active.id, chainId, farmId, percent, asNative }).then((q) => alive && setWq(q), () => alive && setWq(null))
    return () => {
      alive = false
    }
  }, [engine, sheet, active, chainId, farmId, percent, asNative])

  const run = async (fn: () => Promise<{ flowId: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      setSheet(null)
      setActive(r.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (flow) {
    const last = flow.steps[flow.steps.length - 1]?.step
    return <FlowPlate flow={flow} body={body} reducedMotion={reducedMotion} titles={{ working: t({ id: 'farm.working', message: 'Working…' }), done: last === 'collect' ? t({ id: 'farm.collected', message: 'Collected' }) : last === 'withdraw' ? t({ id: 'farm.withdrawn', message: 'Withdrawn' }) : t({ id: 'farm.deposited', message: 'Deposited' }) }} summary={farm?.name ?? null} onDone={dismiss} testID="farm-flow" />
  }

  const p = farm?.position ?? null
  const hasNative = farm ? [farm.symbol0, farm.symbol1].includes('ETN') || [farm.symbol0, farm.symbol1].includes('WETN') : false
  const glow = p ? Math.min(1, Number(BigInt(p.pendingRewards) / 10n ** 18n) / 100) : 0

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="farm">
      <PageHeader title={farm ? farm.name || `${farm.symbol0}/${farm.symbol1}` : t({ id: 'farm.title', message: 'Farm' })} />
      {farm ? (
        <>
          <Row justifyContent="center">
            <Coil durationMultiplier={p?.durationMultiplier ?? 10_000} boltMultiplier={p?.boltMultiplier ?? 10_000} glow={glow} size={body === 'extension-popup' ? 200 : 260} at2x={p ? dateLabel(p.at2x) : null} at25x={p ? dateLabel(p.at25x) : null} reducedMotion={reducedMotion} testID="coil" />
          </Row>
          <Row gap="$3" flexWrap="wrap" justifyContent="center">
            <Body tone="mute" size="caption">
              {farm.baseApy !== null ? t({ id: 'farm.apy', message: 'APY {a}%', values: { a: farm.baseApy.toFixed(1) } }) : t({ id: 'farm.apy.none', message: 'APY from ElectroSwap when reachable' })}
            </Body>
            {farm.thirdPartyApy !== null && farm.thirdParty ? (
              <Body tone="mute" size="caption">
                {t({ id: 'farm.apy3', message: '+{a}% {s}', values: { a: farm.thirdPartyApy.toFixed(1), s: farm.thirdParty.symbol } })}
              </Body>
            ) : null}
            {farm.tvlUsd !== null ? (
              <Body tone="mute" size="caption">
                {t({ id: 'farm.tvl', message: 'TVL {v}', values: { v: formatFiat(farm.tvlUsd, 'USD') } })}
              </Body>
            ) : null}
            <Body tone="mute" size="caption">
              {t({ id: 'farm.farmers', message: '{n} farmers', values: { n: farm.farmerCount } })}
            </Body>
          </Row>
          {p ? (
            <Plate role="raised" gap="$2" testID="farm-position">
              <Row justifyContent="space-between">
                <Body size="title">{t({ id: 'farm.yours', message: 'Your position' })}</Body>
                <Body tone="mute" size="caption">
                  {t({ id: 'farm.share', message: '{p}% of the farm', values: { p: (p.shareOfFarm * 100).toFixed(2) } })}
                </Body>
              </Row>
              <Body tone="mute" size="caption">
                {`${formatRaw(p.amount0, farm.decimals0)} ${farm.symbol0} · ${formatRaw(p.amount1, farm.decimals1)} ${farm.symbol1}`}
              </Body>
              <Row justifyContent="space-between" alignItems="center">
                <Body tone="arc" testID="farm-pending">
                  {t({ id: 'farm.pending', message: '{d} DYNO to collect', values: { d: formatRaw(p.pendingRewards, 18) } })}
                </Body>
                {farm.thirdParty && BigInt(p.pendingThirdParty) > 0n ? (
                  <Body tone="ember" size="caption">
                    {`+${formatRaw(p.pendingThirdParty, 18)} ${farm.thirdParty.symbol}`}
                  </Body>
                ) : null}
              </Row>
              <Body tone="mute" size="caption">
                {BigInt(p.boltDeposited) > 0n ? t({ id: 'farm.boost', message: '{b} BOLT boosting at {m}×', values: { b: formatRaw(p.boltDeposited, 18), m: (p.boltMultiplier / 10_000).toFixed(2) } }) : t({ id: 'farm.boost.none', message: 'No BOLT boost yet' })}
                {p.nextStair ? ` · ${t({ id: 'farm.nextStair', message: '{b} more BOLT for {m}×', values: { b: formatRaw(p.nextStair.more, 18), m: (p.nextStair.multiplier / 10_000).toFixed(2) } })}` : ''}
              </Body>
              {p.at25x !== null || p.at2x !== null ? (
                <Body tone="mute" size="caption">
                  {p.at2x !== null ? t({ id: 'farm.to2', message: '2.0× on {d}', values: { d: dateLabel(p.at2x) ?? '' } }) : ''}
                  {p.at2x !== null && p.at25x !== null ? ' · ' : ''}
                  {p.at25x !== null ? t({ id: 'farm.to25', message: '2.5× on {d}', values: { d: dateLabel(p.at25x) ?? '' } }) : ''}
                </Body>
              ) : (
                <Body tone="arc" size="caption">
                  {t({ id: 'farm.max', message: 'Full 2.5× duration bonus' })}
                </Body>
              )}
            </Plate>
          ) : (
            <Plate gap="$1" testID="farm-none">
              <Body tone="mute" size="caption">
                {t({ id: 'farm.none', message: 'Deposit both sides of the pair to start earning DYNO. Your multiplier grows with time and with BOLT deposited as a boost.' })}
              </Body>
            </Plate>
          )}
          {error ? <Body tone="burn">{error}</Body> : null}
          {active ? (
            <Row gap="$2" flexWrap="wrap" testID="farm-keys">
              <Key label={t({ id: 'farm.deposit', message: 'Deposit' })} disabled={busy || !farm.active} onPress={() => setSheet('deposit')} testID="farm-deposit" />
              {p ? <Key label={t({ id: 'farm.withdraw', message: 'Withdraw' })} kind="secondary" disabled={busy} onPress={() => setSheet('withdraw')} testID="farm-withdraw" /> : null}
              {p ? <Key label={t({ id: 'farm.collect', message: 'Collect' })} kind="secondary" disabled={busy || BigInt(p.pendingRewards) === 0n} onPress={() => void run(() => engine.farm.collect({ accountId: active.id, chainId, farmId, asNative: hasNative }))} testID="farm-collect" /> : null}
            </Row>
          ) : null}
          {p && BigInt(p.pendingRewards) > 0n && p.nextStair ? (
            <Plate gap="$1" testID="farm-boost-plate">
              <Body size="caption">{t({ id: 'farm.cb.title', message: 'Collect & boost' })}</Body>
              <Body tone="mute" size="caption">
                {t({ id: 'farm.cb.body', message: 'Collect your DYNO, swap it for BOLT, then deposit BOLT as a boost with your next deposit. Boosts land on the 50,000 or 100,000 BOLT stairs — you need {b} more for {m}×.', values: { b: formatRaw(p.nextStair.more, 18), m: (p.nextStair.multiplier / 10_000).toFixed(2) } })}
              </Body>
              <Key label={t({ id: 'farm.cb.swap', message: 'Swap DYNO for BOLT' })} kind="secondary" onPress={() => router.navigate('swap', { tokenIn: '0xEe432C220273e4F949007B4c1946562826Efa055', tokenOut: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1' })} testID="farm-cb-swap" />
            </Plate>
          ) : null}
        </>
      ) : null}

      <Sheet open={sheet === 'deposit'} onClose={() => setSheet(null)} title={t({ id: 'farm.deposit.title', message: 'Deposit' })} testID="farm-deposit-sheet">
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
          {farm ? (
            <>
              <Input value={amount0} onChange={(v) => { setLastEdited(0); setAmount0(v) }} placeholder="0" label={farm.symbol0} testID="farm-amount0" />
              <Input value={amount1} onChange={(v) => { setLastEdited(1); setAmount1(v) }} placeholder="0" label={farm.symbol1} testID="farm-amount1" />
              <Body tone="mute" size="caption">
                {t({ id: 'farm.ratio', message: 'The pool sets the ratio; unused amounts come back to you.' })}
              </Body>
              <Input value={bolt} onChange={setBolt} placeholder="0" label={t({ id: 'farm.boltBoost', message: 'BOLT boost (optional)' })} testID="farm-bolt" />
              <Row gap="$2" flexWrap="wrap">
                {['50000', '100000'].map((s) => {
                  const existing = p ? BigInt(p.boltDeposited) / 10n ** 18n : 0n
                  const more = BigInt(s) - existing
                  if (more <= 0n) return null
                  return (
                    <Chip key={s} onPress={() => setBolt(more.toString())} cursor="pointer" minHeight={44} justifyContent="center" testID={`farm-stair-${s}`}>
                      <Body tone="mute" size="caption">
                        {t({ id: 'farm.stair', message: '{b} → {m}×', values: { b: more.toString(), m: s === '50000' ? '1.05' : '1.15' } })}
                      </Body>
                    </Chip>
                  )
                })}
              </Row>
              {quote && p && quote.multiplierAfter !== quote.multiplierBefore ? (
                <Plate gap={2} testID="farm-dilution">
                  <Body tone="ember" size="caption">
                    {t({ id: 'farm.dilution', message: 'A second deposit re-weights your duration bonus: {a}× today → {b}× after this deposit. It climbs again from there.', values: { a: (quote.multiplierBefore / 10_000).toFixed(2), b: (quote.multiplierAfter / 10_000).toFixed(2) } })}
                  </Body>
                </Plate>
              ) : null}
              {quote?.boltStair && BigInt(quote.boltRaw) > 0n ? (
                <Body tone="arc" size="caption">
                  {t({ id: 'farm.stair.land', message: 'Lands on the {b} BOLT stair · {m}×', values: { b: formatRaw(quote.boltStair.total, 18), m: (quote.boltStair.multiplier / 10_000).toFixed(2) } })}
                </Body>
              ) : null}
              {quote && quote.problems.length ? (
                <Body tone="burn" size="caption" testID="farm-problem">
                  {quote.problems[0]}
                </Body>
              ) : null}
              {quote?.ok ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'farm.steps', message: '{n} signature{s}: the farm is allowed to pull each token once, then the deposit.', values: { n: quote.steps.length, s: quote.steps.length === 1 ? '' : 's' } })}
                </Body>
              ) : null}
              {error ? <Body tone="burn">{error}</Body> : null}
              <Key label={t({ id: 'farm.deposit', message: 'Deposit' })} disabled={busy || !quote?.ok} onPress={() => void run(() => engine.farm.deposit({ accountId: active?.id ?? '', chainId, farmId, ...(lastEdited === 0 ? { amount0 } : { amount1 }), ...(bolt.trim() ? { bolt } : {}) }))} testID="farm-deposit-go" />
            </>
          ) : null}
        </ScrollView>
      </Sheet>

      <Sheet open={sheet === 'withdraw'} onClose={() => setSheet(null)} title={t({ id: 'farm.withdraw.title', message: 'Withdraw' })} testID="farm-withdraw-sheet">
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
          {farm && p ? (
            <>
              <Slider value={percent} onChange={setPercent} testID="farm-slider" />
              <Row gap="$2">
                {[25, 50, 75, 100].map((n) => (
                  <Chip key={n} onPress={() => setPercent(n)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={percent === n ? paint.arc : undefined} testID={`farm-pct-${n}`}>
                    <Body tone={percent === n ? 'arc' : 'mute'} size="caption">
                      {`${n}%`}
                    </Body>
                  </Chip>
                ))}
              </Row>
              {hasNative ? <Toggle value={asNative} onChange={setAsNative} label={t({ id: 'farm.asNative', message: 'Receive ETN instead of WETN' })} testID="farm-as-native" /> : null}
              {wq ? (
                <Plate gap={2} testID="farm-withdraw-preview">
                  <Body size="caption">{t({ id: 'farm.w.leaves', message: 'What leaves the farm' })}</Body>
                  <Body tone="mute" size="caption">
                    {`${formatRaw(wq.amount0Raw, farm.decimals0)} ${farm.symbol0} · ${formatRaw(wq.amount1Raw, farm.decimals1)} ${farm.symbol1}`}
                  </Body>
                  <Body tone="arc" size="caption">
                    {t({ id: 'farm.w.collected', message: '{d} DYNO collected with it', values: { d: formatRaw(wq.rewardsRaw, 18) } })}
                  </Body>
                  {BigInt(wq.boltReturnedRaw) > 0n ? (
                    <Body tone="ember" size="caption">
                      {t({ id: 'farm.w.bolt', message: '{b} BOLT boost comes back — it only unlocks when you withdraw everything', values: { b: formatRaw(wq.boltReturnedRaw, 18) } })}
                    </Body>
                  ) : (
                    <Body tone="mute" size="caption">
                      {wq.keepsMultiplier ? t({ id: 'farm.w.keeps', message: 'You keep your duration multiplier. BOLT unlocks only when you withdraw everything.' }) : ''}
                    </Body>
                  )}
                  {wq.problems[0] ? (
                    <Body tone="burn" size="caption">
                      {wq.problems[0]}
                    </Body>
                  ) : null}
                </Plate>
              ) : null}
              {error ? <Body tone="burn">{error}</Body> : null}
              <Key label={t({ id: 'farm.withdraw', message: 'Withdraw' })} disabled={busy || !wq?.ok || percent === 0} onPress={() => void run(() => engine.farm.withdraw({ accountId: active?.id ?? '', chainId, farmId, percent, asNative: hasNative && asNative }))} testID="farm-withdraw-go" />
            </>
          ) : null}
        </ScrollView>
      </Sheet>
    </ScrollView>
  )
}
