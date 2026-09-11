/**
 * What the API knows about a contract the user is about to transact with:
 * whether code is deployed there, whether its source has been published, and
 * when it was created (master plan §3.4, `NEW_CONTRACT`).
 *
 * Why this is asked of the API rather than of an explorer directly: the API
 * answers from a cache shared by everyone, so the same router is not looked up
 * once per wallet per six hours, and it is the only source the web interface
 * can reach — one lookup, one answer, both surfaces. The wallet keeps its own
 * explorer path as the fallback, because this API is Electroneum-only and can
 * be unreachable, and a wallet that cannot answer this question stops warning
 * about new contracts without ever saying so.
 *
 * Two things about the wire shape are load-bearing:
 *
 *  - `deployedAt` is an absolute instant, not an age. An age is only true at
 *    the moment it is computed, so a cached one is wrong for as long as it is
 *    cached — and wrong precisely at the seven-day boundary the rule turns on.
 *    It arrives in seconds and is converted to milliseconds here, once, at the
 *    boundary, because everything inland counts in milliseconds.
 *  - Every fact is nullable and null means "nobody could tell us", never "no".
 *    On a signing path those two lead to opposite warnings.
 */
import { z } from 'zod'
import type { ElectroSwapClient } from './client'
import { chainEnum, CONTRACT_FACTS } from './queries'

export interface ContractFactsView {
  /** As the API returned it. */
  readonly address: string
  /** True when code is deployed there now, false for a plain account, null when unknown. */
  readonly hasCode: boolean | null
  /** True when the explorer holds published source, false when it does not, null when unknown. */
  readonly verified: boolean | null
  /** Epoch milliseconds of the creating block, or null when unknown. */
  readonly deployedAt: number | null
}

const FactsSchema = z.object({
  address: z.string().nullable().optional(),
  hasCode: z.boolean().nullable().optional(),
  verified: z.boolean().nullable().optional(),
  deployedAt: z.number().nullable().optional(),
})

const ResponseSchema = z.object({ contractFacts: FactsSchema.nullable().optional() })

/**
 * Seconds to milliseconds, refusing anything that is not a plausible instant.
 *
 * A zero or a negative is not a deployment date, and neither is something far
 * in the future — and a bogus one here would read as a brand-new contract,
 * which is the warning we least want to fire on nothing.
 */
function instantOf(seconds: number | null | undefined, now: number): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  const ms = Math.round(seconds * 1000)
  return ms > now ? null : ms
}

/**
 * One address. Null when the API could not be asked or said nothing useful, so
 * the caller can fall through to its own source; a returned view may still
 * carry nulls, which mean the API was asked and did not know.
 */
export async function fetchContractFacts(client: ElectroSwapClient, chainId: number, address: string, now: number): Promise<ContractFactsView | null> {
  const data = await client.query<unknown>(CONTRACT_FACTS, { chain: chainEnum(chainId), address })
  const parsed = ResponseSchema.safeParse(data)
  if (!parsed.success) return null
  const facts = parsed.data.contractFacts
  if (!facts) return null
  return {
    address: facts.address ?? address,
    hasCode: facts.hasCode ?? null,
    verified: facts.verified ?? null,
    deployedAt: instantOf(facts.deployedAt, now),
  }
}
