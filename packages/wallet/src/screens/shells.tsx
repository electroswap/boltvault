/**
 * Tab and push screens that M1 ships as designed shells: the structure, the
 * copy voice and the empty states are final; their data arrives with their
 * milestone (Settings M4, Sign M3).
 */
import { Body, Column, Icon, IconButton, Plate, Row, ScrollView, metrics, paint } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import { useOpenInTab } from '../hooks/useOpenInTab'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

type Body_ = 'extension-popup' | 'extension-tab' | 'mobile'
const insetFor = (body: Body_): number => (body === 'extension-popup' ? metrics.inset : metrics.insetWide)

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
  const openInTab = useOpenInTab()
  const groups: Array<{ id: string; title: string; rows: string[] }> = [
    { id: 'accounts', title: t({ id: 'settings.accounts', message: 'Accounts' }), rows: [t({ id: 'settings.accounts.rows', message: 'Seeds, backups, identity' })] },
    { id: 'security', title: t({ id: 'settings.security', message: 'Security' }), rows: [t({ id: 'settings.security.rows', message: 'Password, auto-lock, passkeys, hardware' })] },
    { id: 'spending', title: t({ id: 'settings.spending', message: 'Spending' }), rows: [t({ id: 'settings.spending.rows', message: 'Slippage, approvals, step-ups, wallet fee schedule' })] },
    { id: 'approvals', title: t({ id: 'settings.approvals', message: 'Approvals' }), rows: [t({ id: 'settings.approvals.rows', message: 'What contracts can move your tokens; revoke' })] },
    { id: 'sites', title: t({ id: 'settings.sites', message: 'Connected sites' }), rows: [t({ id: 'settings.sites.rows', message: 'Per-site chain and account' })] },
    { id: 'networks', title: t({ id: 'settings.networks', message: 'Networks' }), rows: [t({ id: 'settings.networks.rows', message: 'Which chains show, custom RPCs, testnet' })] },
    { id: 'addressBook', title: t({ id: 'settings.book', message: 'Address book' }), rows: [t({ id: 'settings.book.rows', message: 'Names for the addresses you send to' })] },
    { id: 'devices', title: t({ id: 'settings.devices', message: 'Devices & sync' }), rows: [t({ id: 'settings.devices.rows', message: 'Pair a phone or browser; move your vault' })] },
    { id: 'notifications', title: t({ id: 'settings.notifications', message: 'Notifications' }), rows: [t({ id: 'settings.notifications.rows', message: 'Watchlist alerts, campaigns going live, rewards and dividends' })] },
    { id: 'feel', title: t({ id: 'settings.feel', message: 'Appearance & feel' }), rows: [t({ id: 'settings.feel.rows', message: 'Motion, haptics, sound, currency' })] },
    { id: 'about', title: t({ id: 'settings.about', message: 'About' }), rows: [t({ id: 'settings.about.rows', message: 'Version, encryption, where fees go' })] },
  ]
  return (
    <ScrollView contentContainerStyle={{ padding: insetFor(body), gap: 12 }} testID="settings">
      <PageHeader title={t({ id: 'settings.title', message: 'Settings' })} right={<IconButton icon="lock" label={t({ id: 'settings.lock', message: 'Lock' })} onPress={() => void engine.vault.lock()} testID="lock-key" />} />
      {openInTab ? (
        <Plate role="card" gap={2} onPress={() => openInTab({ screen: 'settings' })} cursor="pointer" testID="settings-open-tab">
          <Row justifyContent="space-between" alignItems="center">
            <Row gap="$2" alignItems="center">
              <Icon name="expand" size={18} color={paint.arc} />
              <Body>{t({ id: 'settings.openTab', message: 'Open BoltVault in a full tab' })}</Body>
            </Row>
            <Icon name="chevronRight" size={18} color={paint.mute} />
          </Row>
        </Plate>
      ) : null}
      {groups.map((g) => {
        const target = g.id === 'accounts' ? 'accounts' : g.id === 'security' ? 'security' : g.id === 'devices' ? 'devices' : g.id === 'sites' ? 'sites' : g.id === 'approvals' ? 'allowances' : g.id === 'spending' ? 'spending' : g.id === 'notifications' ? 'alerts' : g.id === 'networks' ? 'networks' : g.id === 'addressBook' ? 'addressBook' : g.id === 'feel' ? 'feel' : g.id === 'about' ? 'about' : null
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
  return (
    <Column padding={insetFor(body)} gap="$4" testID="placeholder">
      <PageHeader title={title} />
      <Body tone="mute">{note}</Body>
    </Column>
  )
}
