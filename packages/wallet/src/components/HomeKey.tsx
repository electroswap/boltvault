/**
 * The way home from a tab root, in the full tab.
 *
 * The dock is a phone's answer to navigation and the full tab does not show it
 * (see TabShell), so Swap and Activity — the two screens you can reach without
 * pushing anything — would otherwise have no way back. Everything else is a
 * push and already carries Back in the same corner, which is why this appears
 * on exactly those two: two controls doing one job in one corner is worse than
 * either alone.
 *
 * It goes INSIDE the screen's existing title row rather than above it. A rail
 * of its own would push every screen's content down by its own height, and a
 * control that moves the page to announce itself has cost more than it gave.
 */
import { IconButton } from '@boltvault/ui'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

/** `show` is the caller's body test; false renders nothing at all. */
export function HomeKey({ show }: { show: boolean }) {
  const router = useRouter()
  if (!show) return null
  return <IconButton icon="home" label={t({ id: 'rail.home', message: 'Home' })} onPress={() => router.setTab('home')} testID="rail-home" />
}
