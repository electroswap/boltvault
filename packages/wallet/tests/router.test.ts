/**
 * The router (plan B2): a tab can carry a root with params that survives
 * pushes, `setTab` on the active tab pops the stack, and the current route
 * resolves top → root → plain tab.
 */
import { describe, expect, it } from 'vitest'
import { RouterStore, currentRoute } from '../src/navigation/router'

describe('RouterStore', () => {
  it('resolves the plain tab root when nothing was pushed or prefilled', () => {
    const s = new RouterStore()
    expect(currentRoute(s.get())).toEqual({ screen: 'home' })
    s.setTab('swap')
    expect(currentRoute(s.get())).toEqual({ screen: 'swap' })
  })

  it('setTab with params installs a root that survives a push and is replaced by the next prefill', () => {
    const s = new RouterStore()
    s.setTab('swap', { tokenIn: 'native', tokenOut: '0xb0lt' })
    expect(currentRoute(s.get())).toEqual({ screen: 'swap', params: { tokenIn: 'native', tokenOut: '0xb0lt' } })
    s.navigate({ screen: 'token', params: { chainId: 52014, address: '0xb0lt' } })
    expect(currentRoute(s.get()).screen).toBe('token')
    s.back()
    expect(currentRoute(s.get())).toEqual({ screen: 'swap', params: { tokenIn: 'native', tokenOut: '0xb0lt' } })
    s.setTab('swap', { tokenIn: 'native', tokenOut: '0xdyn0' })
    expect(currentRoute(s.get()).params).toEqual({ tokenIn: 'native', tokenOut: '0xdyn0' })
    // Switching away and back keeps the prefill; a plain setTab does not clear it.
    s.setTab('home')
    s.setTab('swap')
    expect(currentRoute(s.get()).params).toEqual({ tokenIn: 'native', tokenOut: '0xdyn0' })
  })

  it('setTab on the active tab pops the stack; back on an empty stack is a no-op', () => {
    const s = new RouterStore()
    s.navigate({ screen: 'portfolio' })
    s.navigate({ screen: 'token', params: { chainId: 52014, address: 'native' } })
    expect(s.get().stack).toHaveLength(2)
    s.setTab('home')
    expect(s.get().stack).toHaveLength(0)
    s.back()
    expect(currentRoute(s.get())).toEqual({ screen: 'home' })
  })

  it('replace swaps the top of the stack and notifies subscribers once per change', () => {
    const s = new RouterStore()
    let n = 0
    s.subscribe(() => {
      n += 1
    })
    s.navigate({ screen: 'settings' })
    s.replace({ screen: 'about' })
    expect(currentRoute(s.get())).toEqual({ screen: 'about' })
    expect(s.get().stack).toHaveLength(1)
    expect(n).toBe(2)
  })
})
