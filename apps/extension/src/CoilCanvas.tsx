/**
 * CoilCanvas (G) — the full-tab "coil" rendered with Canvas 2D (design §Motion
 * budget: "Canvas 2D (extension tab). No Three.js in the extension. Full-tab
 * may use Skia for the coil and bolt stroke" — here it's Canvas 2D, the
 * extension-appropriate stand-in for the Skia coil).
 *
 * The coil is the farm duration-multiplier ring (1.0 → 2.5). It advances ONE
 * travel per block tick (the `pulse` prop is the block number); the leading
 * edge carries a charged "bolt" tip. `prefers-reduced-motion` (or `active`
 * false) → a still ring with a number, no rotation (design §Motion).
 *
 * Pure presentation + a rAF loop; no DOM beyond the <canvas>.
 */
import { useEffect, useRef } from 'react'
import { palette } from '@boltvault/design'

export interface CoilCanvasProps {
  /** 0..1 — how far along the ramp the coil is filled (value/max-1). */
  progress: number
  /** Bumped on each block tick; one charge-travel per change. */
  pulse: number
  /** Heartbeat active (false → hold, no new travel). */
  active: boolean
  /** Reduced-motion: draw a still ring, no rotation/glow pulse. */
  reducedMotion?: boolean
  size?: number
  testId?: string
}

export function CoilCanvas({
  progress,
  pulse,
  active,
  reducedMotion = false,
  size = 220,
  testId,
}: CoilCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raf = useRef<number>(0)
  // The animated fill eases toward `progress`; the bolt tip rides the edge.
  const fill = useRef(0)
  const spin = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1)
    const px = Math.round(size * dpr)
    canvas.width = px
    canvas.height = px

    const target = Math.max(0, Math.min(1, progress))
    const lastPulse = { v: pulse }

    const draw = () => {
      const c = ctx
      const w = px
      const cx = w / 2
      const cy = w / 2
      const rOuter = w / 2 - 6 * dpr
      const thick = 12 * dpr

      c.clearRect(0, 0, w, w)

      // Track (glass).
      c.lineWidth = thick
      c.lineCap = 'round'
      c.strokeStyle = palette.glass
      c.beginPath()
      c.arc(cx, cy, rOuter, 0, Math.PI * 2)
      c.stroke()

      // Filled arc — plasma→arc gradient, from the top (−90°) clockwise.
      fill.current += (target - fill.current) * (reducedMotion ? 1 : 0.12)
      const start = -Math.PI / 2
      const end = start + fill.current * Math.PI * 2
      const grad = c.createLinearGradient(0, 0, w, w)
      grad.addColorStop(0, palette.plasma)
      grad.addColorStop(1, palette.arc)
      c.strokeStyle = grad
      c.beginPath()
      c.arc(cx, cy, rOuter, start, end)
      c.stroke()

      // Bolt tip — a charged node at the leading edge.
      if (!reducedMotion && fill.current > 0.001) {
        const tx = cx + Math.cos(end) * rOuter
        const ty = cy + Math.sin(end) * rOuter
        const glow = c.createRadialGradient(tx, ty, 0, tx, ty, 18 * dpr)
        glow.addColorStop(0, palette.arc)
        glow.addColorStop(1, 'rgba(92,225,255,0)')
        c.fillStyle = glow
        c.beginPath()
        c.arc(tx, ty, 18 * dpr, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = palette.void
        c.beginPath()
        c.arc(tx, ty, 4 * dpr, 0, Math.PI * 2)
        c.fill()
      }
    }

    const loop = () => {
      // Advance one "travel" of subtle rotation per pulse change (the coil
      // is NOT a hypnotic ring — rotation is a slow charge, not a spin).
      if (!reducedMotion && active) {
        spin.current += 0.002
      }
      // Re-stamp the pulse so a block tick nudges the eased fill forward.
      if (lastPulse.v !== pulse) {
        lastPulse.v = pulse
        // one travel: nudge fill toward target a bit more
        fill.current = Math.min(target, fill.current + 0.02)
      }
      draw()
      raf.current = requestAnimationFrame(loop)
    }

    // Reduced motion: draw once (still ring), no rAF loop.
    if (reducedMotion) {
      fill.current = target
      draw()
    } else {
      raf.current = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(raf.current)
  }, [progress, pulse, active, reducedMotion, size])

  return (
    <canvas
      ref={canvasRef}
      data-testid={testId ?? 'coil'}
      style={{ width: size, height: size, display: 'block' }}
      aria-label="farm coil"
    />
  )
}
