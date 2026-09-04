import { describe, expect, it, vi } from 'vitest'
import { pickLogo } from '../src/TokenAvatar'

const WETN = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'

function probeThatLoads(urls: Set<string>) {
  return async (url: string) => urls.has(url)
}

describe('pickLogo (T4.3 resolution walk)', () => {
  it('returns the first candidate that loads, in order', async () => {
    // Only the 2nd candidate (ElectroSwap static .svg) loads.
    const winner = await pickLogo(
      { chainId: 52014, address: WETN },
      { probe: probeThatLoads(new Set([`https://static.electroswap.io/tokens/images/${WETN}.svg`])) },
    )
    expect(winner).toBe(`https://static.electroswap.io/tokens/images/${WETN}.svg`)
  })

  it('prefers the list logoURI when it loads (first in the order)', async () => {
    const winner = await pickLogo(
      { chainId: 52014, address: WETN, logoURI: 'https://cdn.example.com/x.png' },
      { probe: probeThatLoads(new Set(['https://cdn.example.com/x.png', `https://static.electroswap.io/tokens/images/${WETN}.svg`])) },
    )
    expect(winner).toBe('https://cdn.example.com/x.png')
  })

  it('falls through to the next candidate when an earlier one 404s', async () => {
    const svg = `https://static.electroswap.io/tokens/images/${WETN}.svg`
    const png = `https://static.electroswap.io/tokens/images/${WETN}.png`
    const winner = await pickLogo(
      { chainId: 52014, address: WETN },
      { probe: probeThatLoads(new Set([png])) }, // svg (earlier) fails
    )
    expect(winner).toBe(png)
  })

  it('returns null when nothing loads (→ caller shows the identicon)', async () => {
    const winner = await pickLogo({ chainId: 52014, address: WETN }, { probe: probeThatLoads(new Set()) })
    expect(winner).toBeNull()
  })

  it('treats a throwing probe as a failure and keeps walking', async () => {
    const png = `https://static.electroswap.io/tokens/images/${WETN}.png`
    const probe: (u: string, t: number) => Promise<boolean> = async (u) => {
      if (u.endsWith('.svg')) throw new Error('boom')
      return u === png
    }
    const winner = await pickLogo({ chainId: 52014, address: WETN }, { probe })
    expect(winner).toBe(png)
  })

  it('passes the timeout to the probe', async () => {
    let seen = -1
    await pickLogo(
      { chainId: 52014, address: WETN },
      { probe: async (u, t) => { seen = t; return false }, timeoutMs: 1234 },
    )
    expect(seen).toBe(1234)
  })
})
