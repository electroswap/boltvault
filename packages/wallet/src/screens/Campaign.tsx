/**
 * A campaign (master plan §8.9): header, the status plate from the binding
 * state table, the raise readout with its fill, min/max per wallet, your
 * contribution and claimables, the timeline, links, the referral plate, and
 * the keys the state allows — Contribute · Claim tokens · Claim refund ·
 * Claim referral rewards — each through the sheet.
 */
import { Artwork, Body, Chip, Column, Icon, Input, Key, Plate, RollingReadout, Row, ScrollView, Sheet, metrics, paint, shortAddress } from '@boltvault/ui'
import type { CampaignView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Campaign({ body, chainId, pool, reducedMotion = false }: { body: BodyKind; chainId: number; pool: string; reducedMotion?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const host = useHost()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['launchpad'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [c, setC] = useState<CampaignView | null>(null)
  const [sheet, setSheet] = useState(false)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    engine.launchpad.detail({ chainId, pool, ...(active ? { accountId: active.id } : {}) }).then((v) => alive && setC(v), (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)))
    const timer = setInterval(() => engine.launchpad.detail({ chainId, pool, ...(active ? { accountId: active.id } : {}) }).then((v) => alive && setC(v), () => undefined), 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [engine, chainId, pool, active, flow?.status])

  const run = async (fn: () => Promise<{ flowId: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      setSheet(false)
      setActive(r.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (flow) {
    const last = flow.steps[flow.steps.length - 1]?.step
    return <FlowPlate flow={flow} body={body} reducedMotion={reducedMotion} titles={{ working: t({ id: 'campaign.working', message: 'Working…' }), done: last === 'contribute' ? t({ id: 'campaign.contributed', message: 'Contributed' }) : t({ id: 'campaign.claimed', message: 'Claimed' }) }} summary={c?.token.name ?? null} onDone={dismiss} testID="campaign-flow" />
  }

  const phaseText = (v: CampaignView): string => {
    switch (v.phase) {
      case 'live':
        return t({ id: 'campaign.live', message: 'Live — taking contributions until {d}', values: { d: new Date(v.ends * 1000).toLocaleString('en-GB') } })
      case 'upcoming':
        return t({ id: 'campaign.upcoming', message: 'Starts {d}', values: { d: new Date(v.starts * 1000).toLocaleString('en-GB') } })
      case 'awaiting_finalize':
        return t({ id: 'sky.finalizing', message: 'Waiting for the team to finalize' })
      case 'launched':
        return t({ id: 'campaign.launched', message: 'Launched — the token is trading' })
      case 'failed':
        return t({ id: 'campaign.failed', message: 'Did not reach its target — contributions are refundable' })
      case 'cancelled':
        return t({ id: 'campaign.cancelled', message: 'Cancelled by the team — contributions are refundable' })
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="campaign">
      <Row justifyContent="space-between" alignItems="center">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        {c ? (
          <Chip onPress={() => engine.watchlist[c.starred ? 'unstar' : 'star']({ kind: 'campaign', chainId, address: pool, label: c.token.symbol }).then(() => setC({ ...c, starred: !c.starred }))} cursor="pointer" minHeight={44} justifyContent="center" testID="campaign-star">
            <Row gap="$1" alignItems="center">
              <Icon name="star" size={16} color={c.starred ? paint.ember : paint.mute} />
              <Body tone="mute" size="caption">
                {c.starred ? t({ id: 'campaign.starred', message: 'Alerts on' }) : t({ id: 'campaign.star', message: 'Tell me when it goes live' })}
              </Body>
            </Row>
          </Chip>
        ) : null}
      </Row>
      {error && !c ? <Body tone="burn">{error}</Body> : null}
      {c ? (
        <>
          <Row gap="$3" alignItems="center">
            <Artwork uri={c.logoUrl} label={c.token.symbol} size={56} />
            <Column flex={1}>
              <Body size="title" numberOfLines={1} testID="campaign-name">
                {c.token.name}
              </Body>
              <Body tone="mute" size="caption">
                {`${c.token.symbol} · ${t({ id: 'campaign.by', message: 'by {a}', values: { a: c.creatorName ?? shortAddress(c.creator) } })}`}
              </Body>
            </Column>
          </Row>
          <Plate role="raised" gap="$2" testID="campaign-status">
            <Body tone={c.phase === 'live' ? 'arc' : c.phase === 'failed' || c.phase === 'cancelled' ? 'burn' : 'mute'} size="caption">
              {phaseText(c)}
            </Body>
            <RollingReadout value={`${formatRaw(c.raisedWei, 18)} ETN`} reducedMotion={reducedMotion} testID="campaign-raised" />
            <Column height={6} borderRadius={3} backgroundColor="rgba(95,216,255,0.14)" overflow="hidden">
              <Column width={`${Math.round(c.fill * 100)}%`} height={6} backgroundColor={paint.arc} />
            </Column>
            <Body tone="mute" size="caption">
              {t({ id: 'campaign.target', message: '{p}% of the {t} ETN launch target · {n} contributors', values: { p: Math.round(c.fill * 100), t: formatRaw(c.minEtnToLaunchWei, 18), n: c.contributorCount } })}
            </Body>
          </Plate>
          <Row gap="$3" flexWrap="wrap" testID="campaign-limits">
            <Column minWidth={100}>
              <Body tone="mute" size="caption">
                {t({ id: 'campaign.min', message: 'Min per wallet' })}
              </Body>
              <Body>{c.minContributionWei ? `${formatRaw(c.minContributionWei, 18)} ETN` : '—'}</Body>
            </Column>
            <Column minWidth={100}>
              <Body tone="mute" size="caption">
                {t({ id: 'campaign.max', message: 'Max per wallet' })}
              </Body>
              <Body>{c.maxContributionWei && BigInt(c.maxContributionWei) > 0n ? `${formatRaw(c.maxContributionWei, 18)} ETN` : t({ id: 'campaign.nomax', message: 'No limit' })}</Body>
            </Column>
            <Column minWidth={100}>
              <Body tone="mute" size="caption">
                {t({ id: 'campaign.yours', message: 'Your contribution' })}
              </Body>
              <Body tone={BigInt(c.contributedWei) > 0n ? 'arc' : 'ink'} testID="campaign-contributed">{`${formatRaw(c.contributedWei, 18)} ETN`}</Body>
            </Column>
            {BigInt(c.claimableTokensRaw) > 0n ? (
              <Column minWidth={100}>
                <Body tone="mute" size="caption">
                  {t({ id: 'campaign.claimable', message: 'Claimable' })}
                </Body>
                <Body tone="ember">{`${formatRaw(c.claimableTokensRaw, c.token.decimals)} ${c.token.symbol}`}</Body>
              </Column>
            ) : null}
          </Row>
          {active ? (
            <Row gap="$2" flexWrap="wrap" testID="campaign-keys">
              {c.keys.includes('contribute') ? <Key label={t({ id: 'campaign.contribute', message: 'Contribute' })} disabled={busy} onPress={() => setSheet(true)} testID="campaign-contribute" /> : null}
              {c.keys.includes('claim_tokens') ? <Key label={t({ id: 'campaign.claimTokens', message: 'Claim tokens' })} disabled={busy} onPress={() => void run(() => engine.launchpad.claim({ accountId: active.id, chainId, pool, kind: 'tokens' }))} testID="campaign-claim-tokens" /> : null}
              {c.keys.includes('claim_refund') ? <Key label={t({ id: 'campaign.claimRefund', message: 'Claim refund' })} disabled={busy} onPress={() => void run(() => engine.launchpad.claim({ accountId: active.id, chainId, pool, kind: 'refund' }))} testID="campaign-claim-refund" /> : null}
              {c.keys.includes('claim_referral') ? <Key label={t({ id: 'campaign.claimReferral', message: 'Claim referral rewards' })} kind="secondary" disabled={busy} onPress={() => void run(() => engine.launchpad.claim({ accountId: active.id, chainId, pool, kind: 'referral' }))} testID="campaign-claim-referral" /> : null}
            </Row>
          ) : null}
          {error ? <Body tone="burn">{error}</Body> : null}
          {c.description ? (
            <Body tone="mute" size="caption" numberOfLines={8}>
              {c.description}
            </Body>
          ) : null}
          <Row gap="$2" flexWrap="wrap">
            {(['website', 'twitter', 'telegram', 'discord'] as const).map((k) => {
              const url = c.links[k]
              if (!url) return null
              return (
                <Chip key={k} onPress={() => host.openUrl?.(url)} cursor="pointer" minHeight={44} justifyContent="center">
                  <Row gap="$1" alignItems="center">
                    <Icon name="external" size={14} color={paint.mute} />
                    <Body tone="mute" size="caption">
                      {k}
                    </Body>
                  </Row>
                </Chip>
              )
            })}
          </Row>
          {c.shareLink && c.affiliatePercent > 0 ? (
            <Plate gap="$2" testID="campaign-referral">
              <Body size="caption">{t({ id: 'campaign.ref', message: 'Share your link — you earn {p}% of contributions', values: { p: c.affiliatePercent } })}</Body>
              <Row gap="$2" alignItems="center">
                <Body tone="mute" size="caption" numberOfLines={1} flexShrink={1}>
                  {`https://electroswap.io/share/${c.shareLink}`}
                </Body>
                <Key label={copied ? t({ id: 'copied', message: 'Copied' }) : t({ id: 'copy', message: 'Copy' })} kind="secondary" onPress={() => host.copy?.(`https://electroswap.io/share/${c.shareLink}`).then(() => setCopied(true))} testID="campaign-copy-link" />
              </Row>
              {BigInt(c.referralClaimableWei) > 0n ? (
                <Body tone="ember" size="caption">
                  {t({ id: 'campaign.refEarned', message: '{a} ETN in referral rewards to claim', values: { a: formatRaw(c.referralClaimableWei, 18) } })}
                </Body>
              ) : null}
            </Plate>
          ) : null}
        </>
      ) : null}

      <Sheet open={sheet} onClose={() => setSheet(false)} title={t({ id: 'campaign.contribute.title', message: 'Contribute ETN' })} testID="campaign-sheet">
        <Column padding={20} gap="$3">
          <Input value={amount} onChange={setAmount} placeholder="0" label={t({ id: 'campaign.amount', message: 'Amount in ETN' })} testID="campaign-amount" />
          {c?.minContributionWei ? (
            <Body tone="mute" size="caption">
              {t({ id: 'campaign.range', message: 'Between {a} and {b} ETN per wallet', values: { a: formatRaw(c.minContributionWei, 18), b: c.maxContributionWei && BigInt(c.maxContributionWei) > 0n ? formatRaw(c.maxContributionWei, 18) : '∞' } })}
            </Body>
          ) : null}
          <Body tone="mute" size="caption">
            {t({ id: 'campaign.contribute.body', message: 'Contributions are native ETN. If the campaign reaches its target you claim tokens after launch; if not, you claim a refund.' })}
          </Body>
          {error ? <Body tone="burn">{error}</Body> : null}
          <Key label={t({ id: 'campaign.contribute', message: 'Contribute' })} disabled={busy || !(Number(amount) > 0)} onPress={() => void run(() => engine.launchpad.contribute({ accountId: active?.id ?? '', chainId, pool, amountEtn: amount }))} testID="campaign-contribute-go" />
        </Column>
      </Sheet>
    </ScrollView>
  )
}
