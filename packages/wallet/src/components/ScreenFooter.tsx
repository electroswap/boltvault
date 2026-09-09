/**
 * ScreenFooter — a screen's primary key pinned under its scroll region
 * (Send, Swap, Bridge): the key never scrolls away and a caption can sit
 * above it. Render it as a sibling of the ScrollView inside the screen's
 * root `Column flex={1}`; sheets come after it.
 */
import { Column, useInsets } from '@boltvault/ui'
import type { ReactNode } from 'react'

export function ScreenFooter({ inset, maxWidth, children, testID }: { inset: number; maxWidth?: number; children: ReactNode; testID?: string }) {
  // On a screen with no dock beneath it this footer IS the bottom edge, so it
  // owes the gesture bar its inset — otherwise the primary key is half under
  // the system's own handle, which is what happened to Send's "Review".
  const insets = useInsets()
  return (
    <Column borderTopWidth={1} borderTopColor="$edge" backgroundColor="$void" testID={testID}>
      <Column paddingHorizontal={inset} paddingTop={8} paddingBottom={12 + insets.bottom} gap="$2" {...(maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : {})}>
        {children}
      </Column>
    </Column>
  )
}
