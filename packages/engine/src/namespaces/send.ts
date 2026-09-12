/**
 * Send (master plan §8.4): quote (recipient resolution, balance and fee
 * checks) and submit — which creates an `internal:send` approval so the same
 * firewall, statements and sheet apply as for a dApp transaction. The result
 * lands in Activity under the request id.
 */
import type { Platform } from '@boltvault/platform'
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
  type Hex,
} from 'viem'
import { z } from 'zod'
import { getChain } from '@boltvault/chains'
import { amountOrProblem } from '../amount'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import { AccountIdSchema, type SendQuote } from '../schema'
import type { ChainsService } from './chains'
import type { NamesService } from './names'
import type { ProviderService } from './provider'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const ERC20 = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
])

export interface SendDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly tokens: TokensService
  readonly names: NamesService
  readonly vault: VaultManager
  readonly provider: ProviderService
}

export interface SendInput {
  readonly accountId: string
  readonly chainId: number
  /** 'native' or a token address in the universe. */
  readonly token: string
  /** Address or a name (`.etn` / `.eth`). */
  readonly to: string
  /** Human amount, decimal string. */
  readonly amount: string
}

export class SendService {
  constructor(private readonly deps: SendDeps) {}

  private async recipient(
    chainId: number,
    to: string,
  ): Promise<{ address: Hex | null; name: string | null; problem: string | null }> {
    const input = to.trim()
    if (isAddress(input)) return { address: getAddress(input), name: null, problem: null }
    if (this.deps.names.isName(chainId, input)) {
      const address = await this.deps.names.resolve(chainId, input)
      return address
        ? { address: address as Hex, name: input.toLowerCase(), problem: null }
        : {
            address: null,
            name: input.toLowerCase(),
            problem: 'That name does not resolve to an address.',
          }
    }
    return { address: null, name: null, problem: 'Enter a full address or a name.' }
  }

  async quote(input: SendInput): Promise<SendQuote> {
    const d = this.deps
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const token = await d.tokens.get(input.chainId, input.token)
    if (!token) throw new EngineError('invalid_argument', 'unknown token')
    const problems: string[] = []
    const rcpt = await this.recipient(input.chainId, input.to)
    if (rcpt.problem) problems.push(rcpt.problem)
    // Exactly what was typed, or a reason why the token cannot hold it
    // (ES-BV-048); never a rounded figure the form did not show.
    const amountRaw = amountOrProblem(input.amount, token.decimals, problems)
    if (amountRaw <= 0n) problems.push('Enter an amount above zero.')
    const owner = account.address as Hex
    // What this chain charges its fees in. It was the literal string 'ETN' on
    // every chain, which is wrong the moment the wallet is not on Electroneum.
    const feeSymbol = getChain(input.chainId)?.nativeCurrency.symbol ?? 'ETN'
    const nativeBalance = BigInt(
      String(
        (await d.chains
          .rpc(input.chainId, 'eth_getBalance', [owner, 'latest'])
          .catch(() => '0x0')) ?? '0x0',
      ),
    )
    let balanceRaw = nativeBalance
    if (token.address !== 'native') {
      const [r] = await readMany(d.chains, input.chainId, [
        { address: token.address as Hex, abi: ERC20, functionName: 'balanceOf', args: [owner] },
      ])
      balanceRaw = r?.ok && typeof r.value === 'bigint' ? r.value : 0n
    }
    /*
      Priced the way the transaction will actually be priced.

      `eth_gasPrice` is the legacy answer, and `prepare()` signs an EIP-1559
      transaction wherever the chain has a base fee — at `2 × baseFee + tip`,
      which on a busy chain is well above what `eth_gasPrice` reported. So MAX
      reserved less than the transaction would cost and the pool refused the
      send for insufficient funds. On Electroneum the base fee is zero and the
      two agree, which is why this never showed up at home.
    */
    const [head, gasPriceRaw, tipRaw] = await Promise.all([
      d.chains
        .rpc(input.chainId, 'eth_getBlockByNumber', ['latest', false])
        .catch(() => null) as Promise<{ baseFeePerGas?: string } | null>,
      d.chains.rpc(input.chainId, 'eth_gasPrice', []).catch(() => '0x3b9aca00'),
      d.chains.rpc(input.chainId, 'eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00'),
    ])
    const baseFee = head?.baseFeePerGas ? BigInt(head.baseFeePerGas) : 0n
    const perGas =
      baseFee > 0n
        ? baseFee * 2n + BigInt(String(tipRaw ?? '0x0'))
        : BigInt(String(gasPriceRaw ?? '0x3b9aca00'))
    const gas = token.address === 'native' ? 21_000n : 65_000n
    const feeWei = gas * perGas
    if (token.address === 'native') {
      if (amountRaw + feeWei > nativeBalance)
        problems.push('Not enough for the amount plus the network fee.')
    } else {
      if (amountRaw > balanceRaw) problems.push(`Not enough ${token.symbol}.`)
      if (feeWei > nativeBalance) problems.push(`Not enough ${feeSymbol} for the network fee.`)
    }
    if (account.kind === 'watch')
      problems.push('Watch-only — import a key or pair a device to send.')
    /*
      MAX leaves room for the fee to move.

      It used to subtract exactly the fee this quote measured, which is the fee
      at the gas price of the moment it asked — so a MAX send that sat in the
      approval sheet for ten seconds through a rising market could fail for
      being one wei short of its own gas. A fifth over is a cheap margin against
      that: it costs a rounding error of ETN and it means MAX sends land. Owner:
      "clicking MAX should account for the network fee of ETN plus a 20%
      buffer."
    */
    const feeReserve = (feeWei * 120n) / 100n
    const maxRaw =
      token.address === 'native'
        ? nativeBalance > feeReserve
          ? nativeBalance - feeReserve
          : 0n
        : balanceRaw
    return {
      to: rcpt.address,
      name: rcpt.name,
      token: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
      amountRaw: amountRaw.toString(),
      balanceRaw: balanceRaw.toString(),
      maxRaw: maxRaw.toString(),
      max: formatUnits(maxRaw, token.decimals),
      feeWei: feeWei.toString(),
      feeSymbol,
      ok: problems.length === 0 && rcpt.address !== null,
      problems,
    }
  }

  /** Create the approval; the sheet (Approval screen) decides; Activity carries the result. */
  async submit(input: SendInput): Promise<{ requestId: string; to: string }> {
    const d = this.deps
    const quote = await this.quote(input)
    if (!quote.ok || !quote.to)
      throw new EngineError('invalid_argument', quote.problems[0] ?? 'cannot send')
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const from = account.address as Hex
    const tx =
      quote.token === 'native'
        ? { from, to: quote.to as Hex, value: `0x${BigInt(quote.amountRaw).toString(16)}` as Hex }
        : {
            from,
            to: quote.token as Hex,
            value: '0x0' as Hex,
            data: encodeFunctionData({
              abi: ERC20,
              functionName: 'transfer',
              args: [quote.to as Hex, BigInt(quote.amountRaw)],
            }),
          }
    const { requestId } = await d.provider.submitInternal({
      kind: 'send_transaction',
      origin: 'internal:send',
      chainId: input.chainId,
      accountId: input.accountId,
      tx,
      clientRequestId: `send:${d.platform.now()}:${quote.to}`,
    })
    return { requestId, to: quote.to }
  }
}

const InputSchema = z.object({
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  token: z.string(),
  to: z.string().max(255),
  amount: z.string().max(80),
})

export function sendNamespace(send: SendService): NamespaceSpec {
  return {
    quote: { input: InputSchema, handler: (arg) => send.quote(arg as SendInput) },
    submit: { input: InputSchema, handler: (arg) => send.submit(arg as SendInput) },
  }
}
