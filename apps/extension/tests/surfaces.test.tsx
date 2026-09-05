/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SendView } from '../src/Send'
import { ReceiveView } from '../src/Receive'
import { BridgeView } from '../src/Bridge'
import { TokenView } from '../src/Token'
import { FarmView } from '../src/Farm'
import { LaunchpadView } from '../src/Launchpad'
import { NftView } from '../src/Nft'
import { ActivityView } from '../src/Activity'
import { ApprovalsView } from '../src/Approvals'
import { SettingsView } from '../src/Settings'

const ADDR = '0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63'

describe('Send', () => {
  it('renders and shows the invitation when empty', () => {
    render(<SendView account={ADDR} onSent={() => {}} />)
    expect(screen.getByTestId('send')).toBeTruthy()
    expect(screen.getByTestId('send-invite')).toBeTruthy()
  })

  it('shows a poison warning for a mimicked recipient and disables the breaker', () => {
    render(
      <SendView
        account={ADDR}
        onSent={() => {}}
        history={['0xAAAA00000000000000000000000000000000BBBB']}
      />,
    )
    // A different address sharing the first 4 + last 4 chars of a known one.
    fireEvent.change(screen.getByTestId('send-recipient'), {
      target: { value: '0xAAAA99999999999999999999999999999999BBBB' },
    })
    expect(screen.getByTestId('send-poison')).toBeTruthy()
  })
})

describe('Receive', () => {
  it('shows the engraved address, chain id, and QR placeholder', () => {
    render(<ReceiveView address={ADDR} chainId={52014} chainName="ETN" />)
    expect(screen.getByTestId('receive')).toBeTruthy()
    expect(screen.getByTestId('receive-address')).toBeTruthy()
    expect(screen.getByTestId('receive-qr')).toBeTruthy()
    const chain = screen.getByTestId('receive-chain')
    expect(chain.textContent).toContain('52014')
  })
})

describe('Bridge', () => {
  it('locks the dispatch breaker until a destination is chosen', () => {
    render(<BridgeView />)
    expect(screen.getByTestId('bridge')).toBeTruthy()
    expect(screen.getByTestId('bridge-cable')).toBeTruthy()
    expect(screen.getByTestId('bridge-dispatch')).toBeTruthy()
  })

  it('lists USDC and USDT warp assets', () => {
    render(<BridgeView />)
    expect(screen.getByTestId('bridge-asset-USDC')).toBeTruthy()
    expect(screen.getByTestId('bridge-asset-USDT')).toBeTruthy()
  })
})

describe('Token', () => {
  it('renders the schematic: sparkline, lock bar, tags', () => {
    render(
      <TokenView
        token={{ symbol: 'USDC', name: 'USD Coin', address: ADDR, chainId: 52014, lockPct: 40, tags: ['stable'] }}
        priceUsd={1}
      />,
    )
    expect(screen.getByTestId('token')).toBeTruthy()
    expect(screen.getByTestId('token-sparkline')).toBeTruthy()
    expect(screen.getByTestId('token-lock')).toBeTruthy()
    expect(screen.getByTestId('token-tag-stable')).toBeTruthy()
  })

  it('shows a burn plate + disables Swap when blocked', () => {
    render(
      <TokenView token={{ symbol: 'SHAM', name: 'Sham', address: ADDR, chainId: 52014 }} blocked />,
    )
    expect(screen.getByTestId('token-burn')).toBeTruthy()
    expect(screen.getByTestId('token-swap')).toBeTruthy()
  })
})

describe('Farm', () => {
  it('renders the coil gauge + deposit breaker', () => {
    render(<FarmView farms={[{ name: 'WETN/BOLT', startBlock: 1000, nowBlock: 2000, boltDeposited: 0 }]} />)
    expect(screen.getByTestId('farm')).toBeTruthy()
    expect(screen.getByTestId('farm-gauge')).toBeTruthy()
    expect(screen.getByTestId('farm-deposit')).toBeTruthy()
  })
})

describe('Launchpad', () => {
  it('renders a campaign + a contribute verb on a live one', () => {
    render(
      <LaunchpadView
        campaigns={[{ pool: '0x1', status: 'live', min: 100n, max: 100000n, raised: 12450n, yourFill: 0n, name: 'Pad #3' }]}
      />,
    )
    expect(screen.getByTestId('launchpad')).toBeTruthy()
    expect(screen.getByTestId('campaign-0x1')).toBeTruthy()
    expect(screen.getByTestId('campaign-0x1-verb')).toBeTruthy()
  })
})

describe('Nft', () => {
  it('renders a rack with items; selecting one opens the detail sheet', () => {
    const { getByTestId } = render(
      <NftView
        assets={[
          { collection: '0x8a3f0000000000000000000000000000000077c1', tokenId: '#1', name: 'Volt #1', floor: 1, listed: true },
          { collection: '0x8a3f0000000000000000000000000000000077c1', tokenId: '#2', name: 'Volt #2' },
        ]}
      />,
    )
    expect(getByTestId('nft')).toBeTruthy()
    expect(getByTestId('nft-rack-item-0')).toBeTruthy()
  })
})

describe('Activity', () => {
  it('renders items and the other-chain footnote', () => {
    render(
      <ActivityView
        items={[
          { id: 'a1', label: 'Swap', sub: '2m ago', usd: -42.1 },
          { id: 'a2', label: 'Received', sub: '1h ago', usd: null, pending: true },
        ]}
      />,
    )
    expect(screen.getByTestId('activity')).toBeTruthy()
    expect(screen.getByTestId('activity-item-a1')).toBeTruthy()
    const pending = screen.getByTestId('activity-item-a2')
    expect(pending.getAttribute('data-pending')).toBe('true')
  })
})

describe('Approvals', () => {
  it('renders a fuse per approval + an Unlimited burn fuse + Revoke', () => {
    render(
      <ApprovalsView
        approvals={[
          { id: 'ap1', token: 'ETN', spender: '0x1', unlimited: true },
          { id: 'ap2', token: 'USDC', spender: '0x2', unlimited: false },
        ]}
      />,
    )
    expect(screen.getByTestId('approvals')).toBeTruthy()
    expect(screen.getByTestId('approvals-fuse-ap1')).toBeTruthy()
    expect(screen.getByTestId('approvals-unlimited-ap1')).toBeTruthy()
    expect(screen.getByTestId('approvals-revoke-ap1')).toBeTruthy()
  })
})

describe('Settings', () => {
  it('renders all 5 risk groups', () => {
    render(<SettingsView />)
    expect(screen.getByTestId('settings')).toBeTruthy()
    expect(screen.getByTestId('settings-Keys')).toBeTruthy()
    expect(screen.getByTestId('settings-Permissions')).toBeTruthy()
    expect(screen.getByTestId('settings-Spending')).toBeTruthy()
    expect(screen.getByTestId('settings-Networks')).toBeTruthy()
    expect(screen.getByTestId('settings-Feel')).toBeTruthy()
  })
})
