/**
 * WalletConnect helpers (master plan §5.3): CAIP conversions, the peer's
 * origin, the approved namespaces (required chains must all be known; the
 * home chain is always in), and the scripted kit's proposal shape.
 */
import { describe, expect, it } from 'vitest'
import { FakeWalletKit, SessionProposalSchema, WC_EVENTS, WC_METHODS, buildNamespaces, caipAccount, caipChain, chainIdFromCaip, peerOrigin } from '../src'

const ME = '0x1111111111111111111111111111111111111111'

describe('CAIP helpers', () => {
  it('converts chain ids both ways and refuses non-EVM namespaces', () => {
    expect(caipChain(52014)).toBe('eip155:52014')
    expect(chainIdFromCaip('eip155:8453')).toBe(8453)
    expect(chainIdFromCaip('solana:mainnet')).toBeNull()
    expect(caipAccount(1, ME)).toBe(`eip155:1:${ME}`)
  })

  it('takes the registrable origin from the peer url only when it is http(s)', () => {
    expect(peerOrigin({ name: '', description: '', url: 'https://app.electroswap.io/swap?x=1', icons: [] })).toBe('https://app.electroswap.io')
    expect(peerOrigin({ name: '', description: '', url: 'javascript:alert(1)', icons: [] })).toBeNull()
    expect(peerOrigin({ name: '', description: '', url: '', icons: [] })).toBeNull()
  })
})

describe('approved namespaces', () => {
  const proposal = SessionProposalSchema.parse({ id: 1, proposer: { name: 'x', url: 'https://x.io' }, requiredNamespaces: { eip155: { chains: ['eip155:52014'], methods: ['personal_sign'], events: ['chainChanged'] } }, optionalNamespaces: { eip155: { chains: ['eip155:8453', 'eip155:999999'] } } })

  it('includes the home chain, every known required/optional chain, one account each, and the wallet methods', () => {
    const out = buildNamespaces({ proposal, knownChainIds: [52014, 1, 8453], address: ME, homeChainId: 52014 })
    if (!out.ok) throw new Error('unexpected')
    expect(out.chainIds).toEqual([52014, 8453])
    expect(out.namespaces.eip155.chains).toEqual(['eip155:52014', 'eip155:8453'])
    expect(out.namespaces.eip155.accounts).toEqual([`eip155:52014:${ME}`, `eip155:8453:${ME}`])
    expect(out.namespaces.eip155.methods).toEqual([...WC_METHODS])
    expect(out.namespaces.eip155.events).toEqual([...WC_EVENTS])
  })

  it('refuses when a required chain is unknown', () => {
    const out = buildNamespaces({ proposal, knownChainIds: [1, 8453], address: ME, homeChainId: 1 })
    expect(out).toEqual({ ok: false, missing: ['eip155:52014'] })
  })
})

describe('the scripted kit', () => {
  it('raises a proposal with the peer, the requirements and the Verify result', async () => {
    const kit = new FakeWalletKit({ verified: 'INVALID' })
    const seen: unknown[] = []
    kit.on('session_proposal', (p) => seen.push(p))
    await kit.pair({ uri: 'wc:abc@2?relay-protocol=irn&symKey=00' })
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ id: 1, verified: 'INVALID', verifiedOrigin: null, proposer: { name: 'ElectroSwap' } })
  })
})
