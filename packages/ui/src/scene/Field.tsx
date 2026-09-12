/**
 * The Field — web renderer: one WebGL2 quad, one fragment shader, ≤ 15 KB,
 * 30 fps cap, paused when the document is hidden, half resolution on high
 * DPR (master plan §2.7 S12). Metro picks Field.native.tsx instead.
 *
 * The GL context is created once per mount and never lost on prop changes:
 * props flow through refs into the frame loop, and only a size change touches
 * the canvas. (A lost context cannot be recreated on the same canvas.)
 */
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { fieldSeed } from '../hash'
import { paint } from '../tokens'
import { CIRCUIT_FRAGMENT_GLSL } from './circuit.glsl'
import { FIELD_FRAGMENT_GLSL, FIELD_VERTEX_GLSL } from './field.glsl'
import type { FieldProps } from './Field.types'

interface Gl {
  gl: WebGL2RenderingContext
  u: Record<'res' | 'time' | 'seed' | 'pulse' | 'touch' | 'warmth', WebGLUniformLocation | null>
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('field: cannot create shader')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'unknown'
    gl.deleteShader(sh)
    throw new Error(`field: shader failed: ${log}`)
  }
  return sh
}

function setup(canvas: HTMLCanvasElement, fragment: string): Gl | null {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: true,
  })
  if (!gl) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, FIELD_VERTEX_GLSL))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(`field: link failed: ${gl.getProgramInfoLog(program) ?? ''}`)
  gl.useProgram(program)
  return {
    gl,
    u: {
      res: gl.getUniformLocation(program, 'u_res'),
      time: gl.getUniformLocation(program, 'u_time'),
      seed: gl.getUniformLocation(program, 'u_seed'),
      pulse: gl.getUniformLocation(program, 'u_pulse'),
      touch: gl.getUniformLocation(program, 'u_touch'),
      warmth: gl.getUniformLocation(program, 'u_warmth'),
    },
  }
}

interface Live {
  seed: readonly [number, number, number, number]
  pulse: number
  touch: [number, number, number]
  warmth: number
  quiet: boolean
  reducedMotion: boolean
  fps: number
}

export function Field({
  address,
  pulse = 0,
  warmth = 0,
  intensity = 1,
  quiet = false,
  reducedMotion = false,
  fps = 30,
  scene = 'grid',
  width,
  height,
  testID,
}: FieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<Gl | null>(null)
  const live = useRef<Live>({
    seed: fieldSeed(address),
    pulse: 0,
    touch: [0.5, 0.5, 0],
    warmth,
    quiet,
    reducedMotion,
    fps,
  })
  const dirty = useRef(true)

  // Props → the frame loop, without touching the GL context.
  useEffect(() => {
    live.current.seed = fieldSeed(address)
    dirty.current = true
  }, [address])
  useEffect(() => {
    live.current.pulse = Math.max(live.current.pulse, pulse)
    dirty.current = true
  }, [pulse])
  useEffect(() => {
    Object.assign(live.current, { warmth, quiet, reducedMotion, fps })
    dirty.current = true
  }, [warmth, quiet, reducedMotion, fps])

  // Size → the canvas backing store.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    const scale = dpr >= 2 ? 0.5 : 0.75
    canvas.width = Math.max(1, Math.floor(width * dpr * scale))
    canvas.height = Math.max(1, Math.floor(height * dpr * scale))
    ctxRef.current?.gl.viewport(0, 0, canvas.width, canvas.height)
    dirty.current = true
  }, [width, height])

  // One context per mount; one frame loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let ctx: Gl | null = null
    try {
      ctx = setup(canvas, scene === 'circuit' ? CIRCUIT_FRAGMENT_GLSL : FIELD_FRAGMENT_GLSL)
    } catch {
      ctx = null
    }
    if (!ctx) return
    ctxRef.current = ctx
    const { gl, u } = ctx
    gl.viewport(0, 0, canvas.width, canvas.height)

    const start = performance.now()
    let raf = 0
    let last = 0
    let stopped = false
    const draw = (now: number): void => {
      if (stopped) return
      raf = requestAnimationFrame(draw)
      const s = live.current
      if (now - last < 1000 / s.fps) return
      // A still frame renders once (and again whenever a prop changed).
      if (s.reducedMotion && !dirty.current && s.pulse < 0.01) return
      last = now
      dirty.current = false
      const t = s.reducedMotion ? 3.7 : (now - start) / 1000
      s.pulse *= 0.82
      gl.uniform2f(u.res, canvas.width, canvas.height)
      gl.uniform4f(u.seed, s.seed[0], s.seed[1], s.seed[2], s.seed[3])
      gl.uniform1f(u.time, t)
      gl.uniform1f(u.pulse, s.quiet ? 0 : s.pulse)
      gl.uniform3f(u.touch, s.touch[0], s.touch[1], s.quiet ? 0 : s.touch[2])
      gl.uniform1f(u.warmth, s.warmth)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    raf = requestAnimationFrame(draw)

    const onVisibility = (): void => {
      if (document.hidden) {
        stopped = true
        cancelAnimationFrame(raf)
      } else if (stopped) {
        stopped = false
        dirty.current = true
        raf = requestAnimationFrame(draw)
      }
    }
    const host = canvas.parentElement
    const onMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect()
      live.current.touch = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height, 1]
      dirty.current = true
    }
    const onLeave = (): void => {
      live.current.touch = [live.current.touch[0], live.current.touch[1], 0]
      dirty.current = true
    }
    document.addEventListener('visibilitychange', onVisibility)
    host?.addEventListener('pointermove', onMove)
    host?.addEventListener('pointerleave', onLeave)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      host?.removeEventListener('pointermove', onMove)
      host?.removeEventListener('pointerleave', onLeave)
      ctxRef.current = null
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    // `scene` is a dependency: a compiled program cannot be swapped on a live
    // context, so changing the background rebuilds it. That only happens from
    // the settings screen, never in a frame.
  }, [scene])

  const opacity = (quiet ? 0.15 : 1) * intensity
  // Off means off: no canvas, no context, no frame loop.
  if (scene === 'off')
    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          backgroundColor: paint.void,
          zIndex: 0,
        }}
        testID={testID}
      />
    )
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        backgroundColor: paint.void,
        opacity,
        zIndex: 0,
      }}
      testID={testID}
    >
      <canvas ref={canvasRef} style={{ width, height, display: 'block' }} aria-hidden="true" />
    </View>
  )
}
