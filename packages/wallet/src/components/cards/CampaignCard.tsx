/**
 * A launchpad campaign in a list (plan C6): the logo, the name and symbol,
 * a phase pill in the phase's tone, a bar of the current toward the launch
 * target with the target marked, the raise against the target. The alert
 * star shows only where an alert makes sense — before it goes live, or
 * while live and already followed (owner item L4).
 */
import { Body, Column, CurrentFill, IconButton, Pill, Plate, Row, SharedElement, TokenAvatar } from '@boltvault/ui'
import type { CampaignView } from '@boltvault/engine'
import { formatRaw } from '../../format'
import { t } from '../../i18n'
import { campaignSharedId } from '../../navigation/transitions'

export function phaseLabel(c: CampaignView, now = Math.floor(Date.now() / 1000)): string {
  const countdown = (): string => {
    const secs = c.phase === 'upcoming' ? c.starts - now : c.ends - now
    if (secs <= 0) return ''
    const d = Math.floor(secs / 86_400)
    const h = Math.floor((secs % 86_400) / 3600)
    return d > 0 ? t({ id: 'sky.days', message: '{d}d {h}h', values: { d, h } }) : t({ id: 'sky.hours', message: '{h}h {m}m', values: { h, m: Math.floor((secs % 3600) / 60) } })
  }
  switch (c.phase) {
    case 'live': {
      const left = countdown()
      return left ? t({ id: 'sky.live', message: 'Live · ends in {t}', values: { t: left } }) : t({ id: 'sky.live.now', message: 'Live now' })
    }
    case 'upcoming': {
      const left = countdown()
      return left ? t({ id: 'sky.upcoming', message: 'Starts in {t}', values: { t: left } }) : t({ id: 'sky.upcoming.soon', message: 'Starting soon' })
    }
    case 'awaiting_finalize':
      return t({ id: 'sky.finalizing', message: 'Waiting for the team to finalize' })
    case 'launched':
      return t({ id: 'sky.launched', message: 'Launched' })
    case 'failed':
      return t({ id: 'sky.failed', message: 'Did not reach its target' })
    case 'cancelled':
      return t({ id: 'sky.cancelled', message: 'Cancelled' })
  }
}

export function phaseTone(phase: CampaignView['phase']): 'arc' | 'mute' | 'surge' | 'burn' | 'ember' {
  return phase === 'live' ? 'arc' : phase === 'launched' ? 'surge' : phase === 'failed' || phase === 'cancelled' ? 'burn' : phase === 'awaiting_finalize' ? 'ember' : 'mute'
}

export function PhasePill({ c }: { c: CampaignView }) {
  return <Pill label={c.phase === 'live' ? t({ id: 'phase.live', message: 'Live' }) : c.phase === 'upcoming' ? t({ id: 'phase.upcoming', message: 'Upcoming' }) : c.phase === 'awaiting_finalize' ? t({ id: 'phase.finalizing', message: 'Finalizing' }) : c.phase === 'launched' ? t({ id: 'phase.launched', message: 'Launched' }) : c.phase === 'failed' ? t({ id: 'phase.failed', message: 'Failed' }) : t({ id: 'phase.cancelled', message: 'Cancelled' })} tone={phaseTone(c.phase)} size="sm" />
}

/** The raise as a bar of the current, with the launch target marked. */
export function RaiseBar({ fill, height = 6 }: { fill: number; height?: number }) {
  const pct = Math.max(0, Math.min(1, fill))
  return (
    <Column height={height} borderRadius={height / 2} backgroundColor="rgba(122, 140, 255, 0.16)" overflow="hidden" position="relative">
      <Column width={`${Math.round(pct * 100)}%`} height={height} overflow="hidden" position="relative">
        <CurrentFill />
      </Column>
    </Column>
  )
}

/** Whether an alert control makes sense for this campaign (owner item L4): before it goes live, or while live and already followed. */
export function alertable(c: CampaignView): boolean {
  return c.phase === 'upcoming' || (c.phase === 'live' && c.starred)
}

export function CampaignCard({ campaign: c, onPress, onStar }: { campaign: CampaignView; onPress: () => void; onStar?: () => void }) {
  return (
    // The cell becomes the campaign's hero (§7.7).
    <SharedElement id={campaignSharedId(c.chainId, c.pool)}>
      <Plate role="card" gap="$2" onPress={onPress} cursor="pointer" testID={`sky-${c.pool}`}>
        <Row gap="$3" alignItems="center">
          <TokenAvatar chainId={c.chainId} address={c.token.address ?? c.pool} symbol={c.token.symbol} logoUri={c.logoUrl} size={44} />
          <Column flex={1} minWidth={0} alignItems="stretch">
            <Row gap="$2" alignItems="center" alignSelf="stretch">
              <Body fontWeight="600" numberOfLines={1} flexShrink={1} minWidth={0}>
                {c.token.name}
              </Body>
              <Body tone="mute" size="caption">
                {c.token.symbol}
              </Body>
            </Row>
            <Body tone={phaseTone(c.phase)} size="caption" numberOfLines={1}>
              {phaseLabel(c)}
            </Body>
          </Column>
          {onStar && alertable(c) ? <IconButton icon="star" label={c.starred ? t({ id: 'watch.unstar', message: 'Stop alerts' }) : t({ id: 'campaign.star.short', message: 'Tell me when it goes live' })} active={c.starred} onPress={onStar} testID={`star-campaign-${c.pool}`} /> : null}
        </Row>
        <Row gap="$2" alignItems="center">
          <Column flex={1}>
            <RaiseBar fill={c.fill} />
          </Column>
          <Body tone="mute" size="caption">
            {t({ id: 'sky.raised', message: '{r} / {t} ETN', values: { r: formatRaw(c.raisedWei, 18), t: formatRaw(c.minEtnToLaunchWei, 18) } })}
          </Body>
        </Row>
      </Plate>
    </SharedElement>
  )
}
