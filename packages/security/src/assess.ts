/**
 * assess() — the firewall pipeline decode → (simulate, supplied) → rules →
 * explain → present, as plain data (master plan §3.4). Severity is the max
 * over the static rules; a simulation can only add rules, never lower it.
 */
import type { Hex } from 'viem'
import { decodeCalldata, parseTypedData, type DecodedCall, type ParsedTypedData } from './decode'
import { explain, explainSimulation } from './explain'
import { runRules, type Rule } from './rules'
import type { AssessmentContext, Presentation, RiskRule, Severity, SignRequest, Simulation, Statement } from './types'
import { maxSeverity } from './types'

export interface AssessmentInput {
  readonly origin: string
  readonly chainId: number
  readonly account: Hex
  readonly request: SignRequest
  readonly context: AssessmentContext
  readonly simulation?: Simulation | null
}

export interface Assessment {
  readonly severity: Severity
  readonly rules: readonly RiskRule[]
  readonly statements: readonly Statement[]
  /** Balance changes from the simulation, as statements. */
  readonly changes: readonly Statement[]
  readonly presentation: Presentation
  readonly decoded: DecodedCall | null
  readonly typed: ParsedTypedData | null
  readonly simulation: Simulation | null
}

export function presentationFor(severity: Severity, origin: string): Presentation {
  switch (severity) {
    case 'info':
      return { delayMs: 0, typedConfirmation: null, blocked: false }
    case 'warn':
      return { delayMs: 1500, typedConfirmation: null, blocked: false }
    case 'danger':
      return { delayMs: 1500, typedConfirmation: confirmationWord(origin), blocked: false }
    case 'block':
      return { delayMs: 0, typedConfirmation: null, blocked: true }
  }
}

function confirmationWord(origin: string): string {
  if (origin.startsWith('internal:')) return 'confirm'
  try {
    return new URL(origin).hostname.replace(/^www\./, '')
  } catch {
    return 'confirm'
  }
}

export function assess(input: AssessmentInput, rules?: readonly Rule[]): Assessment {
  /*
    `transferFrom` is the same selector and layout in ERC-20 and ERC-721, so
    the decoder needs outside evidence to tell an amount from a token id. The
    context already carries the chain's ERC-20 universe — a target that is in
    it is a token, and the decoder can stop guessing. Anything else falls
    through to `ambiguous_transfer_from`, which says so on the sheet.
  */
  const hint = input.request.kind === 'transaction' && input.request.tx.to && input.context.tokens[input.request.tx.to.toLowerCase()] ? ('erc20' as const) : null
  const decoded = input.request.kind === 'transaction' ? decodeCalldata({ chainId: input.request.tx.chainId, to: input.request.tx.to, data: input.request.tx.data, value: input.request.tx.value, standardHint: hint }) : null
  const typed = input.request.kind === 'typed_data' ? parseTypedData(input.request.typedData) : null
  const simulation = input.simulation ?? null
  const ruleInput = { origin: input.origin, chainId: input.chainId, account: input.account, request: input.request, decoded, typed, context: input.context, simulation }
  const found = [...runRules({ ...ruleInput, simulation: null }, rules)]
  /*
    A batch is assessed by what is inside it.

    Every rule reads `decoded`, and for a Multicall3 call that is the batch
    itself — so an unlimited approval to an attacker raised nothing at all as
    long as it was wrapped in `aggregate3`. Wrapping is not a mitigation, so
    the inner calls are run through the same rules and their findings merged.
    One level deep, matching the statements, and de-duplicated by code so a
    batch of ten approvals reads as one finding rather than ten.
  */
  if (decoded?.kind === 'multicall') {
    for (const c of decoded.calls.slice(0, 10)) {
      const inner = decodeCalldata({ chainId: input.chainId, to: c.target, data: c.data, value: 0n })
      if (inner.kind === 'multicall') continue
      for (const r of runRules({ ...ruleInput, decoded: inner, simulation: null }, rules))
        if (!found.some((f) => f.code === r.code)) found.push(r)
    }
  }
  let severity: Severity = 'info'
  for (const r of found) severity = maxSeverity(severity, r.severity)
  // Simulation-derived rules can only add.
  const simRules = runRules(ruleInput, rules).filter((r) => !found.some((f) => f.code === r.code))
  for (const r of simRules) severity = maxSeverity(severity, r.severity)
  const all = [...found, ...simRules].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  return {
    severity,
    rules: all,
    statements: explain(input.request, decoded, typed, input.context, input.chainId, input.origin),
    changes: explainSimulation(simulation, input.context, input.chainId),
    presentation: presentationFor(severity, input.origin),
    decoded,
    typed,
    simulation,
  }
}

function severityRank(s: Severity): number {
  return s === 'block' ? 3 : s === 'danger' ? 2 : s === 'warn' ? 1 : 0
}

/** A context with nothing known — the safest default for tests and cold starts. */
export function emptyContext(overrides: Partial<AssessmentContext> = {}): AssessmentContext {
  return {
    sentTo: [],
    addressBook: [],
    own: [],
    inboundOnly: [],
    firstTimeOrigin: false,
    originVerified: true,
    scamOrigins: [],
    contracts: {},
    tokens: {},
    balances: {},
    labels: {},
    nftFloors: {},
    ethSignEnabled: false,
    now: 0,
    ...overrides,
  }
}
