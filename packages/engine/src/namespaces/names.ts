/**
 * Names (master plan §8.1 identity, §3.6): `.etn` on Electroneum through its
 * UniversalResolver, `.eth` on Ethereum. Display names are forward-verified
 * (viem checks the reverse record resolves back to the address); input names
 * are resolved live on chain at send time. Never shown for contracts — that
 * decision belongs to the caller, which knows what it is labelling.
 */
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { isAddress, type Hex } from 'viem'
import { z } from 'zod'
import type { NamespaceSpec } from '../host'
import type { NameLookup } from '../schema'
import type { ChainsService } from './chains'

/** Peer ENS plan: Electroneum's UniversalResolver. */
export const ETN_UNIVERSAL_RESOLVER = '0x75509153af7db00BeeCc30EC042299fD30e2cb6e' as const

const RESOLVERS: Record<number, Hex> = {
  52014: ETN_UNIVERSAL_RESOLVER,
  1: mainnet.contracts.ensUniversalResolver.address,
}

const SUFFIX: Record<number, string> = { 52014: '.etn', 1: '.eth' }
const CACHE_MS = 5 * 60_000

export class NamesService {
  private readonly reverse = new Map<string, { name: string | null; at: number }>()

  constructor(
    private readonly chains: ChainsService,
    private readonly now: () => number,
  ) {}

  supports(chainId: number): boolean {
    return RESOLVERS[chainId] !== undefined
  }

  /** True when the input is a name this chain can resolve (not an address). */
  isName(chainId: number, input: string): boolean {
    const suffix = SUFFIX[chainId]
    return !!suffix && !isAddress(input) && input.trim().toLowerCase().endsWith(suffix) && input.trim().length > suffix.length
  }

  async lookup(chainId: number, addresses: readonly string[]): Promise<NameLookup[]> {
    const resolver = RESOLVERS[chainId]
    if (!resolver) return addresses.map((address) => ({ address, name: null, verified: false }))
    const client = await this.chains.client(chainId)
    const out: NameLookup[] = []
    for (const address of addresses.slice(0, 200)) {
      const k = `${chainId}:${address.toLowerCase()}`
      const cached = this.reverse.get(k)
      if (cached && this.now() - cached.at < CACHE_MS) {
        out.push({ address, name: cached.name, verified: cached.name !== null })
        continue
      }
      let name: string | null = null
      try {
        name = await client.getEnsName({ address: address as Hex, universalResolverAddress: resolver })
      } catch {
        name = null
      }
      this.reverse.set(k, { name, at: this.now() })
      out.push({ address, name, verified: name !== null })
    }
    return out
  }

  async resolve(chainId: number, name: string): Promise<string | null> {
    const resolver = RESOLVERS[chainId]
    if (!resolver || !this.isName(chainId, name)) return null
    const client = await this.chains.client(chainId)
    try {
      const address = await client.getEnsAddress({ name: normalize(name.trim()), universalResolverAddress: resolver })
      return address ?? null
    } catch {
      return null
    }
  }
}

export function namesNamespace(names: NamesService): NamespaceSpec {
  return {
    lookup: {
      input: z.object({ chainId: z.number().int().positive(), addresses: z.array(z.string()).max(200) }),
      handler: (arg) => names.lookup((arg as { chainId: number }).chainId, (arg as { addresses: string[] }).addresses),
    },
    resolve: {
      input: z.object({ chainId: z.number().int().positive(), name: z.string().min(1).max(255) }),
      handler: async (arg) => ({ address: await names.resolve((arg as { chainId: number }).chainId, (arg as { name: string }).name) }),
    },
  }
}
