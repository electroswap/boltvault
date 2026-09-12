/**
 * Crash reports (master plan §3.7): off by default, opt-in under Settings ›
 * About, sent to ElectroSwap's own Sentry-compatible endpoint with every
 * 0x address, hex secret and URL query scrubbed. No SDK; a message, a stack,
 * the version and the body. Never the user's address, never a balance.
 */
export const CRASH_ENDPOINT = `${__API_ORIGIN__}/api/wallet/crash`

export interface CrashReport {
  readonly message: string
  readonly stack: string | null
  readonly version: string
  readonly body: 'extension-worker' | 'extension-page' | 'mobile'
  readonly at: number
}

/** Remove anything that could identify an account or leak a secret. */
export function scrub(text: string): string {
  return text
    .replace(/0x[0-9a-fA-F]{40,}/g, '0x…')
    .replace(/\b[0-9a-fA-F]{64}\b/g, '…')
    .replace(/(\?|#)[^\s)]+/g, '$1…')
    .replace(/\b(\w+\s){11}\w+\b/g, (m) =>
      m.split(/\s+/).every((w) => /^[a-z]{3,8}$/.test(w)) ? '[words]' : m,
    )
}

export function toReport(err: unknown, body: CrashReport['body'], version: string): CrashReport {
  const e = err instanceof Error ? err : new Error(String(err))
  return {
    message: scrub(e.message).slice(0, 500),
    stack: e.stack ? scrub(e.stack).slice(0, 4_000) : null,
    version,
    body,
    at: Date.now(),
  }
}

export function installCrashReporter(input: {
  body: CrashReport['body']
  version: string
  enabled: () => Promise<boolean>
  fetchImpl?: typeof fetch
  endpoint?: string
}): () => void {
  const send = async (err: unknown): Promise<void> => {
    try {
      if (!(await input.enabled())) return
      const report = toReport(err, input.body, input.version)
      await (input.fetchImpl ?? fetch)(input.endpoint ?? CRASH_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
        keepalive: true,
      })
    } catch {
      // never let the reporter itself throw
    }
  }
  const onError = (ev: ErrorEvent): void => void send(ev.error ?? ev.message)
  const onRejection = (ev: PromiseRejectionEvent): void => void send(ev.reason)
  globalThis.addEventListener('error', onError)
  globalThis.addEventListener('unhandledrejection', onRejection)
  return () => {
    globalThis.removeEventListener('error', onError)
    globalThis.removeEventListener('unhandledrejection', onRejection)
  }
}
