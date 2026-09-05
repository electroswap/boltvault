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
  const decoded = input.request.kind === 'transaction' ? decodeCalldata({ chainId: input.request.tx.chainId, to: input.request.tx.to, data: input.request.tx.data, value: input.request.tx.value }) : null
  const typed = input.request.kind === 'typed_data' ? parseTypedData(input.request.typedData) : null
  const simulation = input.simulation ?? null
  const ruleInput = { origin: input.origin, chainId: input.chainId, account: input.account, request: input.request, decoded, typed, context: input.context, simulation }
  const found = runRules({ ...ruleInput, simulation: null }, rules)
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
    ethSignEnabled: false,
    now: 0,
    ...overrides,
  }
}
