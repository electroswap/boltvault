/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationView, type NotifyRequest } from '../src/Notification'
import { FullTab } from '../src/FullTab'
import { CoilCanvas } from '../src/CoilCanvas'

const REQ: NotifyRequest = {
  origin: 'app.electroswap.com',
  method: 'eth_sendTransaction',
  diffs: [
    { label: 'Out', value: '12.40 ETN' },
    { label: 'In', value: '≈ 12.38 ETN' },
  ],
  fee: 'Wallet fee 0.25% · 0.03 ETN',
  account: '0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63',
}

describe('NotificationView (G signing window)', () => {
  it('shows origin as the largest type + diffs + fee + Sign/Reject', () => {
    render(<NotificationView initial={REQ} />)
    expect(screen.getByTestId('notification')).toBeTruthy()
    expect(screen.getByTestId('notification-origin').textContent).toContain('app.electroswap.com')
    expect(screen.getByTestId('notification-diff-0')).toBeTruthy()
    expect(screen.getByTestId('notification-diff-1')).toBeTruthy()
    expect(screen.getByTestId('notification-fee').textContent).toContain('0.25%')
    expect(screen.getByTestId('notification-sign')).toBeTruthy()
    expect(screen.getByTestId('notification-reject')).toBeTruthy()
  })

  it('uses Connect (not Sign) for eth_requestAccounts', () => {
    render(
      <NotificationView
        initial={{ origin: 'dapp.io', method: 'eth_requestAccounts', diffs: [] }}
      />,
    )
    expect(screen.getByTestId('notification-connect')).toBeTruthy()
  })

  it('calls onDone with the chosen verb', () => {
    const onDone = vi.fn()
    render(<NotificationView initial={REQ} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('notification-sign'))
    expect(onDone).toHaveBeenCalledWith('Sign')
  })
})

describe('FullTab (G theater)', () => {
  it('renders the coil, full portfolio plate, and NFT shelf', () => {
    // FullTab drives the block heartbeat + portfolio through the `sw` singleton,
    // which reads globalThis.browser at call time — stub it for node/happy-dom.
    const row = { address: '0x1', symbol: 'ETN', name: 'Electroneum', decimals: 18, rawBalance: '1', quantity: '1', priceUsd: 0.04, usd: 0.04, share: 1, hidden: false, priced: true }
    ;(globalThis as any).browser = {
      runtime: {
        sendMessage: (m: any) =>
          Promise.resolve(
            m.type === 'bv:block:head'
              ? { ok: true, block: 4213887, chainId: 52014, at: Date.now() }
              : m.type === 'bv:portfolio'
                ? { ok: true, chainId: 52014, account: '0x1', native: row, rows: [], pricedTotalUsd: 12478, at: Date.now() }
                : { ok: true, usd: null, at: Date.now() },
          ),
      },
    }
    render(<FullTab />)
    expect(screen.getByTestId('full-tab')).toBeTruthy()
    expect(screen.getByTestId('ft-coil')).toBeTruthy()
    expect(screen.getByTestId('ft-portfolio')).toBeTruthy()
    expect(screen.getByTestId('ft-shelf')).toBeTruthy()
    expect(screen.getByTestId('ft-farm')).toBeTruthy()
  })
})

describe('CoilCanvas (G Canvas 2D)', () => {
  it('mounts a canvas', () => {
    render(<CoilCanvas progress={0.5} pulse={1234} active testId="coil-test" />)
    expect(screen.getByTestId('coil-test').tagName.toLowerCase()).toBe('canvas')
  })
})
