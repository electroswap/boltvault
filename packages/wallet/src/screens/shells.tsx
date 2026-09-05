/**
 * Tab and push screens that M1 ships as designed shells: the structure, the
 * copy voice and the empty states are final; their data arrives with their
 * milestone (Swap M5, Explore/Activity M4–M6, Settings M4, Sign M3).
 */
import { Body, Column, Icon, Key, Plate, Row, ScrollView, Segmented, metrics, paint } from '@boltvault/ui'
import { useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

type Body_ = 'extension-popup' | 'extension-tab' | 'mobile'
const insetFor = (body: Body_): number => (body === 'extension-popup' ? metrics.inset : metrics.insetWide)

export function SwapShell({ body }: { body: Body_ }) {
  const [mode, setMode] = useState<'swap' | 'limit'>('swap')
  return (
    <ScrollView contentContainerStyle={{ padding: insetFor(body), gap: 16 }} testID="swap">
      <Segmented
        options={[
          { id: 'swap', label: t({ id: 'swap.mode.swap', message: 'Swap' }) },
          { id: 'limit', label: t({ id: 'swap.mode.limit', message: 'Limit' }) },
        ]}
        value={mode}
        onChange={(id) => setMode(id as 'swap' | 'limit')}
      />
      <Plate role="raised" gap="$2" testID="terminal-in">
        <Body tone="mute" size="caption">
          {t({ id: 'swap.pay', message: 'You pay' })}
        </Body>
        <Row justifyContent="space-between">
          <Body size="title">0</Body>
          <Body size="title">ETN</Body>
        </Row>
      </Plate>
      <Row justifyContent="center">
        <Icon name="swap" color={paint.mute} />
      </Row>
      <Plate role="raised" gap="$2" testID="terminal-out">
        <Body tone="mute" size="caption">
          {t({ id: 'swap.receive', message: 'You receive' })}
        </Body>
        <Row justifyContent="space-between">
          <Body size="title">—</Body>
          <Body size="title">USDC</Body>
        </Row>
      </Plate>
      <Column gap="$1">
        <Row justifyContent="space-between">
          <Body tone="mute" size="caption">
            {t({ id: 'swap.impact', message: 'Price impact' })}
          </Body>
          <Body tone="mute" size="caption">
            —
          </Body>
        </Row>
        <Row justifyContent="space-between">
          <Body tone="mute" size="caption">
            {t({ id: 'swap.fee', message: 'Wallet fee' })}
          </Body>
          <Body tone="mute" size="caption">
            {t({ id: 'swap.fee.value', message: '0.50% · hold BOLT for less' })}
          </Body>
        </Row>
        <Row justifyContent="space-between">
          <Body tone="mute" size="caption">
            {t({ id: 'swap.min', message: 'Minimum received' })}
          </Body>
          <Body tone="mute" size="caption">
            —
          </Body>
        </Row>
      </Column>
      <Key label={mode === 'swap' ? t({ id: 'swap.key', message: 'Swap' }) : t({ id: 'swap.limit.key', message: 'Place order' })} disabled testID="swap-key" />
      <Body tone="mute" size="caption">
        {t({ id: 'swap.soon', message: 'Swapping arrives with the M5 milestone. Quotes are on-chain; every in-wallet swap pays the wallet fee to the fee sink.' })}
      </Body>
    </ScrollView>
  )
}

export function ExploreShell({ body }: { body: Body_ }) {
  return (
    <ScrollView contentContainerStyle={{ padding: insetFor(body), gap: 16 }} testID="explore">
      <Body size="title">{t({ id: 'explore.title', message: 'Explore Electroneum' })}</Body>
      {(['tokens', 'collectibles', 'launch', 'farms'] as const).map((k) => (
        <Plate key={k} gap="$1">
          <Body size="title">
            {k === 'tokens' ? t({ id: 'explore.tokens', message: 'Tokens' }) : k === 'collectibles' ? t({ id: 'explore.collectibles', message: 'Collectibles' }) : k === 'launch' ? t({ id: 'explore.launch', message: 'Launch' }) : t({ id: 'explore.farms', message: 'Farms' })}
          </Body>
          <Body tone="mute" size="caption">
            {t({ id: 'explore.soon', message: 'Markets are on Electroneum. This list fills in with the M6 milestone.' })}
          </Body>
        </Plate>
      ))}
    </ScrollView>
  )
}

export function ActivityShell({ body }: { body: Body_ }) {
  return (
    <ScrollView contentContainerStyle={{ padding: insetFor(body), gap: 16 }} testID="activity">
      <Body size="title">{t({ id: 'activity.title', message: 'Activity' })}</Body>
      <Plate gap="$2">
        <Body tone="mute">{t({ id: 'activity.empty', message: 'Nothing yet. Sends, swaps and everything the wallet signs will appear here, with what you were shown when you signed.' })}</Body>
      </Plate>
    </ScrollView>
  )
}

export function SettingsShell({ body }: { body: Body_ }) {
  const router = useRouter()
  const engine = useEngine()
  const groups: Array<{ id: string; title: string; rows: string[] }> = [
    { id: 'accounts', title: t({ id: 'settings.accounts', message: 'Accounts' }), rows: [t({ id: 'settings.accounts.rows', message: 'Seeds, backups, identity' })] },
    { id: 'security', title: t({ id: 'settings.security', message: 'Security' }), rows: [t({ id: 'settings.security.rows', message: 'Password, auto-lock, passkeys, hardware' })] },
    { id: 'spending', title: t({ id: 'settings.spending', message: 'Spending' }), rows: [t({ id: 'settings.spending.rows', message: 'Slippage, approvals, step-ups, wallet fee schedule' })] },
    { id: 'sites', title: t({ id: 'settings.sites', message: 'Connected sites' }), rows: [t({ id: 'settings.sites.rows', message: 'Per-site chain and account' })] },
    { id: 'networks', title: t({ id: 'settings.networks', message: 'Networks' }), rows: [t({ id: 'settings.networks.rows', message: 'Chains, custom RPCs, tokens' })] },
    { id: 'devices', title: t({ id: 'settings.devices', message: 'Devices & sync' }), rows: [t({ id: 'settings.devices.rows', message: 'Pair a phone or browser; move your vault' })] },
    { id: 'feel', title: t({ id: 'settings.feel', message: 'Appearance & feel' }), rows: [t({ id: 'settings.feel.rows', message: 'Motion, haptics, sound, currency' })] },
    { id: 'about', title: t({ id: 'settings.about', message: 'About' }), rows: [t({ id: 'settings.about.rows', message: 'Version, encryption, fee sink' })] },
  ]
  return (
    <ScrollView contentContainerStyle={{ padding: insetFor(body), gap: 12 }} testID="settings">
      <Row gap="$3" justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Key label={t({ id: 'settings.lock', message: 'Lock' })} kind="secondary" onPress={() => void engine.vault.lock()} icon={<Icon name="lock" size={18} color={paint.ink} />} testID="lock-key" />
      </Row>
      {groups.map((g) => {
        const target = g.id === 'accounts' ? 'accounts' : g.id === 'security' ? 'security' : g.id === 'devices' ? 'devices' : g.id === 'sites' ? 'sites' : null
        return (
          <Plate key={g.id} gap="$1" testID={`settings-${g.id}`} onPress={target ? () => router.navigate(target) : undefined} cursor={target ? 'pointer' : undefined}>
            <Row justifyContent="space-between">
              <Body size="title">{g.title}</Body>
              {target ? <Icon name="chevronRight" size={18} color={paint.mute} /> : null}
            </Row>
            {g.rows.map((r) => (
              <Body key={r} tone="mute" size="caption">
                {r}
              </Body>
            ))}
          </Plate>
        )
      })}
    </ScrollView>
  )
}

export function PlaceholderScreen({ body, title, note }: { body: Body_; title: string; note: string }) {
  const router = useRouter()
  return (
    <Column padding={insetFor(body)} gap="$4" testID="placeholder">
      <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
      <Body size="title">{title}</Body>
      <Body tone="mute">{note}</Body>
    </Column>
  )
}
