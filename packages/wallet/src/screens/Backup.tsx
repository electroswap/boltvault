/** Backup quiz for a seed that was created but not confirmed (the gate, §8.1). */
import { Backdrop, Body, Column, EsWordmark, Icon, Input, Key, Plate, Row, ScrollView, WordGrid, metrics, paint, useWindowDimensions } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useSecretGuard } from './onboarding/useSecretGuard'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'
import { useScene } from '../state/useScene'

export function Backup({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { vault, refresh } = useWalletState()
  const { width, height } = useWindowDimensions()
  const scene = useScene()
  const pending = (vault?.seeds ?? []).filter((s) => !s.backedUp)
  const [seedId, setSeedId] = useState<string | null>(pending[0]?.id ?? null)
  const [password, setPassword] = useState('')
  const [words, setWords] = useState<string[] | null>(null)
  // On from the moment a phrase is revealed until this screen goes away.
  const { masked } = useSecretGuard(words !== null)
  const [quiz, setQuiz] = useState<{ positions: number[]; answers: Record<number, string> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // Secrets never render in the popup (§3.2): hand off to tab.html once mounted.
  useEffect(() => {
    if (!host.secretsAllowed) host.openSecretScreen?.('backup')
  }, [host])
  if (!host.secretsAllowed) return null

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const id = seedId ?? pending[0]?.id ?? null
  return (
    <Column flex={1} backgroundColor="$void" testID="backup">
      <Backdrop scene={scene} width={width} height={height} reducedMotion={reducedMotion} />
      <ScrollView style={{ zIndex: 1 }} contentContainerStyle={{ padding: metrics.insetWide, gap: 16 }}>
        <Row gap="$2">
          <Icon name="lock" size={18} color={paint.mute} />
          <Body size="title">{t({ id: 'backup.title', message: 'Back up your recovery phrase' })}</Body>
        </Row>
        {done ? (
          <Column gap="$3">
            <Body>{t({ id: 'backup.done', message: 'Backed up. Swapping and signing are unlocked.' })}</Body>
            <Key label={t({ id: 'backup.home', message: 'Back to Home' })} onPress={() => router.reset()} testID="backup-home" />
          </Column>
        ) : !id ? (
          <Body tone="mute">{t({ id: 'backup.none', message: 'Every seed in this vault is backed up.' })}</Body>
        ) : !words ? (
          <Column gap="$3">
            {pending.length > 1 ? (
              <Row gap="$2">
                {pending.map((s) => (
                  <Key key={s.id} label={s.label} kind={s.id === id ? 'primary' : 'secondary'} onPress={() => setSeedId(s.id)} />
                ))}
              </Row>
            ) : null}
            <Body tone="mute">{t({ id: 'backup.body', message: 'Enter your password to show the words, write them down, then confirm three of them.' })}</Body>
            <Input value={password} onChange={setPassword} secure autoFocus error={error} testID="backup-password" />
            <Key label={t({ id: 'backup.show', message: 'Show words' })} disabled={busy || !password} onPress={() => run(async () => { const r = await engine.vault.reveal({ seedId: id, password }); setWords(r.mnemonic.split(' ')); setPassword('') })} testID="backup-show" />
          </Column>
        ) : !quiz ? (
          <Column gap="$3">
            <Plate role="raised">
              {/* Screenshot-blocked while shown, masked the moment this stops being the active surface. */}
              {masked ? (
                <Column minHeight={168} alignItems="center" justifyContent="center" gap="$2" testID="backup-masked">
                  <Icon name="eyeOff" size={20} color={paint.mute} />
                  <Body tone="mute" size="caption">
                    {t({ id: 'secret.masked', message: 'Hidden while this window is not in front' })}
                  </Body>
                </Column>
              ) : (
                <WordGrid words={words} />
              )}
            </Plate>
            {/*
              The phrase stays in state until the check passes. It used to be
              dropped here, which made "show the words again" impossible
              without re-entering the password and revealing the seed a second
              time — a worse trade than holding it for the length of a quiz it
              is already being compared against.
            */}
            <Key label={t({ id: 'ob.words.done', message: 'I wrote them down' })} onPress={() => run(async () => { const q = await engine.vault.backupQuiz({ seedId: id }); setQuiz({ positions: q.positions, answers: {} }) })} testID="backup-written" />
          </Column>
        ) : (
          <Column gap="$3">
            {quiz.positions.map((p) => (
              <Input key={p} label={t({ id: 'ob.quiz.word', message: 'Word {n}', values: { n: p } })} value={quiz.answers[p] ?? ''} onChange={(v) => setQuiz({ ...quiz, answers: { ...quiz.answers, [p]: v } })} testID={`quiz-${p}`} />
            ))}
            {error ? <Body tone="burn">{error}</Body> : null}
            <Key
              label={t({ id: 'ob.quiz.confirm', message: 'Confirm backup' })}
              disabled={busy || quiz.positions.some((p) => !(quiz.answers[p] ?? '').trim())}
              onPress={() =>
                run(async () => {
                  const r = await engine.vault.confirmBackup({ seedId: id, answers: quiz.positions.map((p) => ({ position: p, word: quiz.answers[p] ?? '' })) })
                  if (!r.ok) {
                    setError(t({ id: 'quiz.wrong', message: 'Those words do not match your phrase. Check the numbers and try again.' }))
                    return
                  }
                  refresh()
                  setWords(null)
                  setDone(true)
                })
              }
              testID="backup-confirm"
            />
            <Key label={t({ id: 'ob.quiz.back', message: 'Show the words again' })} kind="secondary" disabled={busy} onPress={() => setQuiz(null)} testID="backup-quiz-back" />
          </Column>
        )}
      </ScrollView>
      <Column alignItems="center" paddingBottom="$6" zIndex={1} testID="backup-brand">
        <EsWordmark />
      </Column>
    </Column>
  )
}
