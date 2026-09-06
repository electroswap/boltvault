/**
 * PageHeader — ScreenHeader wired to the router (plan B1): Back pops the
 * stack, and in the popup an "Open in a full tab" control opens the same
 * screen in tab.html (the popup then closes).
 */
import { IconButton, ScreenHeader, type ScreenHeaderProps } from '@boltvault/ui'
import type { ReactNode } from 'react'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

export interface PageHeaderProps extends Omit<ScreenHeaderProps, 'onBack' | 'backLabel'> {
  /** No Back control (a tab root). */
  readonly root?: boolean
  readonly right?: ReactNode
  /** No expand control even in the popup (a flow that must not lose its state). */
  readonly noExpand?: boolean
}

export function PageHeader({ root = false, right, noExpand = false, ...rest }: PageHeaderProps) {
  const router = useRouter()
  const host = useHost()
  const canExpand = !noExpand && host.body === 'extension-popup' && !!host.openSecretScreen
  const expand = canExpand ? <IconButton icon="expand" label={t({ id: 'header.expand', message: 'Open in a full tab' })} onPress={() => host.openSecretScreen?.(router.current.screen)} testID="open-tab" /> : null
  const rightSlot =
    right || expand ? (
      <>
        {right}
        {expand}
      </>
    ) : undefined
  return <ScreenHeader {...rest} {...(root ? {} : { onBack: () => router.back() })} backLabel={t({ id: 'back', message: 'Back' })} {...(rightSlot ? { right: rightSlot } : {})} />
}
