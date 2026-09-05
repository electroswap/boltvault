/**
 * Links become navigation (master plan §5.3): `wc:` pairs, a launchpad link
 * remembers its referrer and opens the campaign, a payment link prefills
 * Send, a screen link navigates. Mounted once per body; the host supplies
 * the URLs. Nothing executes without the user's next tap.
 */
import { useEffect } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { parseLink, type LinkAction } from '../links'
import { useRouter } from '../navigation/router'

const ETN = 52014

export function useLinks(): void {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  useEffect(() => {
    const links = host.links
    if (!links) return
    const seen = new Set<string>()
    const act = async (url: string): Promise<void> => {
      if (seen.has(url)) return
      seen.add(url)
      const action: LinkAction | null = parseLink(url)
      if (!action) return
      switch (action.kind) {
        case 'wc':
          await engine.connect.pair({ uri: action.uri }).catch(() => undefined)
          return
        case 'launchpad': {
          await engine.launchpad.rememberFromLink({ url: action.url }).catch(() => undefined)
          router.navigate('campaign', { chainId: ETN, pool: action.pool })
          return
        }
        case 'pay':
          router.navigate('send', { to: action.to, ...(action.token ? { token: action.token } : {}), ...(action.chainId ? { chainId: action.chainId } : {}) })
          return
        case 'screen':
          if (action.screen === 'home' || action.screen === 'swap' || action.screen === 'explore' || action.screen === 'activity') router.setTab(action.screen)
          else if (action.screen === 'browser') router.navigate('browser', action.url ? { url: action.url } : undefined)
          else router.navigate(action.screen)
          return
      }
    }
    void links.initial().then((url) => (url ? act(url) : undefined))
    return links.subscribe((url) => void act(url))
  }, [engine, host, router])
}
