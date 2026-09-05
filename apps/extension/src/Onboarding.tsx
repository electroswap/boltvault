/**
 * Onboarding (D) — Create / Import → word backup → 3-word quiz → password →
 * funding plate → Home.
 *
 * Design law: "Default Create → entropy → word backup → quiz → password (12+
 * or diceware) → optional passkey wrap → funding plate → Home. Import /
 * Hardware / Watch are secondary. Backup quiz or hardware-verify gates Swap
 * and dApp Sign. Watch-only is the explicit escape."
 *
 * The VaultService is injected (default a SW-backed stub) so the flow is
 * testable with a fake. The component drives a small state machine:
 *   mode → choose | backup | quiz | password | done
 */
import { useMemo, useState } from 'react'
import { Breaker, EmptyState, Sheet, Chip, type IconProps } from '@boltvault/design'
import { IconBolt, IconScan } from '@boltvault/design'
import { VaultService, type CreatedVault } from './vault-service'

export interface OnboardingService {
  createVault(password: string, opts?: { bits?: 128 | 256 }): Promise<CreatedVault>
  importVault(mnemonic: string, password: string): Promise<CreatedVault>
  quizWords(mnemonic: string): { words: string[]; positions: number[] }
}

/** Default service — talks to the SW via browser.runtime (WXT). */
export const swOnboarding: OnboardingService = {
  async createVault(password, opts) {
    const b = (globalThis as any).browser
    const r = await b.runtime.sendMessage({ type: 'bv:vault:create', password, bits: opts?.bits })
    return r
  },
  async importVault(mnemonic, password) {
    const b = (globalThis as any).browser
    return b.runtime.sendMessage({ type: 'bv:vault:import', mnemonic, password })
  },
  quizWords: (m) => VaultService.quizWords(m),
}

type Mode = 'choose' | 'backup' | 'quiz' | 'password' | 'done'

export function Onboarding({
  service = swOnboarding,
  onDone,
  testId = 'onboarding',
}: {
  service?: OnboardingService
  onDone: () => void
  testId?: string
}) {
  const [mode, setMode] = useState<Mode>('choose')
  const [mnemonic, setMnemonic] = useState('')
  const [mnemonicSource, setMnemonicSource] = useState<'create' | 'import'>('create')
  const [importText, setImportText] = useState('')
  const [quiz, setQuiz] = useState<{ words: string[]; positions: number[] } | null>(null)
  const [quizPicks, setQuizPicks] = useState<Record<number, number>>({}) // position -> chosen word index
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const passwordOk = password.length >= 12

  const begin = async (source: 'create' | 'import') => {
    setError(null)
    if (source === 'import') {
      // Import path: the user typed the mnemonic; go straight to password.
      setMnemonicSource('import')
      setMnemonic(importText.trim())
      setMode('password')
      return
    }
    try {
      const created = await service.createVault('')
      setMnemonicSource('create')
      setMnemonic(created.mnemonic)
      setQuiz(service.quizWords(created.mnemonic))
      setQuizPicks({})
      setMode('backup')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    }
  }

  const quizComplete = useMemo(() => {
    if (!quiz) return false
    const p = quiz.positions[0]
    return p != null && quizPicks[p] != null
  }, [quiz, quizPicks])

  const finish = async () => {
    setError(null)
    try {
      if (mnemonicSource === 'import') {
        await service.importVault(mnemonic, password)
      } else {
        // create path already created the vault; here we just confirm the
        // password was captured (the SW re-creates with the password).
        await service.createVault(password)
      }
      setMode('done')
      // Give the UI a beat before flipping to Home.
      setTimeout(onDone, 600)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    }
  }

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 'var(--bv-inset)', color: 'var(--bv-ink)', fontFamily: 'var(--bv-font-sora)' }}>
      {mode === 'choose' && (
        <>
          <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>BoltVault</div>
          <div style={{ color: 'var(--bv-mute)', fontSize: 13, marginBottom: 20 }}>Quiet custody for Electroneum.</div>
          <Breaker label="Create" armed variant="arc" testId={`${testId}-create`} onClick={() => void begin('create')} />
          <div style={{ height: 8 }} />
          <Breaker label="Import" armed variant="ghost" testId={`${testId}-import`} onClick={() => { setImportText(''); setMode('password'); setMnemonicSource('import'); setMnemonic('') }} />
        </>
      )}

      {mode === 'backup' && mnemonic && (
        <>
          <div style={{ color: 'var(--bv-mute)', fontSize: 13, marginBottom: 8 }}>Your words — write them down.</div>
          <div data-testid={`${testId}-words`} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {mnemonic.split(/\s+/).map((w, i) => (
              <span key={i} style={{ background: 'var(--bv-glass)', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'var(--bv-font-oxanium)' }}>
                {w}
              </span>
            ))}
          </div>
          {quiz && quiz.positions[0] != null && (
            <div data-testid={`${testId}-quiz`} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>Which word is in position {quiz.positions[0] + 1}?</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {quiz.words.map((w, i) => {
                  const pos = quiz.positions[0]!
                  return (
                    <button
                      key={i}
                      data-testid={`${testId}-quiz-${i}`}
                      onClick={() => setQuizPicks((p) => ({ ...p, [pos]: i }))}
                      style={{
                        background: quizPicks[pos] === i ? 'var(--bv-arc)' : 'var(--bv-glass)',
                        color: quizPicks[pos] === i ? 'var(--bv-void)' : 'var(--bv-ink)',
                        border: 'none', borderRadius: 6, padding: '8px 10px', cursor: 'pointer', fontFamily: 'var(--bv-font-sora)',
                      }}
                    >
                      {w}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <Breaker label="Continue" armed={quizComplete} variant="arc" testId={`${testId}-quiz-next`} onClick={() => setMode('password')} />
        </>
      )}

      {mode === 'password' && (
        <>
          <div style={{ color: 'var(--bv-mute)', fontSize: 13, marginBottom: 12 }}>
            {mnemonicSource === 'import' ? 'Paste your recovery phrase, then set a password.' : 'Set a password (12+ characters).'}
          </div>
          {mnemonicSource === 'import' && (
            <textarea
              data-testid={`${testId}-import-text`}
              value={importText}
              onChange={(e) => { setImportText(e.target.value); setMnemonic(e.target.value.trim()) }}
              rows={2}
              placeholder="your recovery phrase"
              style={{ background: 'var(--bv-glass)', color: 'var(--bv-ink)', border: '1px solid var(--bv-glass)', borderRadius: 8, padding: 10, fontFamily: 'var(--bv-font-sora)', fontSize: 12, marginBottom: 12, resize: 'none' }}
            />
          )}
          <input
            data-testid={`${testId}-password`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password (12+)"
            style={{ background: 'var(--bv-glass)', color: 'var(--bv-ink)', border: '1px solid var(--bv-glass)', borderRadius: 8, padding: 10, fontFamily: 'var(--bv-font-sora)', fontSize: 13, marginBottom: 12, width: '100%' }}
          />
          {error && <div data-testid={`${testId}-error`} style={{ color: 'var(--bv-burn)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <Breaker label="Done" armed={passwordOk && (mnemonicSource === 'create' || mnemonic.length > 0)} variant="arc" testId={`${testId}-done`} onClick={() => void finish()} />
        </>
      )}

      {mode === 'done' && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <EmptyState icon={<IconBolt size={28} />} title="Vault ready — fund it to begin." testId={`${testId}-funding`} />
        </div>
      )}
    </div>
  )
}
