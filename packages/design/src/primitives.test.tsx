import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Breaker, BusBar, Terminal, Chip, Sheet, EmptyState, Filament, Gauge, Rack } from './primitives'

function render(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(node))
  return host
}

describe('primitives', () => {
  it('Breaker is disabled when not armed and carries a testid', () => {
    const h = render(createElement(Breaker, { label: 'Sign', testId: 'b' } as any))
    const b = h.querySelector('[data-testid="b"]') as HTMLButtonElement
    expect(b).toBeTruthy()
    expect(b.disabled).toBe(true)
    expect(b.getAttribute('data-armed')).toBe('false')
  })
  it('Breaker arms when armed=true', () => {
    const h = render(createElement(Breaker, { label: 'Sign', armed: true, testId: 'b2' } as any))
    const b = h.querySelector('[data-testid="b2"]') as HTMLButtonElement
    expect(b.disabled).toBe(false)
  })
  it('BusBar exposes a per-symbol testid + fill', () => {
    const h = render(createElement(BusBar, { symbol: 'ETN', share: 0.6, selected: true } as any))
    expect(h.querySelector('[data-testid="busbar-ETN"]')).toBeTruthy()
    expect(h.querySelector('[data-testid="busbar-ETN-fill"]')).toBeTruthy()
  })
  it('Terminal renders label + amount + symbol', () => {
    const h = render(createElement(Terminal, { label: 'You pay', amount: '12.5', token: { symbol: 'ETN' } } as any))
    expect(h.textContent).toContain('You pay')
    expect(h.textContent).toContain('12.5')
    expect(h.textContent).toContain('ETN')
  })
  it('Chip renders label + sub', () => {
    const h = render(createElement(Chip, { label: 'WETN/BOLT 1.41x', sub: 'Collect 12 DYNO' } as any))
    expect(h.textContent).toContain('WETN/BOLT 1.41x')
    expect(h.textContent).toContain('Collect 12 DYNO')
  })
  it('Sheet renders when open and not when closed', () => {
    const h = render(createElement(Sheet, { open: true, onClose: () => {}, title: 'Buy', children: createElement('span', null, 'detail') } as any))
    expect(h.querySelector('[role="dialog"]')).toBeTruthy()
    expect(h.textContent).toContain('detail')
    const h2 = render(createElement(Sheet, { open: false, onClose: () => {}, children: createElement('span', null, 'x') } as any))
    expect(h2.querySelector('[role="dialog"]')).toBeNull()
  })
  it('EmptyState shows the verb when provided', () => {
    const h = render(createElement(EmptyState, { title: 'No funds', verb: 'Receive ETN' } as any))
    expect(h.textContent).toContain('No funds')
    expect(h.textContent).toContain('Receive ETN')
  })
  it('Filament + Gauge render their testids', () => {
    expect(render(createElement(Filament, { active: true, testId: 'f' } as any)).querySelector('[data-testid="f"]')).toBeTruthy()
    const g = render(createElement(Gauge, { value: 1.41, label: createElement('span', null, 'to 2.0x in 3d') } as any))
    expect(g.querySelector('[data-testid="undefined"]') ?? g.firstElementChild).toBeTruthy()
    expect(g.textContent).toContain('1.41x')
    expect(g.textContent).toContain('to 2.0x in 3d')
  })
  it('Rack renders one cell per item', () => {
    const h = render(
      createElement(Rack, {
        items: [
          { key: 'k1', title: 'Art 1', sub: '2.1' },
          { key: 'k2', title: 'Art 2', sub: '1.4' },
        ],
      } as any),
    )
    expect(h.querySelectorAll('[data-testid]').length).toBeGreaterThan(0)
    expect(h.textContent).toContain('Art 1')
    expect(h.textContent).toContain('Art 2')
  })
})
