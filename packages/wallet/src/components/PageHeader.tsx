/**
 * PageHeader — ScreenHeader wired to the router (plan B1): Back pops the
 * stack, and in the popup an "Open in a full tab" control opens the same
 * screen (params included) in tab.html; the popup then closes (plan B2).
 */
import { IconButton, ScreenHeader, type ScreenHeaderProps } from '@boltvault/ui'
import type { ReactNode } from 'react'
import { useOpenInTab } from '../hooks/useOpenInTab'
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
  const openInTab = useOpenInTab()
  const expand =
    !noExpand && openInTab ? (
      <IconButton
        icon="expand"
        label={t({ id: 'header.expand', message: 'Open in a full tab' })}
        onPress={() => openInTab()}
        testID="open-tab"
      />
    ) : null
  const rightSlot =
    right || expand ? (
      <>
        {right}
        {expand}
      </>
    ) : undefined
  return (
    <ScreenHeader
      {...rest}
      {...(root ? {} : { onBack: () => router.back() })}
      backLabel={t({ id: 'back', message: 'Back' })}
      {...(rightSlot ? { right: rightSlot } : {})}
    />
  )
}
