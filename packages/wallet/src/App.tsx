import type { WalletEngine } from '@boltvault/engine'
import { TamaguiProvider, tamaguiConfig } from '@boltvault/ui'
import { I18nProvider } from '@lingui/react'
import { useMemo } from 'react'
import { EngineProvider } from './engine/EngineProvider'
import { DEFAULT_RELAY, HostProvider, type UiHost } from './host'
import { i18n, setupI18n } from './i18n'
import { RouterProvider, RouterStore, type Route } from './navigation/router'
import { TabShell } from './navigation/TabShell'
import { isTabId, type ScreenId, type ScreenParams, type TabId } from './navigation/registry'
import type { HomeProps } from './screens/Home'

export interface AppProps {
  readonly engine: WalletEngine
  readonly body: HomeProps['body']
  /** Harness/deep-link: start on a tab or pushed screen. */
  readonly initialTab?: TabId
  readonly initialScreen?: ScreenId
  /** Params for `initialScreen` (the sign window passes its request id). */
  readonly initialParams?: ScreenParams[ScreenId]
  /** Harness override; production reads the OS setting from the engine. */
  readonly reducedMotion?: boolean
  /** Body capabilities; defaults to "secrets allowed, no passkeys" (the harness). */
  readonly host?: Partial<UiHost>
}

/** The shared root for every body. */
export function App({ engine, body, initialTab, initialScreen, initialParams, reducedMotion, host }: AppProps) {
  const router = useMemo(() => {
    setupI18n()
    const store = new RouterStore({ tab: initialTab ?? 'home' })
    if (initialScreen && isTabId(initialScreen)) {
      if (initialParams !== undefined) store.setTab(initialScreen, initialParams)
    } else if (initialScreen) {
      store.navigate(initialParams === undefined ? { screen: initialScreen } : ({ screen: initialScreen, params: initialParams } as Route))
    }
    return store
  }, [initialTab, initialScreen, initialParams])
  const uiHost = useMemo<UiHost>(
    () => ({ body: body === 'mobile' ? 'mobile' : body, secretsAllowed: body !== 'extension-popup', passkeys: null, relayUrl: DEFAULT_RELAY, ...host }),
    [body, host],
  )
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <I18nProvider i18n={i18n}>
        <EngineProvider engine={engine}>
          <HostProvider host={uiHost}>
            <RouterProvider store={router}>
              <TabShell body={body} reducedMotionOverride={reducedMotion} />
            </RouterProvider>
          </HostProvider>
        </EngineProvider>
      </I18nProvider>
    </TamaguiProvider>
  )
}
