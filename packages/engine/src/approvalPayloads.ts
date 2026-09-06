/**
 * Kind-specific approval payloads (master plan §8.15). JSON-safe views — no
 * bigints, no decoded objects — so they persist in session storage and render
 * identically in sign.html, the popup and the mobile sheet. The UI parses
 * `ApprovalRequest.payload` with `ApprovalPayloadSchema`; it never executes
 * anything from it.
 */
import { z } from 'zod'

const HexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/)
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

export const SeveritySchema = z.enum(['info', 'warn', 'danger', 'block'])
export type SeverityView = z.infer<typeof SeveritySchema>

export const RiskRuleViewSchema = z.object({
  code: z.string(),
  severity: SeveritySchema,
  title: z.string(),
  detail: z.string(),
})
export type RiskRuleView = z.infer<typeof RiskRuleViewSchema>

export const StatementViewSchema = z.object({
  text: z.string(),
  tone: z.enum(['neutral', 'out', 'in', 'warn']),
})
export type StatementView = z.infer<typeof StatementViewSchema>

export const AssessmentViewSchema = z.object({
  severity: SeveritySchema,
  rules: z.array(RiskRuleViewSchema),
  statements: z.array(StatementViewSchema),
  /** Balance changes from the simulation, when one ran. */
  changes: z.array(StatementViewSchema),
  presentation: z.object({
    delayMs: z.number().int().nonnegative(),
    typedConfirmation: z.string().nullable(),
    blocked: z.boolean(),
  }),
  simulationMode: z.enum(['trace', 'estimate', 'none']),
})
export type AssessmentView = z.infer<typeof AssessmentViewSchema>

export const PreparedTxSchema = z.object({
  from: AddressSchema,
  to: AddressSchema.nullable(),
  value: HexSchema,
  data: HexSchema,
  nonce: z.number().int().nonnegative(),
  gas: HexSchema,
  type: z.enum(['eip1559', 'legacy']),
  maxFeePerGas: HexSchema.optional(),
  maxPriorityFeePerGas: HexSchema.optional(),
  gasPrice: HexSchema.optional(),
})
export type PreparedTx = z.infer<typeof PreparedTxSchema>

export const ApprovalPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('connect'),
    requestedChainId: z.number().int().positive(),
    /** The site was already permitted; the vault was just locked. Auto-approve after unlock. */
    reconnect: z.boolean(),
    firstTime: z.boolean(),
    clientRequestId: z.string(),
  }),
  z.object({ kind: z.literal('sign_message'), from: AddressSchema, message: HexSchema, text: z.string().nullable(), assessment: AssessmentViewSchema, clientRequestId: z.string() }),
  z.object({ kind: z.literal('eth_sign'), from: AddressSchema, hash: HexSchema, assessment: AssessmentViewSchema, clientRequestId: z.string() }),
  z.object({
    kind: z.literal('sign_typed_data'),
    from: AddressSchema,
    typedData: z.unknown(),
    version: z.enum(['v3', 'v4']),
    domainName: z.string().nullable(),
    primaryType: z.string(),
    assessment: AssessmentViewSchema,
    clientRequestId: z.string(),
  }),
  z.object({
    kind: z.literal('send_transaction'),
    tx: PreparedTxSchema,
    fee: z.object({
      /** Gas limit as a decimal string. */
      gasLimit: z.string(),
      /** Worst-case fee in wei, decimal string. */
      maxTotalWei: z.string(),
      symbol: z.string(),
    }),
    assessment: AssessmentViewSchema,
    clientRequestId: z.string(),
  }),
  z.object({ kind: z.literal('switch_chain'), chainId: z.number().int().positive(), clientRequestId: z.string() }),
  z.object({ kind: z.literal('add_chain'), chainId: z.number().int().positive(), clientRequestId: z.string() }),
  z.object({
    kind: z.literal('watch_asset'),
    type: z.string(),
    options: z.unknown(),
    /** What the site claims (EIP-747) and what the chain says; `mismatch` when they disagree (plan A3). */
    address: z.string().nullable(),
    symbol: z.string().nullable(),
    decimals: z.number().int().nonnegative().nullable(),
    onChain: z.object({ name: z.string(), symbol: z.string(), decimals: z.number().int().nonnegative() }).nullable(),
    mismatch: z.boolean(),
    clientRequestId: z.string(),
  }),
])

/** EIP-747 `wallet_watchAsset` options for an ERC-20. */
export const WatchAssetOptionsSchema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), symbol: z.string().max(16).optional(), decimals: z.number().int().min(0).max(36).optional(), image: z.string().optional() })
export type WatchAssetOptions = z.infer<typeof WatchAssetOptionsSchema>
export type ApprovalPayload = z.infer<typeof ApprovalPayloadSchema>

/** What the Connect sheet sends back with its decision. */
export const ConnectDecisionDataSchema = z.object({
  accountId: z.string(),
  chainId: z.number().int().positive(),
})
export type ConnectDecisionData = z.infer<typeof ConnectDecisionDataSchema>

export function parseApprovalPayload(payload: unknown): ApprovalPayload | null {
  const r = ApprovalPayloadSchema.safeParse(payload)
  return r.success ? r.data : null
}
