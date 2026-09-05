import type { WalletEngine } from '@boltvault/engine'
import { TamaguiProvider, tamaguiConfig } from '@boltvault/ui'
import { I18nProvider } from '@lingui/react'
import { useMemo } from 'react'
import { EngineProvider } from './engine/EngineProvider'
import { i18n, setupI18n } from './i18n'
import { RouterProvider, RouterStore } from './navigation/router'
import { TabShell } from './navigation/TabShell'
import type { ScreenId, TabId } from './navigation/registry'
import type { HomeProps } from './screens/Home'

export interface AppProps {
  readonly engine: WalletEngine
  readonly body: HomeProps['body']
  /** Harness/deep-link: start on a tab or pushed screen. */
  readonly initialTab?: TabId
  readonly initialScreen?: ScreenId
  /** Harness override; production reads the OS setting from the engine. */
  readonly reducedMotion?: boolean
}

/** The shared root for every body. */
export function App({ engine, body, initialTab, initialScreen, reducedMotion }: AppProps) {
  const router = useMemo(() => {
    setupI18n()
    const store = new RouterStore({ tab: initialTab ?? 'home' })
    if (initialScreen && !['home', 'swap', 'explore', 'activity'].includes(initialScreen)) store.navigate({ screen: initialScreen })
    return store
  }, [initialTab, initialScreen])
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <I18nProvider i18n={i18n}>
        <EngineProvider engine={engine}>
          <RouterProvider store={router}>
            <TabShell body={body} reducedMotionOverride={reducedMotion} />
          </RouterProvider>
        </EngineProvider>
      </I18nProvider>
    </TamaguiProvider>
  )
}
