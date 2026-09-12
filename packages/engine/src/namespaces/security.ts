/**
 * Security (master plan §2.4 — `security: { assess(request); policy(); }`).
 *
 * Two things the firewall could do but nothing could ask it: "what would you
 * say about this request?" without putting a sheet in front of anyone, and
 * "what is the policy that decides when a signature needs a second factor?"
 * (§3.4 point 6). Until now the firewall ran only inside the provider's
 * approval pipeline, in a private method, and a surface that wanted to warn
 * *before* the sheet had nothing to call.
 *
 * This is not a second firewall. `assess` runs the one pipeline that builds
 * every sheet — decode → simulate → assess → explain → present — and hands
 * back exactly the view that sheet would carry. Two firewalls that can
 * disagree is worse than none, so there is deliberately no rule logic here.
 */
import type { ApprovalIntent, Hex } from '@boltvault/protocol'
import { presentationFor, type Severity } from '@boltvault/security'
import { z } from 'zod'
import { AssessmentViewSchema, type ApprovalPayload } from '../approvalPayloads'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { AccountIdSchema } from '../schema'
import type { SettingsStore } from '../settingsStore'
import type { ChainsService } from './chains'
import type { VaultManager } from './vault'

/**
 * The origin every pre-assessment is made under, chosen by the engine and
 * never by the caller.
 *
 * An origin is evidence, and three of the firewall's inputs hang off it: the
 * `internal:swap` fee assertion (`expectedFee`), the `internal:bridge`
 * recipient check, and the whole origin family of rules (`ORIGIN_SCAM`,
 * `ORIGIN_TYPOSQUAT`, `ORIGIN_UNVERIFIED`, `ORIGIN_FIRST_TIME`,
 * `DAPP_TIPS_THIRD_PARTY`). If a surface could name its own origin it could
 * claim `internal:swap`, arrive without the fee evidence that rule needs, and
 * come back quieter than the sheet it is about to raise — §3.4's "a
 * pre-assessment must not talk itself into a lower severity", exactly.
 *
 * So a preview is made under an origin no real request ever uses. It carries
 * none of that evidence, which makes the answer a LOWER BOUND: the sheet can
 * only add rules to it, never remove one.
 */
export const PREVIEW_ORIGIN = 'internal:preview'

/** A preview never consumes a nonce reservation, so this is the placeholder when the chain will not say. */
const UNKNOWN_NONCE = 0

const HexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/)
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

/**
 * What a caller may ask about. Deliberately only the bytes of the request —
 * no origin, no context, no simulation. Everything the assessment reasons
 * over is the engine's own knowledge, which is what stops a probe from
 * becoming a way to read it back out a bit at a time.
 */
export const AssessRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('transaction'),
    to: AddressSchema.nullable().optional(),
    /** Wei, hex or decimal string. */
    value: z.string().max(80).optional(),
    // 128 KiB of calldata is past anything a real transaction carries and well
    // inside what an estimate can chew on; an unbounded field is a free denial
    // of service against the worker.
    data: HexSchema.max(262_146).optional(),
  }),
  z.object({ kind: z.literal('message'), message: HexSchema.max(262_146) }),
  z.object({ kind: z.literal('typed_data'), typedData: z.unknown() }),
])
export type AssessRequest = z.infer<typeof AssessRequestSchema>

export const AssessInputSchema = z.object({
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  request: AssessRequestSchema,
})
export type AssessInput = z.infer<typeof AssessInputSchema>

/**
 * The sheet's own assessment view, plus two labels that keep a caller honest.
 *
 * Defined by extending `AssessmentViewSchema` rather than restating it, so a
 * preview can never drift into showing something a sheet does not — and
 * `parse` on the way out means the reply carries these keys and nothing else,
 * whatever the payload builder put beside them.
 */
export const PreAssessmentSchema = AssessmentViewSchema.extend({
  origin: z.literal(PREVIEW_ORIGIN),
  /**
   * A preview is never a decision. The severity here is a floor — the real
   * sheet sees the origin, the fee assertion and a fresh simulation, and §3.4
   * lets those add rules but never lower one. Nothing may be signed on this.
   */
  advisory: z.literal(true),
})
export type PreAssessment = z.infer<typeof PreAssessmentSchema>

const SEVERITIES: readonly Severity[] = ['info', 'warn', 'danger', 'block']

/** §3.4 point 6 and step 5: the thresholds, and what each severity does to the sheet. */
export const SpendPolicyViewSchema = z.object({
  /** A transfer above this share of that token's balance asks for a step-up. Never a fiat amount (§3.4 point 6). */
  largeSendPercent: z.number().int().min(1).max(100),
  /** The allow-list is only enforced while `allowListOnly` is on. */
  allowList: z.array(z.string()),
  allowListOnly: z.boolean(),
  /** "Make it exact" is offered on an unlimited approval. */
  exactApprovals: z.boolean(),
  /** `eth_sign` is blocked unless the user turned it on (`ETH_SIGN_BLOCKED`). */
  ethSignEnabled: z.boolean(),
  /** Where a preview comes from; `off` means the no-simulation floor applies (§3.4 step 2). */
  txPreview: z.enum(['api', 'off']),
  /** The step-up ladder, straight from the function the sheet presents with. */
  steps: z.array(
    z.object({
      severity: z.enum(['info', 'warn', 'danger', 'block']),
      delayMs: z.number().int().nonnegative(),
      /** Danger asks the user to type something before the primary arms. */
      typedConfirmation: z.boolean(),
      blocked: z.boolean(),
    }),
  ),
})
export type SpendPolicyView = z.infer<typeof SpendPolicyViewSchema>

export interface SecurityDeps {
  readonly vault: VaultManager
  readonly chains: ChainsService
  readonly settings: SettingsStore
  /**
   * The one assessment path: `ProviderService`'s payload builder, injected
   * rather than re-implemented. It decodes, simulates and assesses exactly as
   * it does for a sheet — the whole point of routing a preview through it.
   */
  readonly payloadFor: (intent: ApprovalIntent) => Promise<ApprovalPayload>
}

export class SecurityService {
  constructor(private readonly deps: SecurityDeps) {}

  /**
   * What the firewall would say, without raising an approval.
   *
   * Nothing is created, nothing is queued and nothing is signed: the payload
   * builder is called, its assessment is read, and the payload is dropped.
   */
  async assess(input: AssessInput): Promise<PreAssessment> {
    const d = this.deps
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) {
      // A locked vault lists no accounts — and it must not, because the context
      // an assessment reads is sealed under the DEK. So "no such account" and
      // "locked" arrive here as the same silence; the status tells them apart.
      const status = await d.vault.status()
      if (status.exists && !status.unlocked)
        throw new EngineError('locked', 'Unlock BoltVault to preview a request.')
      throw new EngineError('not_found', 'no such account')
    }
    if (!d.chains.known(input.chainId))
      throw new EngineError('invalid_argument', `unknown chain ${input.chainId}`)
    const from = account.address as Hex
    const payload = await d.payloadFor(await this.intentFor(input, from))
    if (!('assessment' in payload))
      throw new EngineError('internal', 'that request has no assessment')
    return PreAssessmentSchema.parse({
      ...payload.assessment,
      origin: PREVIEW_ORIGIN,
      advisory: true,
    })
  }

  /** Settings › Spending as the firewall reads it, plus the ladder it drives (§3.4 points 5 and 6). */
  async policy(): Promise<SpendPolicyView> {
    const s = await this.deps.settings.get()
    return SpendPolicyViewSchema.parse({
      largeSendPercent: s.largeSendPercent,
      allowList: s.sendAllowList,
      allowListOnly: s.sendWhitelist,
      exactApprovals: s.exactApprovals,
      ethSignEnabled: s.ethSignEnabled,
      txPreview: s.txPreview,
      steps: SEVERITIES.map((severity) => {
        const p = presentationFor(severity, PREVIEW_ORIGIN)
        return {
          severity,
          delayMs: p.delayMs,
          typedConfirmation: p.typedConfirmation !== null,
          blocked: p.blocked,
        }
      }),
    })
  }

  private async intentFor(input: AssessInput, from: Hex): Promise<ApprovalIntent> {
    const common = {
      origin: PREVIEW_ORIGIN,
      chainId: input.chainId,
      accountId: input.accountId,
      clientRequestId: `preview:${input.chainId}`,
    }
    switch (input.request.kind) {
      case 'message':
        return { ...common, kind: 'sign_message', from, message: input.request.message as Hex }
      case 'typed_data':
        return {
          ...common,
          kind: 'sign_typed_data',
          from,
          typedData: input.request.typedData,
          version: 'v4',
        }
      case 'transaction':
        return {
          ...common,
          kind: 'send_transaction',
          tx: {
            from,
            // Omitted, not null: a contract deployment has no `to`, and that is
            // a request the firewall has something to say about.
            ...(input.request.to ? { to: input.request.to as Hex } : {}),
            value: toHexQuantity(input.request.value ?? '0'),
            data: (input.request.data ?? '0x') as Hex,
            /*
              The nonce is supplied so the payload builder does not reserve one.

              Preparing a transaction claims the next free nonce for the life of
              an approval, which is right for a sheet and wrong for a preview:
              a recipient field that re-previews on every keystroke would walk
              the account's nonce into the distance and leave a queue of numbers
              no transaction will ever use. It is read, not reserved — and the
              trace wants the real number anyway, because a contract may behave
              differently at a particular nonce.
            */
            nonce: toHexQuantity(String(await this.pendingNonce(input.chainId, from))),
          },
        }
    }
  }

  private async pendingNonce(chainId: number, from: Hex): Promise<number> {
    const raw = await this.deps.chains
      .rpc(chainId, 'eth_getTransactionCount', [from, 'pending'])
      .catch(() => null)
    const n = typeof raw === 'string' ? Number.parseInt(raw, 16) : Number.NaN
    return Number.isInteger(n) && n >= 0 ? n : UNKNOWN_NONCE
  }
}

/** Wire amounts are decimal or hex strings; the intent wants a hex quantity. */
function toHexQuantity(value: string): Hex {
  const trimmed = value.trim()
  const n =
    trimmed.startsWith('0x') || trimmed.startsWith('0X')
      ? BigInt(trimmed)
      : BigInt(trimmed === '' ? '0' : trimmed)
  return `0x${n.toString(16)}`
}

export function securityNamespace(security: SecurityService): NamespaceSpec {
  /*
    ui and internal only — which is the host's default, spelled out because
    here it is the security property rather than a default.

    An assessment reasons over the user's own accounts, the address book, what
    this wallet has sent to, balances, contract facts from the explorer and the
    scam lists. None of that is in the reply, but a caller that could choose the
    `to` of a request and read back the severity could learn it a bit at a time
    — "is this address one they have sent to?" is one call. A dApp's content
    script must therefore never reach this; its traffic goes through rpcFlow,
    which raises a real sheet a human answers. A paired device (`device`) is
    excluded for the same reason: §6 gives it a signing request, not a probe.
  */
  const allow = ['ui', 'internal'] as const
  return {
    assess: {
      input: AssessInputSchema,
      allow,
      handler: (arg) => security.assess(arg as AssessInput),
    },
    policy: { allow, handler: () => security.policy() },
  }
}
