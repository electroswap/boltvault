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
  /**
   * When the preview was taken. It runs once, at payload-build time, and is
   * never re-run — so a sheet left open shows a picture of a state that may
   * have moved on. Defaulted so approvals stored before this field still read.
   */
  simulatedAt: z.number().int().nonnegative().default(0),
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
  /**
   * What the node itself suggested per unit of gas, whatever the request asked
   * for. The fee editor's band is anchored here rather than on the price in
   * the transaction: a site that sets fifty times the going rate does not move
   * the band up, it moves the whole band, and the editor could then not get
   * back down to anything a block would sensibly include.
   */
  nodePerGas: HexSchema.optional(),
})
export type PreparedTx = z.infer<typeof PreparedTxSchema>

/**
 * `tabId` / `frameId` — which tab asked, when a browser tab did.
 *
 * The design queues an approval-class request from a hidden tab rather than
 * throwing a focused window over whatever the person is doing. That hold lived
 * only in the MAIN-world provider, which is page code and therefore no hold at
 * all — a page posts straight to the bridge and skips it. The sender's tab is
 * on the record so the worker can decide, and it survives a restart with it.
 *
 * `intentDigest` — a canonical fingerprint of the request as it arrived.
 *
 * A re-sent request re-attaches to a pending sheet by origin plus the
 * page-supplied `clientRequestId`, which says nothing about what the request
 * asks for. The digest is taken when the sheet is built and compared when one
 * re-attaches, so a request that has quietly changed its chain, its account or
 * its bytes cannot inherit a sheet raised for something else.
 */
export const ApprovalPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('connect'),
    requestedChainId: z.number().int().positive(),
    /** The site was already permitted; the vault was just locked. Auto-approve after unlock. */
    reconnect: z.boolean(),
    firstTime: z.boolean(),
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('sign_message'),
    from: AddressSchema,
    message: HexSchema,
    text: z.string().nullable(),
    assessment: AssessmentViewSchema,
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('eth_sign'),
    from: AddressSchema,
    hash: HexSchema,
    assessment: AssessmentViewSchema,
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('sign_typed_data'),
    from: AddressSchema,
    typedData: z.unknown(),
    version: z.enum(['v3', 'v4']),
    domainName: z.string().nullable(),
    primaryType: z.string(),
    assessment: AssessmentViewSchema,
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
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
    /**
     * `device:` remote sign only: sign and hand the raw transaction back
     * rather than broadcasting it. It lives on the record because that is
     * what `execute()` reads — taking it from the live intent let a re-sent
     * request flip a sheet the user approved as "sign" into a broadcast.
     */
    signOnly: z.boolean().optional(),
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('switch_chain'),
    chainId: z.number().int().positive(),
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('add_chain'),
    chainId: z.number().int().positive(),
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('watch_asset'),
    type: z.string(),
    options: z.unknown(),
    /** What the site claims (EIP-747) and what the chain says; `mismatch` when they disagree (plan A3). */
    address: z.string().nullable(),
    symbol: z.string().nullable(),
    decimals: z.number().int().nonnegative().nullable(),
    onChain: z
      .object({ name: z.string(), symbol: z.string(), decimals: z.number().int().nonnegative() })
      .nullable(),
    mismatch: z.boolean(),
    clientRequestId: z.string(),
    intentDigest: z.string().optional(),
    tabId: z.number().int().optional(),
    frameId: z.number().int().optional(),
  }),
])

/** EIP-747 `wallet_watchAsset` options for an ERC-20. */
export const WatchAssetOptionsSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  symbol: z.string().max(16).optional(),
  decimals: z.number().int().min(0).max(36).optional(),
  image: z.string().optional(),
})
export type WatchAssetOptions = z.infer<typeof WatchAssetOptionsSchema>
export type ApprovalPayload = z.infer<typeof ApprovalPayloadSchema>

/** What the Connect sheet sends back with its decision. */
export const ConnectDecisionDataSchema = z.object({
  accountId: z.string(),
  chainId: z.number().int().positive(),
})
export type ConnectDecisionData = z.infer<typeof ConnectDecisionDataSchema>

/**
 * What the signing sheet sends back when the user changed the network fee
 * (master plan §8.4, §8.15).
 *
 * The same shape as the Connect decision: a typed object on
 * `ApprovalDecision.data`, parsed where the signature is made rather than
 * trusted from a page. The transaction is prepared before the sheet exists —
 * that is what gives the firewall something to assess and the sheet something
 * to render — so a fee chosen at decision time is applied to the prepared
 * record on the way to the signer, and to nothing else. Only the price of gas
 * moves; `to`, `value`, `data` and `nonce` are the bytes the user was shown and
 * cannot be touched from here.
 *
 * The gas LIMIT is deliberately absent. Raising it changes nothing (unused gas
 * is refunded) and lowering it below the estimate buys an out-of-gas revert
 * that still costs the whole limit — a control whose only working setting is
 * the one it already has is not a control.
 */
export const GasDecisionDataSchema = z.object({
  maxFeePerGas: HexSchema.optional(),
  maxPriorityFeePerGas: HexSchema.optional(),
  gasPrice: HexSchema.optional(),
})
export type GasDecisionData = z.infer<typeof GasDecisionDataSchema>

/**
 * How far below the node's own suggestion a hand-set fee may go.
 *
 * The suggestion for an EIP-1559 chain is `baseFee × 2 + tip`, so half of it is
 * a shade above the current base fee — which is the real boundary, because a
 * ceiling under the base fee is not a slow transaction, it is one no block can
 * ever include. Below half, the wallet is no longer letting someone save money;
 * it is letting them sign something that will sit in a pool until it is dropped.
 */
export const GAS_FLOOR_PERCENT = 50
/**
 * And how far above, before a hurry becomes a typo. Four times the going rate
 * is more than any congestion here has ever asked for, and the difference
 * between 4× and 400× is a decimal point in a hurry.
 */
export const GAS_CEILING_PERCENT = 400

const hexOf = (n: bigint): string => `0x${n.toString(16)}`

/** The price per unit of gas the node itself suggested, whichever fee model this chain uses. */
export function suggestedPerGas(tx: PreparedTx): bigint {
  return BigInt((tx.type === 'eip1559' ? tx.maxFeePerGas : tx.gasPrice) ?? '0x0')
}

/**
 * The band a hand-set price per unit of gas has to stay inside.
 *
 * Anchored on the node's own suggestion where there is one, not on the price
 * the transaction happens to carry — those differ exactly when a dApp supplied
 * `gasPrice`/`maxFeePerGas`, which is the case the band exists for.
 */
export function gasBand(tx: PreparedTx): { floor: bigint; suggested: bigint; ceiling: bigint } {
  const node = tx.nodePerGas ? BigInt(tx.nodePerGas) : 0n
  const suggested = node > 0n ? node : suggestedPerGas(tx)
  return {
    floor: (suggested * BigInt(GAS_FLOOR_PERCENT)) / 100n,
    suggested,
    ceiling: (suggested * BigInt(GAS_CEILING_PERCENT)) / 100n,
  }
}

/** Bring a chosen price per unit of gas inside the band. */
export function clampPerGas(tx: PreparedTx, chosen: bigint): bigint {
  const { floor, ceiling } = gasBand(tx)
  return chosen < floor ? floor : chosen > ceiling ? ceiling : chosen
}

/**
 * The fee fields to sign with, given whatever the sheet sent back.
 *
 * Null means "nothing was chosen" — a decision from some other sheet, a
 * malformed payload, or a decision that named no fee — and the caller signs the
 * prepared transaction unchanged. The clamp is applied HERE rather than trusted
 * from the sheet, because the sheet is a page and this is the last place before
 * a signature.
 */
export function applyGasDecision(
  tx: PreparedTx,
  data: unknown,
): Pick<PreparedTx, 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'> | null {
  const parsed = GasDecisionDataSchema.safeParse(data)
  if (!parsed.success) return null
  const choice = parsed.data
  if (tx.type === 'eip1559') {
    if (choice.maxFeePerGas === undefined) return null
    const max = clampPerGas(tx, BigInt(choice.maxFeePerGas))
    // A tip is paid out of the ceiling it sits under, so it can never exceed it.
    const wanted =
      choice.maxPriorityFeePerGas !== undefined
        ? BigInt(choice.maxPriorityFeePerGas)
        : BigInt(tx.maxPriorityFeePerGas ?? '0x0')
    return { maxFeePerGas: hexOf(max), maxPriorityFeePerGas: hexOf(wanted > max ? max : wanted) }
  }
  if (choice.gasPrice === undefined) return null
  return { gasPrice: hexOf(clampPerGas(tx, BigInt(choice.gasPrice))) }
}

export function parseApprovalPayload(payload: unknown): ApprovalPayload | null {
  const r = ApprovalPayloadSchema.safeParse(payload)
  return r.success ? r.data : null
}
