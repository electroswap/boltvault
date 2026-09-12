import type { NotificationView } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

/** The inbox (plan A6): the list, the unread count for the dock badge, and mark-as-read. */
export function useNotifications(): {
  items: readonly NotificationView[]
  unread: number
  markRead: (ids?: string[]) => void
  clear: () => void
} {
  const engine = useEngine()
  const [items, setItems] = useState<readonly NotificationView[]>([])
  const load = useCallback(() => {
    engine.notifications.list().then(setItems, () => undefined)
  }, [engine])
  useEffect(() => {
    load()
    return engine.events.subscribe((e) => {
      if (e.type === 'notifications.changed') load()
    })
  }, [engine, load])
  const markRead = useCallback(
    (ids?: string[]) =>
      void engine.notifications.markRead(ids ? { ids } : undefined).catch(() => undefined),
    [engine],
  )
  const clear = useCallback(
    () => void engine.notifications.clear().catch(() => undefined),
    [engine],
  )
  return { items, unread: items.filter((n) => !n.read).length, markRead, clear }
}
