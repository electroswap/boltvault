/**
 * Farm — the coil (design §Farm).
 *
 * "The coil": the duration multiplier is a ring, 1.0 → 2.5 (Gauge, static —
 * not a twitchy coil). The BOLT boost is a SECOND INNER RING (stair 1.00 /
 * 1.05 / 1.15). The dilution warning is a PLATE, not a tooltip, shown before
 * a second deposit would reset the ramp.
 *
 * Display-level in v1: data is injected as props (parsed Farm[] rows), no
 * network here.
 */
import { useState } from 'react'
import { Gauge, Breaker, IconAlert } from '@boltvault/design'
import { durationMultiplier, boltStairsMultiplier, dilutionWarning } from '@boltvault/farm'

const MAX_MULT = 2.5

export function FarmView({ farms = [] }: { farms?: any[] }) {
  const farm: any = farms[0] ?? null
  const [hasPosition, setHasPosition] = useState<boolean>(farm?.startBlock != null)

  // Duration ring: the multiplier at the current block for this position's ramp.
  const mult = durationMultiplier(
    Number(farm?.nowBlock ?? 0),
    Number(farm?.startBlock ?? 0),
  )

  // BOLT boost ring: stair 1.00 / 1.05 / 1.15.
  const boltMult = boltStairsMultiplier(farm?.boltDeposited ?? 0)
  const boltPct = Math.max(0, Math.min(1, (boltMult - 1) / (MAX_MULT - 1))) * 100

  // Design: the dilution warning is a plate before a SECOND deposit —
  // depositing again resets the ramp and dilutes the earned multiplier.
  const diluting =
    hasPosition && dilutionWarning({
      currentMultiplier: mult,
      newStartBlock: Number(farm?.nowBlock ?? 0),
      nowBlock: Number(farm?.nowBlock ?? 0),
    })

  return (
    <div data-testid="farm" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* The coil — duration ring (1.0 → 2.5) + the BOLT inner ring. */}
      <div
        data-testid="farm-gauge"
        style={{
          width: '140px',
          height: '140px',
          margin: '0 auto',
          borderRadius: '50%',
          // Duration multiplier as a conic ring (1.0 → 2.5 maps to 0 → 100%).
          background: `conic-gradient(var(--bv-plasma) ${mult}%, transparent 0)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* BOLT boost — the second inner ring (stair, not linear). */}
        <div
          data-testid="farm-bolt-ring"
          style={{
            width: '104px',
            height: '104px',
            borderRadius: '50%',
            background: `conic-gradient(var(--bv-ember) ${boltPct}%, transparent 0)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              background: 'var(--bv-glass)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontFamily: 'var(--bv-font-oxanium)', fontWeight: 600, fontSize: '16px', color: 'var(--bv-ink)' }}>
              {mult.toFixed(2)}x
            </span>
            <span style={{ color: 'var(--bv-mute)', fontSize: '10px' }}>BOLT {boltMult.toFixed(2)}x</span>
          </div>
        </div>
      </div>

      <Gauge
        value={mult}
        max={MAX_MULT}
        label={
          <div>
            <div style={{ color: 'var(--bv-ink)', fontSize: '13px' }}>{farm?.name ?? 'Yield farm'}</div>
            <div style={{ color: 'var(--bv-mute)', fontSize: '11px' }}>
              Duration {mult.toFixed(2)}x → 2.50x · BOLT {boltMult.toFixed(2)}x
            </div>
          </div>
        }
      />

      {/* Dilution plate — a plate, not a tooltip — before a second deposit. */}
      {diluting && (
        <div
          data-testid="farm-dilution"
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
            padding: '10px 12px',
            background: 'var(--bv-glass)',
            borderRadius: '8px',
            border: '1px solid var(--bv-ember)',
            color: 'var(--bv-ink)',
            fontSize: '12px',
            fontFamily: 'var(--bv-font-sora)',
          }}
        >
          <IconAlert size={16} />
          <span>
            A new deposit restarts the coil at 1.00x — you are sitting at {mult.toFixed(2)}x now.
          </span>
        </div>
      )}

      <Breaker
        label={hasPosition ? 'Deposit more' : 'Deposit'}
        armed={hasPosition ? !diluting : true}
        testId="farm-deposit"
        onClick={() => setHasPosition(true)}
      />
    </div>
  )
}
