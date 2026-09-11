/**
 * The transaction firewall's vocabulary (master plan §3.4). Everything here is
 * plain data: the engine builds an `AssessmentInput`, `assess()` returns an
 * `Assessment`, and every body renders it the same way.
 */
export type Hex = `0x${string}`

export type Severity = 'info' | 'warn' | 'danger' | 'block'

export const SEVERITY_ORDER: Record<Severity, number> = { info: 0, warn: 1, danger: 2, block: 3 }

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b
}

export type RiskCode =
  | 'APPROVE_UNLIMITED'
  | 'APPROVE_UNKNOWN_SPENDER'
  | 'APPROVAL_FOR_ALL'
  | 'PERMIT2_UNLIMITED'
  | 'PERMIT2_UNKNOWN_SPENDER'
  | 'PERMIT2_SIGNATURE_TRANSFER'
  | 'ERC2612_PERMIT_UNKNOWN_SPENDER'
  | 'ERC2612_PERMIT_UNLIMITED'
  | 'DAI_PERMIT_ALLOWED'
  | 'PERMIT_TO_EOA'
  | 'TYPED_DATA_UNKNOWN'
  | 'TYPED_DATA_DOMAIN_MISMATCH'
  | 'SEAPORT_ZERO_CONSIDERATION'
  | 'SEAPORT_UNDERPRICED'
  | 'ETH_SIGN_BLOCKED'
  | 'PERSONAL_SIGN_LOOKS_LIKE_TX'
  | 'AUTHORIZATION_LIST'
  | 'NEW_CONTRACT'
  | 'UNKNOWN_FUNCTION'
  | 'RECIPIENT_FIRST_TIME'
  | 'RECIPIENT_LOOKALIKE'
  | 'RECIPIENT_POISON_SOURCE'
  | 'RECIPIENT_IS_CONTRACT'
  | 'RECIPIENT_NOT_ALLOWED'
  | 'RECIPIENT_NO_CODE_ON_DEST'
  | 'LARGE_SEND'
  | 'VALUE_EXCEEDS_BUDGET'
  | 'CLIPBOARD_MISMATCH'
  | 'SIM_FAILED'
  | 'SIM_INCOMPLETE'
  | 'SIM_UNAVAILABLE'
  | 'FEE_SINK_MISMATCH'
  | 'FEE_TIER_MISMATCH'
  | 'WALLET_FEE_OVERCHARGE'
  | 'DAPP_TIPS_THIRD_PARTY'
  | 'ORIGIN_UNVERIFIED'
  | 'ORIGIN_TYPOSQUAT'
  | 'ORIGIN_SCAM'
  | 'ORIGIN_FIRST_TIME'
  | 'CHAIN_MISMATCH'
  | 'UR_RECIPIENT_NOT_SELF'
  | 'SWAP_MIN_OUT_IMPLAUSIBLE'
  | 'MULTICALL_OPAQUE'

export interface RiskRule {
  readonly code: RiskCode
  readonly severity: Severity
  /** One line, plain language, no jargon (§7.10). */
  readonly title: string
  /** What it means and what to do. */
  readonly detail: string
}

/** A plain-language line the user reads before signing; also the screen-reader text. */
export interface Statement {
  readonly text: string
  readonly tone: 'neutral' | 'out' | 'in' | 'warn'
}

export interface TxRequest {
  readonly from: Hex
  readonly to: Hex | null
  readonly value: bigint
  readonly data: Hex
  readonly chainId: number
  readonly gas?: bigint
  /** EIP-7702 — blocked in v1 (§3.4). */
  readonly authorizationList?: readonly unknown[]
}

export type SignRequest =
  | { readonly kind: 'transaction'; readonly tx: TxRequest }
  | { readonly kind: 'message'; readonly from: Hex; readonly message: Hex }
  | { readonly kind: 'typed_data'; readonly from: Hex; readonly typedData: unknown }
  | { readonly kind: 'eth_sign'; readonly from: Hex; readonly hash: Hex }

export interface TokenInfo {
  readonly symbol: string
  readonly decimals: number
  readonly name?: string
}

export interface ContractInfo {
  readonly hasCode: boolean
  /** Days since the contract's first-seen block; null when unknown. */
  readonly ageDays?: number | null
  /** Verified on the explorer; null when unknown. */
  readonly verified?: boolean | null
}

/**
 * Settings › Spending (master plan §3.4 point 6) as the firewall sees it.
 *
 * Both halves are stated in token units, never in fiat. `largeSendPercent` is
 * a share of the balance of the token being moved, so the comparison is
 * `amount` against `balance` in that token's own base units and no price is
 * consulted — §3.4 is explicit that a threshold "expressed in token units …
 * never in USD, because prices are display-only".
 */
export interface SpendPolicy {
  /** 1–100. A transfer above this share of that token's balance asks for a step-up. */
  readonly largeSendPercent: number
  /** Lowercase addresses a transfer may go to while `allowListOnly` is on. */
  readonly allowList: readonly Hex[]
  /** The user turned the allow-list on; an unlisted recipient is refused. */
  readonly allowListOnly: boolean
}

/** What the engine knows about the user and the world at assessment time. */
export interface AssessmentContext {
  /** Addresses the user has sent to, address-book entries, own accounts (§3.6 reference set). */
  readonly sentTo: readonly Hex[]
  readonly addressBook: readonly Hex[]
  readonly own: readonly Hex[]
  /** Inbound-only senders — never a reference, always suspicious as a recipient. */
  readonly inboundOnly: readonly Hex[]
  readonly firstTimeOrigin: boolean
  /** False for a WalletConnect peer without Verify (§5.3). */
  readonly originVerified: boolean
  readonly scamOrigins: readonly string[]
  readonly contracts: Readonly<Record<string, ContractInfo>>
  readonly tokens: Readonly<Record<string, TokenInfo>>
  /** Balances by lowercase token address or 'native', for the large-send step-up. */
  readonly balances: Readonly<Record<string, bigint>>
  /**
   * The user's spend policy. Absent means the defaults — a tenth of the
   * balance, and no allow-list — which is what a cold start and every test
   * that does not care about the policy get.
   */
  readonly spendPolicy?: SpendPolicy | null
  /** Address labels (names, known contracts) for statements; lowercase keys. */
  readonly labels: Readonly<Record<string, string>>
  readonly ethSignEnabled: boolean
  /**
   * How new "very new" is, in days (§3.4). Configurable so ops can retune it
   * without a wallet release; `NEW_CONTRACT_DEFAULT_DAYS` is what ships, and is
   * also the floor — see `clampNewContractDays`.
   */
  readonly newContractAfterDays: number
  readonly now: number
  /**
   * Collection floor prices in the chain's native base units, by lowercase NFT
   * contract. `SEAPORT_UNDERPRICED` is the only reader: without a floor there
   * is nothing to call a listing cheap against.
   */
  readonly nftFloors: Readonly<Record<string, bigint>>
  /**
   * The connected origin's native spend cap and what it has already spent,
   * both in base units (§4.6). Absent means no cap. Never a fiat amount:
   * prices are display-only (§3.4 step 6), so a USD budget would rest on a
   * number this wallet does not treat as authoritative.
   */
  readonly originBudget?: { readonly limit: bigint; readonly spent: bigint } | null
  /**
   * The last address the wallet itself put on the clipboard, and when (§3.6).
   * The clipboard check has nothing to compare against but this.
   */
  readonly lastCopiedAddress?: { readonly address: Hex; readonly at: number } | null
  /** BOLT's address on this chain, for farm-boost statements; optional. */
  readonly boltToken?: Hex
  /** For `internal:bridge`: whether the recipient is a contract on the origin and on the destination (§8.7). */
  readonly bridgeRecipient?: { readonly hasCodeOnOrigin: boolean; readonly hasCodeOnDestination: boolean | null } | null
  /**
   * For `internal:swap`: the fee the encoder must have written (T10). `bips: 0`
   * means no `PAY_PORTION` at all.
   *
   * `onInput` says the fee was taken from the token being spent, before the
   * swap, rather than as a portion of the output — which is what the encoder
   * does when the output token charges on transfer, so the router never holds it
   * and the swap's own minimum is measured on the user. The shape on the wire is
   * then a `PERMIT2_TRANSFER_FROM` (or a `TRANSFER`, when the input was just
   * wrapped) to the sink, and no portion at all. The exact amount is given
   * rather than derived, because the swap command's `amountIn` is already net of
   * it and there is nothing left in the calldata to recompute it from.
   */
  readonly expectedFee?: { readonly sink: Hex; readonly bips: number; readonly onInput?: { readonly token: Hex; readonly amount: bigint } | null } | null
  /**
   * This account's wallet fee, for a swap ElectroSwap's own site built
   * (master plan §8.6, §8.18).
   *
   * Not `expectedFee`, and deliberately not reusing it. `expectedFee` is an
   * assertion: our Swap screen encoded these exact bytes and the sheet refuses
   * anything else (T10, `feeSinkRules`). This is a *reading*: the site encoded
   * something, and this says what we would have charged so the statement can
   * name the fee and the rung instead of an anonymous address, and so a site
   * charging more than the rung allows is caught.
   *
   * Populated only for ElectroSwap's own origins, and null everywhere else —
   * including when the tier could not be read. Absent means the sheet says
   * nothing about a wallet fee, which is the honest answer when we do not know.
   */
  readonly walletFee?: { readonly sink: Hex; readonly bips: number; readonly tier: string } | null
}

export interface AssetDelta {
  readonly asset: 'native' | Hex
  readonly standard: 'native' | 'erc20' | 'erc721' | 'erc1155'
  /** Signed; negative leaves the account. */
  readonly amount: bigint
  readonly tokenId?: bigint
  readonly counterparty?: Hex
}

export interface ApprovalDelta {
  readonly token: Hex
  readonly spender: Hex
  readonly amount: bigint | 'all'
  readonly standard: 'erc20' | 'erc721' | 'erc1155'
}

export interface Simulation {
  readonly mode: 'trace' | 'estimate' | 'none'
  readonly ok: boolean
  readonly revertReason?: string
  readonly gas?: bigint
  readonly deltas: readonly AssetDelta[]
  readonly approvals: readonly ApprovalDelta[]
  /**
   * Why there are no deltas, when something specific went wrong.
   *
   * Absent means the plain case: nothing here can trace, so only the revert
   * check ran. Present means a tracer was asked and answered with a problem —
   * busy, timed out, the node refused — and that is worth repeating verbatim
   * rather than flattening into "this network cannot preview what moves",
   * which would be a lie about a network that can.
   */
  readonly note?: string
}

export interface Presentation {
  /** Primary button inert for this long after the sheet shows (warn: 1.5 s). */
  readonly delayMs: number
  /** Danger: the user types this string to enable the primary. */
  readonly typedConfirmation: string | null
  /** Block: no primary at all. */
  readonly blocked: boolean
}
