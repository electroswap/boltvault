// @boltvault/design — TokenAvatar (the logo pipeline as a React component).
//
// `pickLogo` is the pure, testable core: given the ordered `logoCandidates`
// list it walks them with a 2s timeout and resolves to the first that loads,
// or `null` (→ the identicon last frame). The component renders an `<img>`
// that starts on the identicon data-URI and swaps in the winner when one
// resolves — a bus bar is *never* a blank disc. (Moved from apps/extension.)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  logoCandidates,
  identiconDataUri,
  type LogoCandidatesInput,
} from '@boltvault/electroswap'

/** Injectable probe — defaults to the real Image-based loader. */
export type LogoProbe = (url: string, timeoutMs: number) => Promise<boolean>

/**
 * Walk the candidate list (in order) and return the first URL that loads
 * within `timeoutMs`, or `null` if none do (caller falls back to identicon).
 * `probe` is injectable for tests.
 */
export async function pickLogo(
  input: LogoCandidatesInput,
  opts: { probe?: LogoProbe; timeoutMs?: number } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 2000
  const probe = opts.probe ?? defaultImageProbe
  for (const url of logoCandidates(input)) {
    try {
      if (await probe(url, timeoutMs)) return url
    } catch {
      /* fail-soft: try the next candidate */
    }
  }
  return null
}

/** Real loader: an off-DOM Image with a timeout. `true` on load, else false. */
export function defaultImageProbe(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    try {
      const img = new Image()
      img.onload = () => finish(true)
      img.onerror = () => finish(false)
      img.src = url
    } catch {
      finish(false)
    }
  })
}

export interface TokenAvatarProps {
  readonly chainId: number
  readonly address: string
  readonly logoURI?: string
  readonly coingeckoId?: string
  /** Pixel size (default 32). */
  readonly size?: number
  /** Extra CSS class. */
  readonly className?: string
}

/**
 * Renders a token's logo as a rounded disc. Starts on the deterministic
 * identicon (always painted) and swaps to the first candidate that loads.
 * The identicon is our own generated SVG (safe via `<img>` data-URI) so a bus
 * bar is never a blank disc even fully offline.
 */
export function TokenAvatar(props: TokenAvatarProps): ReactNode {
  const size = props.size ?? 32
  const identicon = useMemo(() => identiconDataUri(props.address, size), [props.address, size])
  const [src, setSrc] = useState<string>(identicon)
  const started = useRef(false)

  useEffect(() => {
    setSrc(identicon)
    started.current = false
  }, [identicon, props.chainId])

  useEffect(() => {
    if (started.current) return
    started.current = true
    let alive = true
    void pickLogo({
      chainId: props.chainId,
      address: props.address,
      logoURI: props.logoURI,
      coingeckoId: props.coingeckoId,
    }).then((winner) => {
      if (alive && winner) setSrc(winner)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.chainId, props.address, props.logoURI, props.coingeckoId])

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={`${props.address.slice(0, 6)}…logo`}
      className={props.className}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
    />
  )
}
