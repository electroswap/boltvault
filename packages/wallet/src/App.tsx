import type { WalletEngine } from '@boltvault/engine'
import { TamaguiProvider, tamaguiConfig } from '@boltvault/ui'
import { EngineProvider } from './engine/EngineProvider'
import { Hello, type HelloProps } from './screens/Hello'

export interface AppProps {
  readonly engine: WalletEngine
  readonly body: HelloProps['body']
}

/** The shared root. Navigation (screen registry + adapters) lands in M1. */
export function App({ engine, body }: AppProps) {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <EngineProvider engine={engine}>
        <Hello body={body} />
      </EngineProvider>
    </TamaguiProvider>
  )
}
