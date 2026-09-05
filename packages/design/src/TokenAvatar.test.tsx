import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { TokenAvatar, pickLogo } from './TokenAvatar'

const ADDR = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'

describe('TokenAvatar', () => {
  it('starts on the identicon data-URI (never a blank disc)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(TokenAvatar, { chainId: 52014, address: ADDR } as any)))
    const img = host.querySelector('img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg/)
  })
  it('pickLogo returns the first candidate that loads', async () => {
    const calls: string[] = []
    // Only the ElectroSwap .svg candidate "loads".
    const probe = async (u: string) => {
      calls.push(u)
      return u.endsWith('.svg')
    }
    const winner = await pickLogo({ chainId: 52014, address: ADDR } as any, { probe })
    expect(winner).toBe(`https://static.electroswap.io/tokens/images/${ADDR}.svg`)
    expect(calls.length).toBeGreaterThan(0)
  })
  it('pickLogo returns null when nothing loads', async () => {
    const winner = await pickLogo({ chainId: 52014, address: ADDR } as any, { probe: async () => false })
    expect(winner).toBeNull()
  })
})
