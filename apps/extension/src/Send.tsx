/**
 * SendView (E) — the Send surface.
 *
 * Design law (the design spec): "Clamp + amount + breaker. Poison check
 * BEFORE the breaker arms." One verb from the closed table: **Send**.
 *
 * v1 is presentational + pure wiring: the recipient, the amount clamp (max =
 * balance), and the poison pill check drive whether the Send Breaker is armed.
 * The balance is a placeholder (no live balance read yet) and the
 * recent-recipient history is in-memory (injected for tests). No network.
 *
 * Empty / invalid state is an "invitation with a verb" — never a sad mascot.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { poisonCheck } from '@boltvault/security'
import { Breaker, IconAlert, IconBolt } from '@boltvault/design'

/** Placeholder balance (no live balance read in v1) — the amount clamp ceiling. */
const PLACEHOLDER_BALANCE = 12.5

/** Default in-memory recent-recipient history (the poison-check corpus). */
const DEFAULT_HISTORY: readonly string[] = [
  '0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63',
]

export interface SendViewProps {
  /** The seated (from) account — shown in the header. */
  account: string
  /** Called when the Send Breaker is pressed (armed only). */
  onSent: () => void
  /** Recent-recipient history for the poison check (injectable, in-memory). */
  history?: readonly string[]
  /** The spendable balance — the amount clamp ceiling. */
  balance?: number
  testId?: string
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function SendView({
  account,
  onSent,
  history = DEFAULT_HISTORY,
  balance = PLACEHOLDER_BALANCE,
  testId = 'send',
}: SendViewProps): ReactNode {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')

  const recipientTrim = recipient.trim()
  const recipientValid = recipientTrim.length >= 8

  // Amount clamp: parse + clamp to [0, balance]. max = balance.
  const amountNum = amount === '' ? 0 : Number.parseFloat(amount)
  const amountClean = Number.isFinite(amountNum)
  const overMax = amountClean && amountNum > balance
  const amountValid = amountClean && amountNum > 0 && amountNum <= balance

  // Poison check runs BEFORE the breaker arms (design law).
  const poison = useMemo(
    () => (recipientValid ? poisonCheck(recipientTrim, [...history]) : { hit: false, match: null }),
    [recipientTrim, recipientValid, history],
  )

  // Armed only when recipient + amount are valid AND not poisoned.
  const armed = recipientValid && amountValid && !poison.hit
  const empty = recipientTrim === '' && amount === ''

  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        color: 'var(--bv-ink)',
        fontFamily: 'var(--bv-font-sora)',
      }}
    >
      {/* Header — the seated key sends. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconBolt size={16} />
        <span style={{ fontSize: 13 }}>
          Sending from <span style={{ color: 'var(--bv-mute)' }}>{shortAddr(account)}</span>
        </span>
      </div>

      {/* Invitation with a verb — the empty / invalid state. No sad mascot. */}
      {empty && (
        <div
          data-testid={`${testId}-invite`}
          style={{ color: 'var(--bv-mute)', fontSize: 13, lineHeight: 1.5 }}
        >
          Send ETN to anyone on ETN — enter an address + amount to arm the breaker.
        </div>
      )}

      {/* Recipient */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ color: 'var(--bv-mute)', fontSize: 12 }}>Recipient</span>
        <input
          data-testid={`${testId}-recipient`}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x… recipient address"
          spellCheck={false}
          style={inputStyle}
        />
      </label>

      {/* Poison — burn plate, shown only when a known address is mimicked. */}
      {poison.hit && (
        <div
          data-testid={`${testId}-poison`}
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--bv-glass)',
            border: '1px solid var(--bv-burn)',
            borderRadius: 8,
            color: 'var(--bv-burn)',
            fontSize: 12,
            fontFamily: 'var(--bv-font-sora)',
          }}
        >
          <IconAlert size={16} />
          <span>
            Looks like a past recipient — matches {poison.match ? shortAddr(poison.match) : 'a known address'}.
            Verify before sending.
          </span>
        </div>
      )}

      {/* Amount + clamp (max = balance). */}
      <label
        data-testid={`${testId}-amount`}
        style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ color: 'var(--bv-mute)', fontSize: 12 }}>Amount</span>
          <span style={{ color: 'var(--bv-mute)', fontSize: 12, fontFamily: 'var(--bv-font-oxanium)' }}>
            balance {balance.toFixed(2)} ETN
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.0"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            data-testid={`${testId}-max`}
            onClick={() => setAmount(balance.toFixed(2))}
            style={{
              height: 'var(--bv-hit)',
              padding: '0 16px',
              background: 'var(--bv-glass)',
              color: 'var(--bv-arc)',
              border: '1px solid var(--bv-glass)',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'var(--bv-font-sora)',
            }}
          >
            Max
          </button>
        </div>
        {overMax && (
          <span style={{ color: 'var(--bv-burn)', fontSize: 11 }}>
            Over balance — clamps to {balance.toFixed(2)} ETN.
          </span>
        )}
      </label>

      {/* The labeled Send Breaker — armed only when valid + not poisoned. */}
      <Breaker
        label="Send"
        armed={armed}
        variant="arc"
        testId={`${testId}-breaker`}
        onClick={onSent}
      />
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bv-glass)',
  color: 'var(--bv-ink)',
  border: '1px solid var(--bv-glass)',
  borderRadius: 8,
  padding: '0 12px',
  height: 'var(--bv-hit)',
  fontFamily: 'var(--bv-font-oxanium)',
  fontSize: 14,
  outline: 'none',
}

export type { CSSProperties } from 'react'
