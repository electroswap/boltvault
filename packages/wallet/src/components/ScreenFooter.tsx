/**
 * ScreenFooter — a screen's primary key pinned under its scroll region
 * (Send, Swap, Bridge): the key never scrolls away and a caption can sit
 * above it. Render it as a sibling of the ScrollView inside the screen's
 * root `Column flex={1}`; sheets come after it.
 */
import { Column } from '@boltvault/ui'
import type { ReactNode } from 'react'

export function ScreenFooter({ inset, maxWidth, children, testID }: { inset: number; maxWidth?: number; children: ReactNode; testID?: string }) {
  return (
    <Column borderTopWidth={1} borderTopColor="$edge" backgroundColor="$void" testID={testID}>
      <Column paddingHorizontal={inset} paddingTop={8} paddingBottom={12} gap="$2" {...(maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : {})}>
        {children}
      </Column>
    </Column>
  )
}
