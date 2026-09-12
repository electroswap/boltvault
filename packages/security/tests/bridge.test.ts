/**
 * The firewall on a Hyperlane transfer (master plan §3.4, §8.7): the
 * transferRemote decoder on a known warp router, the plain statements, and
 * RECIPIENT_NO_CODE_ON_DEST — a contract here with no code there is a block.
 */
import { encodeFunctionData, pad, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { WARP_ROUTER_ABI } from '../src/abis'
import { assess, emptyContext, type AssessmentInput } from '../src/assess'
import { decodeCalldata } from '../src/decode'
import { knownContract } from '../src/registry'
import type { SignRequest } from '../src/types'

const ME = '0x3333333333333333333333333333333333333333' as Hex
const ETH_USDC_ROUTER = '0xFC2944e9F1d57Ce82aeD05922887DD660404e50B' as Hex
const ETN_USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e' as Hex
const data = (dest: number, to: Hex, amount: bigint): Hex => encodeFunctionData({ abi: WARP_ROUTER_ABI, functionName: 'transferRemote', args: [dest, pad(to, { size: 32 }), amount] })
const tx = (chainId: number, to: Hex, calldata: Hex, value: bigint): SignRequest => ({ kind: 'transaction', tx: { from: ME, to, data: calldata, value, chainId } })

function run(chainId: number, request: SignRequest, ctx: Partial<Parameters<typeof emptyContext>[0]> = {}, origin = 'internal:bridge') {
  const input: AssessmentInput = { origin, chainId, account: ME, request, context: emptyContext(ctx) }
  return assess(input)
}

describe('bridge decoding', () => {
  it('knows the warp routers by (chainId, address) — the Avalanche router is not the ETN token', () => {
    expect(knownContract(1, ETH_USDC_ROUTER)?.role).toBe('warp_router')
    expect(knownContract(43114, ETN_USDC)?.role).toBe('warp_router')
    expect(knownContract(52014, ETN_USDC)?.name).toBe('Hyperlane USDC') // the synthetic is the router on Electroneum
    expect(knownContract(56, ETN_USDC)).toBeNull()
  })

  it('decodes transferRemote on a known router into a bridge with the unpadded recipient', () => {
    const d = decodeCalldata({ chainId: 1, to: ETH_USDC_ROUTER, data: data(52014, ME, 100_000_000n), value: 10n ** 15n })
    expect(d).toMatchObject({ kind: 'bridge', router: ETH_USDC_ROUTER, destinationDomain: 52014, recipient: ME, amount: 100_000_000n, value: 10n ** 15n })
    // The same calldata to an unknown address is not a bridge.
    const u = decodeCalldata({ chainId: 1, to: '0x4444444444444444444444444444444444444444', data: data(52014, ME, 1n), value: 0n })
    expect(u?.kind).not.toBe('bridge')
  })

  it('states the bridge in plain words with the interchain gas', () => {
    const a = run(1, tx(1, ETH_USDC_ROUTER, data(52014, ME, 100_000_000n), 10n ** 15n))
    // The signer's own address reads as "yourself" rather than as hex.
    expect(a.statements.map((s) => s.text)).toEqual(['Bridge 100 USDC to Electroneum for yourself', 'Pays 0.001 native of interchain gas to Hyperlane'])
    expect(a.severity).toBe('info')
  })

  /*
    ES-BV-027. A bridged transfer lands on another chain and cannot be
    recalled, and it was the one transfer the wallet showed as `0x1234…abcd` —
    the exact shape address poisoning is built to satisfy — while `recipientOf`
    returned null for it, so no recipient rule could see it at all.
  */
  it('prints a stranger destination in full and runs the recipient rules on it', () => {
    const LOOKALIKE = '0x3333444444444444444444444444444444443333' as Hex
    const a = run(1, tx(1, ETH_USDC_ROUTER, data(52014, LOOKALIKE, 100_000_000n), 10n ** 15n))
    expect(a.statements[0]?.text).toContain(LOOKALIKE)
    // And the reference set applies: an address built to look like one the
    // user has sent to is caught, which it could not be while `recipientOf`
    // answered null for every bridge.
    const poisoned = run(1, tx(1, ETH_USDC_ROUTER, data(52014, LOOKALIKE, 100_000_000n), 10n ** 15n), { sentTo: [ME], inboundOnly: [LOOKALIKE] })
    expect(poisoned.rules.map((r) => r.code)).toContain('RECIPIENT_LOOKALIKE')
    expect(poisoned.severity).toBe('block')
  })

  it('blocks a recipient that is a contract here and nothing on the destination', () => {
    const req = tx(1, ETH_USDC_ROUTER, data(52014, '0x5555555555555555555555555555555555555555', 5_000_000n), 10n ** 15n)
    const blocked = run(1, req, { bridgeRecipient: { hasCodeOnOrigin: true, hasCodeOnDestination: false } })
    expect(blocked.rules.map((r) => r.code)).toContain('RECIPIENT_NO_CODE_ON_DEST')
    expect(blocked.severity).toBe('block')
    // An EOA, a contract on both sides, or an unanswered destination never trip it.
    expect(run(1, req, { bridgeRecipient: { hasCodeOnOrigin: false, hasCodeOnDestination: false } }).rules.map((r) => r.code)).not.toContain('RECIPIENT_NO_CODE_ON_DEST')
    expect(run(1, req, { bridgeRecipient: { hasCodeOnOrigin: true, hasCodeOnDestination: true } }).rules.map((r) => r.code)).not.toContain('RECIPIENT_NO_CODE_ON_DEST')
    expect(run(1, req, { bridgeRecipient: { hasCodeOnOrigin: true, hasCodeOnDestination: null } }).rules.map((r) => r.code)).not.toContain('RECIPIENT_NO_CODE_ON_DEST')
  })
})
