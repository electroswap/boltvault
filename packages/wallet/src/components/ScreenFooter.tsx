/**
 * ScreenFooter — a screen's primary key pinned under its scroll region
 * (Send, Swap, Bridge): the key never scrolls away and a caption can sit
 * above it. Render it as a sibling of the ScrollView inside the screen's
 * root `Column flex={1}`; sheets come after it.
 */
import { Column } from '@boltvault/ui'
import type { ReactNode } from 'react'

export function ScreenFooter({ inset, children, testID }: { inset: number; children: ReactNode; testID?: string }) {
  /*
    Even above and below, and no inset of its own.

    It used to pad the bottom by `12 + insets.bottom`, from when nothing else
    claimed that space — so on a phone the key sat 8 px under the footer's rule
    and 36 px above the dock, which the owner spotted straight away. `TabShell`
    takes the bottom inset now: the dock's when there is one, the screen's when
    there is not. Adding it again here is counting it twice.
  */
  return (
    <Column borderTopWidth={1} borderTopColor="$edge" backgroundColor="$void" testID={testID}>
      {/* The shell caps the page width; a footer inside it is already the right width. */}
      <Column paddingHorizontal={inset} paddingVertical={12} gap="$2">
        {children}
      </Column>
    </Column>
  )
}
