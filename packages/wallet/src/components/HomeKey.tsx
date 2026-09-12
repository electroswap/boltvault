/**
 * The way home from a tab root.
 *
 * Swap and Activity are the two screens you can reach without pushing
 * anything, so they have no Back — and with the dock gone (owner: "I want to
 * get rid of the bottom dock ... make sure every screen has a back or a home
 * button") they would otherwise be rooms with no door. Everything else is a
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

export function HomeKey() {
  const router = useRouter()
  return <IconButton icon="home" label={t({ id: 'rail.home', message: 'Home' })} onPress={() => router.setTab('home')} testID="rail-home" />
}