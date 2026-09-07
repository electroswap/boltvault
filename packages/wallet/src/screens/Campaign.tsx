/**
 * A campaign (master plan §8.9; plan C6, owner items L2–L4): a hero — the
 * banner or a wash of the current, the logo overlapping it, the name, the
 * symbol pill, who is behind it — a status console with a phase pill, the
 * raise as a rolling readout, a bar of the current with the target marked
 * and the plain sentence beneath; a stat strip (min · max · yours ·
 * claimable); the keys the state allows; the description with Read more;
 * link pills with real labels; the referral card. The alert control shows
 * only before launch, or while live and already followed.
 */
import { Artwork, Body, Column, CurrentFill, Icon, Input, Key, Pill, Plate, Pressable, RollingReadout, Row, ScrollView, Sheet, PageLoader, StatStrip, TokenAvatar, metrics, paint, shortAddress, type IconName } from '@boltvault/ui'
import type { CampaignView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { alertable, PhasePill, RaiseBar } from '../components/cards/CampaignCard'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { useLastGood } from '../hooks/useLastGood'
import { formatRaw } from '../format'
import { useHost } from '../host'
import { t } from '../i18n'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'
const LINKS: Array<{ key: 'website' | 'twitter' | 'telegram' | 'discord'; icon: IconName; label: () => string }> = [
  { key: 'website', icon: 'globe', label: () => t({ id: 'token.link.site', message: 'Website' }) },
  { key: 'twitter', icon: 'x', label: () => 'X' },
  { key: 'telegram', icon: 'telegram', label: () => 'Telegram' },
  { key: 'discord', icon: 'discord', label: () => 'Discord' },
]

export function Campaign({ body, chainId, pool, reducedMotion = false }: { body: BodyKind; chainId: number; pool: string; reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['launchpad'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const wide = body === 'extension-tab'
  const [loadedCampaign, setC] = useState<CampaignView | null>(null)
  const c = useLastGood(`campaign:${chainId}:${pool}`, loadedCampaign)
  const [sheet, setSheet] = useState(false)
  const [amount, setAmount] = useState('')
  const [expanded, setExpanded] = useState(false)
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
        return t({ id: 'campaign.live', message: 'Until {d}', values: { d: new Date(v.ends * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) } })
      case 'upcoming':
        return t({ id: 'campaign.upcoming', message: 'Starts {d}', values: { d: new Date(v.starts * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) } })
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
  const alertPill = c && alertable(c) ? <Pill label={c.starred ? t({ id: 'campaign.starred', message: 'Alerts on' }) : t({ id: 'campaign.alert', message: 'Alert me' })} icon={<Icon name="star" size={14} color={c.starred ? paint.ember : paint.mute} />} selected={c.starred} size="sm" onPress={() => void engine.watchlist[c.starred ? 'unstar' : 'star']({ kind: 'campaign', chainId, address: pool, label: c.token.symbol }).then(() => setC({ ...c, starred: !c.starred }))} testID="campaign-star" /> : null
  const links = c ? LINKS.filter((l) => !!c.links[l.key]) : []

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12, ...(wide ? { maxWidth: 640, width: '100%', alignSelf: 'center' } : {}) }} testID="campaign">
        <PageHeader title={c?.token.symbol ?? ''} right={alertPill ?? undefined} />
        {error && !c ? <Body tone="burn">{error}</Body> : null}
        {c ? (
          <>
            {/* The hero: the banner (or a wash of the current), the logo overlapping its edge. */}
            <Column testID="campaign-hero">
              <Column height={72} borderRadius={14} overflow="hidden" position="relative" backgroundColor="rgba(55, 166, 255, 0.10)">
                {c.bannerUrl ? (
                  <Artwork uri={c.bannerUrl} label={c.token.name} size={{ width: 1000, height: 72 }} radius={0} />
                ) : (
                  <Column position="absolute" left={0} right={0} top={0} bottom={0} opacity={0.35}>
                    <CurrentFill />
                  </Column>
                )}
                <Column position="absolute" left={0} right={0} bottom={0} height={36} backgroundColor="rgba(7,10,31,0.6)" />
              </Column>
              <Row gap="$3" alignItems="flex-end" marginTop={-28} paddingHorizontal={12}>
                <TokenAvatar chainId={chainId} address={c.token.address ?? pool} symbol={c.token.symbol} logoUri={c.logoUrl} size={56} />
                <Column flex={1} alignItems="flex-start" paddingBottom={4}>
                  <Body size="title" numberOfLines={1} testID="campaign-name">
                    {c.token.name}
                  </Body>
                  <Row gap="$2" alignItems="center">
                    <Pill label={c.token.symbol} size="sm" />
                    <Body tone="mute" size="caption" numberOfLines={1}>
                      {t({ id: 'campaign.by', message: 'by {a}', values: { a: c.creatorName ?? shortAddress(c.creator) } })}
                    </Body>
                  </Row>
                </Column>
              </Row>
            </Column>

            {/* The status console. */}
            <Plate role="console" gap="$2" padding={12} testID="campaign-status">
              <Row justifyContent="space-between" alignItems="center">
                <PhasePill c={c} />
                <Body tone="mute" size="caption" numberOfLines={1} flexShrink={1} textAlign="right">
                  {phaseText(c)}
                </Body>
              </Row>
              <Row alignItems="flex-end" gap="$2">
                <RollingReadout value={formatRaw(c.raisedWei, 18)} hero reducedMotion={reducedMotion} testID="campaign-raised" />
                <Body tone="mute" size="caption" marginBottom={6}>
                  {t({ id: 'campaign.raised.unit', message: 'ETN raised' })}
                </Body>
              </Row>
              <RaiseBar fill={c.fill} height={8} />
              <Body tone="mute" size="caption">
                {t({ id: 'campaign.target', message: '{p}% of the {t} ETN launch target · {n} contributors', values: { p: Math.round(c.fill * 100), t: formatRaw(c.minEtnToLaunchWei, 18), n: c.contributorCount } })}
              </Body>
            </Plate>

            <StatStrip
              small
              columns={wide ? 4 : 2}
              cells={[
                { label: t({ id: 'campaign.min', message: 'Min per wallet' }), value: c.minContributionWei ? `${formatRaw(c.minContributionWei, 18)} ETN` : '—' },
                { label: t({ id: 'campaign.max', message: 'Max per wallet' }), value: c.maxContributionWei && BigInt(c.maxContributionWei) > 0n ? `${formatRaw(c.maxContributionWei, 18)} ETN` : t({ id: 'campaign.nomax', message: 'No limit' }) },
                { label: t({ id: 'campaign.yours', message: 'Your contribution' }), value: `${formatRaw(c.contributedWei, 18)} ETN`, tone: BigInt(c.contributedWei) > 0n ? 'arc' : 'ink', testID: 'campaign-contributed' },
                { label: t({ id: 'campaign.claimable', message: 'Claimable' }), value: BigInt(c.claimableTokensRaw) > 0n ? `${formatRaw(c.claimableTokensRaw, c.token.decimals)} ${c.token.symbol}` : '—', tone: BigInt(c.claimableTokensRaw) > 0n ? 'ember' : 'ink' },
              ]}
              testID="campaign-limits"
            />

            {active && c.keys.length > 0 ? (
              <Row gap="$2" flexWrap="wrap" testID="campaign-keys">
                {c.keys.includes('contribute') ? (
                  <Column flex={1} minWidth={140}>
                    <Key label={t({ id: 'campaign.contribute', message: 'Contribute' })} disabled={busy} onPress={() => setSheet(true)} testID="campaign-contribute" />
                  </Column>
                ) : null}
                {c.keys.includes('claim_tokens') ? (
                  <Column flex={1} minWidth={140}>
                    <Key label={t({ id: 'campaign.claimTokens', message: 'Claim tokens' })} disabled={busy} onPress={() => void run(() => engine.launchpad.claim({ accountId: active.id, chainId, pool, kind: 'tokens' }))} testID="campaign-claim-tokens" />
                  </Column>
                ) : null}
                {c.keys.includes('claim_refund') ? (
                  <Column flex={1} minWidth={140}>
                    <Key label={t({ id: 'campaign.claimRefund', message: 'Claim refund' })} disabled={busy} onPress={() => void run(() => engine.launchpad.claim({ accountId: active.id, chainId, pool, kind: 'refund' }))} testID="campaign-claim-refund" />
                  </Column>
                ) : null}
                {c.keys.includes('claim_referral') ? (
                  <Column flex={1} minWidth={140}>
                    <Key label={t({ id: 'campaign.claimReferral', message: 'Claim referral rewards' })} kind="secondary" size="compact" disabled={busy} onPress={() => void run(() => engine.launchpad.claim({ accountId: active.id, chainId, pool, kind: 'referral' }))} testID="campaign-claim-referral" />
                  </Column>
                ) : null}
              </Row>
            ) : null}
            {error ? <Body tone="burn">{error}</Body> : null}

            {c.description ? (
              <Column gap={2} testID="campaign-about">
                <Body tone="mute" size="caption" numberOfLines={expanded ? undefined : 8}>
                  {c.description}
                </Body>
                {c.description.length > 320 ? (
                  <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }} testID="campaign-readmore">
                    <Body tone="arc" size="caption">
                      {expanded ? t({ id: 'less', message: 'Less' }) : t({ id: 'readmore', message: 'Read more' })}
                    </Body>
                  </Pressable>
                ) : null}
              </Column>
            ) : null}
            {links.length ? (
              <Row gap="$2" flexWrap="wrap" testID="campaign-links">
                {links.map((l) => (
                  <Pill key={l.key} label={l.label()} icon={<Icon name={l.icon} size={14} color={paint.mute} />} size="sm" onPress={() => void host.openUrl?.(c.links[l.key] ?? '')} testID={`campaign-link-${l.key}`} />
                ))}
              </Row>
            ) : null}
            {c.shareLink && c.affiliatePercent > 0 ? (
              <Plate role="card" gap="$2" testID="campaign-referral">
                <Body size="caption">{t({ id: 'campaign.ref', message: 'Share your link — you earn {p}% of contributions', values: { p: c.affiliatePercent } })}</Body>
                <Row gap="$2" alignItems="center">
                  <Body tone="mute" size="caption" numberOfLines={1} flexShrink={1}>
                    {`https://electroswap.io/share/${c.shareLink}`}
                  </Body>
                  <Pill label={copied ? t({ id: 'copied', message: 'Copied' }) : t({ id: 'copy', message: 'Copy' })} icon={<Icon name={copied ? 'check' : 'copy'} size={14} color={paint.mute} />} size="sm" onPress={() => void host.copy?.(`https://electroswap.io/share/${c.shareLink}`).then(() => setCopied(true))} testID="campaign-copy-link" />
                </Row>
                {BigInt(c.referralClaimableWei) > 0n ? (
                  <Body tone="ember" size="caption">
                    {t({ id: 'campaign.refEarned', message: '{a} ETN in referral rewards to claim', values: { a: formatRaw(c.referralClaimableWei, 18) } })}
                  </Body>
                ) : null}
              </Plate>
            ) : null}
          </>
        ) : error ? null : (
          <PageLoader reducedMotion={reducedMotion} testID="campaign-loading" />
        )}
      </ScrollView>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={t({ id: 'campaign.contribute.title', message: 'Contribute ETN' })} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'campaign.contribute', message: 'Contribute' })} disabled={busy || !(Number(amount) > 0)} onPress={() => void run(() => engine.launchpad.contribute({ accountId: active?.id ?? '', chainId, pool, amountEtn: amount }))} testID="campaign-contribute-go" />} testID="campaign-sheet">
        <Column gap="$3">
          <Input value={amount} onChange={setAmount} placeholder="0" label={t({ id: 'campaign.amount', message: 'Amount in ETN' })} autoFocus testID="campaign-amount" />
          {c?.minContributionWei ? (
            <Body tone="mute" size="caption">
              {t({ id: 'campaign.range', message: 'Between {a} and {b} ETN per wallet', values: { a: formatRaw(c.minContributionWei, 18), b: c.maxContributionWei && BigInt(c.maxContributionWei) > 0n ? formatRaw(c.maxContributionWei, 18) : '∞' } })}
            </Body>
          ) : null}
          <Body tone="mute" size="caption">
            {t({ id: 'campaign.contribute.body', message: 'Contributions are native ETN. If the campaign reaches its target you claim tokens after launch; if not, you claim a refund.' })}
          </Body>
          {error ? <Body tone="burn">{error}</Body> : null}
        </Column>
      </Sheet>
    </Column>
  )
}
