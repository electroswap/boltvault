/**
 * SwapView (T5.4) — the stacked swap terminals, live fee line, min-out, and the
 * first-swap coach that must be dismissed before the breaker arms. Pure presentational
 * + state wiring; the decision layer is `computeSwapUiState` (tested separately).
 *
 * Design: Swap must fit 360×600 (stacked terminals). Three rates always: pool
 * price, Wallet fee 0.25%, net received. Stale (>8s) disarms; breaker is a
 * labeled `Sign` button, never a swipe.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { computeSwapUiState, feeCoachCopy, type SwapQuote } from './swap-ui-state'
import { TokenAvatar } from './TokenAvatar'

export interface SwapViewProps {
  readonly chainId: number
  readonly tokenIn: { address: string; symbol: string }
  readonly tokenOut: { address: string; symbol: string }
  /** The current on-chain quote (null before first quote / after disarm). */
  readonly quote: SwapQuote | null
  readonly now: number
  readonly priceImpactPct: number
  /** The pinned fee sink (null = in-wallet swap not enabled yet). */
  readonly sink: string | null
  readonly amountInDisplay: string
  readonly onSign?: () => void
}

export function SwapView(props: SwapViewProps): ReactNode {
  const [coachDismissed, setCoachDismissed] = useState(false)
  const state = useMemo(
    () =>
      computeSwapUiState({
        quote: props.quote,
        now: props.now,
        priceImpactPct: props.priceImpactPct,
        sink: props.sink,
        coachDismissed,
        tokenOutSymbol: props.tokenOut.symbol,
      }),
    [props.quote, props.now, props.priceImpactPct, props.sink, coachDismissed, props.tokenOut.symbol],
  )
  const coach = feeCoachCopy(props.sink ?? '0x…')

  return (
    <div data-testid="swap-view" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* stacked terminals */}
      <Terminal
        label="You pay"
        amount={props.amountInDisplay}
        token={props.tokenIn}
        chainId={props.chainId}
      />
      <div style={{ textAlign: 'center', color: 'var(--bv-mute)', fontSize: '11px' }}>→</div>
      <Terminal
        label="You receive (min)"
        amount={state.minOut != null ? state.minOut.toString() : '…'}
        token={props.tokenOut}
        chainId={props.chainId}
        testId="terminal-receive"
      />

      {/* three rates */}
      <div data-testid="swap-rates" style={{ color: 'var(--bv-mute)', fontSize: '12px', lineHeight: 1.7 }}>
        <div data-testid="rate-pool">Pool price · {props.priceImpactPct.toFixed(2)}% impact</div>
        <div data-testid="rate-fee" style={{ color: 'var(--bv-ink)' }}>
          Wallet fee 0.25%
          {state.fee != null ? ` · ${state.fee.toString()} ${props.tokenOut.symbol}` : ''}
        </div>
        <div style={{ color: 'var(--bv-ink)' }}>
          Net received {state.minOut != null ? `≥ ${state.minOut.toString()} ${props.tokenOut.symbol}` : ''}
        </div>
      </div>

      {/* fee sink line (names the sink, never "BoltVault") */}
      {state.feeLine != null && (
        <div data-testid="fee-line" style={{ color: 'var(--bv-mute)', fontSize: '11px' }}>
          {state.feeLine}
        </div>
      )}

      {/* price-impact warning */}
      {state.impactWarn && (
        <div data-testid="impact-warn" style={{ color: 'var(--bv-burn)', fontSize: '12px' }}>
          High price impact ({props.priceImpactPct.toFixed(1)}%)
        </div>
      )}
      {state.stale && (
        <div data-testid="stale" style={{ color: 'var(--bv-burn)', fontSize: '12px' }}>
          Quote stale — re-quoting
        </div>
      )}

      {/* first-swap coach — must dismiss before the breaker arms */}
      {!coachDismissed && (
        <div
          data-testid="fee-coach"
          style={{
            padding: '12px',
            borderRadius: '8px',
            background: 'var(--bv-glass)',
            color: 'var(--bv-ink)',
            fontSize: '12px',
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: 'var(--bv-arc)', fontWeight: 600, marginBottom: '6px' }}>
            First swap — the 0.25% wallet fee
          </div>
          <div>{coach.example}</div>
          <div style={{ color: 'var(--bv-mute)', marginTop: '4px' }}>{coach.sinkLine}</div>
          <div style={{ color: 'var(--bv-mute)' }}>{coach.dappNote}</div>
          <div style={{ color: 'var(--bv-mute)', marginBottom: '8px' }}>{coach.hardwareNote}</div>
          <button
            data-testid="fee-coach-continue"
            onClick={() => setCoachDismissed(true)}
            style={{
              width: '100%',
              height: 'var(--bv-hit)',
              background: 'var(--bv-arc)',
              color: 'var(--bv-void)',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--bv-font-sora)',
            }}
          >
            Continue
          </button>
        </div>
      )}

      {/* labeled breaker — arms only after the coach + a fresh, sane quote */}
      <button
        data-testid="swap-sign"
        disabled={!state.armed}
        onClick={props.onSign}
        style={{
          width: '100%',
          height: 'var(--bv-hit)',
          background: state.armed ? 'var(--bv-arc)' : 'var(--bv-glass)',
          color: state.armed ? 'var(--bv-void)' : 'var(--bv-mute)',
          border: 'none',
          borderRadius: '8px',
          fontWeight: 600,
          fontSize: '14px',
          cursor: state.armed ? 'pointer' : 'default',
          fontFamily: 'var(--bv-font-sora)',
        }}
      >
        {state.armed ? 'Sign' : 'Sign'}
      </button>
    </div>
  )
}

function Terminal(props: {
  label: string
  amount: string
  token: { address: string; symbol: string }
  chainId: number
  testId?: string
}): ReactNode {
  return (
    <div
      data-testid={props.testId ?? 'terminal'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px',
        background: 'var(--bv-glass)',
        borderRadius: '10px',
      }}
    >
      <TokenAvatar chainId={props.chainId} address={props.token.address} size={32} />
      <div style={{ flex: 1 }}>
        <div style={{ color: 'var(--bv-mute)', fontSize: '11px' }}>{props.label}</div>
        <div style={{ color: 'var(--bv-ink)', fontSize: '18px', fontFamily: 'var(--bv-font-oxanium)' }}>
          {props.amount}
        </div>
      </div>
      <div style={{ color: 'var(--bv-ink)', fontSize: '14px', fontWeight: 600 }}>{props.token.symbol}</div>
    </div>
  )
}
