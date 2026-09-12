/** Backup quiz for a seed that was created but not confirmed (the gate, §8.1). */
import {
  Body,
  Column,
  EsWordmark,
  Icon,
  IconButton,
  Input,
  Key,
  Plate,
  Row,
  ScrollView,
  WordGrid,
  metrics,
  paint,
} from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useSecretGuard } from './onboarding/useSecretGuard'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

export function Backup({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { vault, refresh } = useWalletState()
  const pending = (vault?.seeds ?? []).filter((s) => !s.backedUp)
  const [seedId, setSeedId] = useState<string | null>(pending[0]?.id ?? null)
  const [password, setPassword] = useState('')
  const [words, setWords] = useState<string[] | null>(null)
  // On from the moment a phrase is revealed until this screen goes away.
  const { masked } = useSecretGuard(words !== null)
  const [quiz, setQuiz] = useState<{ positions: number[]; answers: Record<number, string> } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  /*
    The gate takes any factor this vault is wrapped under, not only the
    password (§3.2). `wraps` is on the vault status and readable while locked,
    so "is a passkey enrolled" is answered without asking the engine to open
    anything; a factor that is not in `wraps` is never offered, and the
    password path is untouched either way. Same shape as Unlock.
  */
  const passkeyIds = (vault?.wraps ?? []).filter((w) => w.by === 'prf').map((w) => w.id)
  const [passkeyOk, setPasskeyOk] = useState(false)
  const deviceWrapped = (vault?.wraps ?? []).some((w) => w.by === 'device')
  const [biometricOk, setBiometricOk] = useState(false)

  // Secrets never render in the popup (§3.2): hand off to tab.html once mounted.
  useEffect(() => {
    if (!host.secretsAllowed) host.openSecretScreen?.('backup')
  }, [host])

  useEffect(() => {
    let alive = true
    if (passkeyIds.length && host.passkeys)
      host.passkeys.supported().then(
        (ok) => alive && setPasskeyOk(ok),
        () => undefined,
      )
    return () => {
      alive = false
    }
  }, [host.passkeys, passkeyIds.length])

  // A device wrap can outlive its key: changing the enrolled biometric set
  // invalidates the keystore entry, so ask the keystore, not just the vault.
  useEffect(() => {
    let alive = true
    if (deviceWrapped && host.deviceKey)
      host.deviceKey.available().then(
        (ok) => alive && setBiometricOk(ok),
        () => undefined,
      )
    return () => {
      alive = false
    }
  }, [host.deviceKey, deviceWrapped])

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

  /*
    Deliberately no auto-prompt, unlike Unlock. There the biometric prompt is
    the whole screen's purpose; here the user came to a page that is safe to
    look at and the words must not appear until they ask for them — a phrase
    that shows itself the moment the screen mounts is a phrase shown to
    whoever is standing behind you.
  */
  const revealWithPasskey = async (): Promise<void> => {
    if (!host.passkeys || !id) return
    setBusy(true)
    setError(null)
    try {
      const k = await host.passkeys.get(passkeyIds)
      const r = await engine.vault.reveal({
        seedId: id,
        credentialId: k.credentialId,
        prfSecretHex: k.prfSecretHex,
      })
      setWords(r.mnemonic.split(' '))
      setPassword('')
    } catch {
      setError(
        t({
          id: 'reveal.passkey.fail',
          message: 'The passkey did not open the vault. Use your password.',
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const revealWithBiometric = async (): Promise<void> => {
    const deviceKey = host.deviceKey
    if (!deviceKey || !id) return
    setBusy(true)
    setError(null)
    try {
      const keyHex = await deviceKey.read(
        t({ id: 'reveal.biometric.reason', message: 'Show your recovery phrase' }),
      )
      // A cancelled prompt is a choice, not a failure; the password field is right there.
      if (keyHex === null) return
      const r = await engine.vault.reveal({ seedId: id, keyId: deviceKey.id, keyHex })
      setWords(r.mnemonic.split(' '))
      setPassword('')
    } catch {
      setError(
        t({
          id: 'reveal.biometric.fail',
          message: 'That did not open the vault. Use your password.',
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Column flex={1} testID="backup">
      <ScrollView
        style={{ zIndex: 1 }}
        contentContainerStyle={{ padding: metrics.insetWide, gap: 16 }}
      >
        {/*
          A way out. With no dock (see TabShell) a screen without Back is a room
          without a door, and this one is reached from the Accounts sheet by
          anyone who wanted to look — not only by the gate. It is deliberately
          NOT shown once the words are on screen: leaving mid-reveal with the
          phrase still in state is the one exit worth making people think about,
          and `useSecretGuard` clears it on unmount either way.
        */}
        <Row gap="$2" alignItems="center">
          {words ? null : (
            <IconButton
              icon="back"
              label={t({ id: 'back', message: 'Back' })}
              onPress={() => router.back()}
              testID="backup-back"
            />
          )}
          <Icon name="lock" size={18} color={paint.mute} />
          <Body size="title" flexShrink={1}>
            {t({ id: 'backup.title', message: 'Back up your recovery phrase' })}
          </Body>
        </Row>
        {done ? (
          <Column gap="$3">
            <Body>
              {t({ id: 'backup.done', message: 'Backed up. Swapping and signing are unlocked.' })}
            </Body>
            <Key
              label={t({ id: 'backup.home', message: 'Back to Home' })}
              onPress={() => router.reset()}
              testID="backup-home"
            />
          </Column>
        ) : !id ? (
          <Body tone="mute">
            {t({ id: 'backup.none', message: 'Every seed in this vault is backed up.' })}
          </Body>
        ) : !words ? (
          <Column gap="$3">
            {pending.length > 1 ? (
              <Row gap="$2">
                {pending.map((s) => (
                  <Key
                    key={s.id}
                    label={s.label}
                    kind={s.id === id ? 'primary' : 'secondary'}
                    onPress={() => setSeedId(s.id)}
                  />
                ))}
              </Row>
            ) : null}
            <Body tone="mute">
              {t({
                id: 'backup.body',
                message:
                  'Enter your password to show the words, write them down, then confirm three of them.',
              })}
            </Body>
            <Input
              value={password}
              onChange={setPassword}
              secure
              autoFocus
              error={error}
              sensitive
              testID="backup-password"
            />
            <Key
              label={t({ id: 'backup.show', message: 'Show words' })}
              disabled={busy || !password}
              onPress={() =>
                run(async () => {
                  const r = await engine.vault.reveal({ seedId: id, password })
                  setWords(r.mnemonic.split(' '))
                  setPassword('')
                })
              }
              testID="backup-show"
            />
            {passkeyOk ? (
              <Key
                label={t({ id: 'backup.show.passkey', message: 'Show with passkey' })}
                kind="secondary"
                disabled={busy}
                onPress={() => void revealWithPasskey()}
                testID="backup-show-passkey"
              />
            ) : null}
            {biometricOk ? (
              <Key
                label={t({ id: 'backup.show.biometric', message: 'Show with biometrics' })}
                kind="secondary"
                disabled={busy}
                onPress={() => void revealWithBiometric()}
                testID="backup-show-biometric"
              />
            ) : null}
          </Column>
        ) : !quiz ? (
          <Column gap="$3">
            <Plate role="raised">
              {/* Screenshot-blocked while shown, masked the moment this stops being the active surface. */}
              {masked ? (
                <Column
                  minHeight={168}
                  alignItems="center"
                  justifyContent="center"
                  gap="$2"
                  testID="backup-masked"
                >
                  <Icon name="eyeOff" size={20} color={paint.mute} />
                  <Body tone="mute" size="caption">
                    {t({
                      id: 'secret.masked',
                      message: 'Hidden while this window is not in front',
                    })}
                  </Body>
                </Column>
              ) : (
                <WordGrid words={words} />
              )}
              {/*
                A seed with a BIP-39 passphrase cannot be restored from these
                words alone. The engine has always known — `hasPassphrase` is
                on the seed view — and no screen read it, so someone who
                imported with a passphrase could pass the quiz, be told "backed
                up", and hold twelve words that recover an empty wallet.
              */}
              {vault?.seeds.find((x) => x.id === id)?.hasPassphrase ? (
                <Body tone="ember" size="caption" testID="backup-passphrase-warning">
                  {t({
                    id: 'backup.passphrase',
                    message:
                      'This recovery phrase has a BIP-39 passphrase. These words alone will not restore it — write the passphrase down too, and keep it somewhere separate.',
                  })}
                </Body>
              ) : null}
            </Plate>
            {/*
              The phrase stays in state until the check passes. It used to be
              dropped here, which made "show the words again" impossible
              without re-entering the password and revealing the seed a second
              time — a worse trade than holding it for the length of a quiz it
              is already being compared against.
            */}
            <Key
              label={t({ id: 'ob.words.done', message: 'I wrote them down' })}
              onPress={() =>
                run(async () => {
                  const q = await engine.vault.backupQuiz({ seedId: id })
                  setQuiz({ positions: q.positions, answers: {} })
                })
              }
              testID="backup-written"
            />
          </Column>
        ) : (
          <Column gap="$3">
            {quiz.positions.map((p) => (
              <Input
                key={p}
                label={t({ id: 'ob.quiz.word', message: 'Word {n}', values: { n: p } })}
                value={quiz.answers[p] ?? ''}
                onChange={(v) => setQuiz({ ...quiz, answers: { ...quiz.answers, [p]: v } })}
                sensitive="code"
                testID={`quiz-${p}`}
              />
            ))}
            {error ? <Body tone="burn">{error}</Body> : null}
            <Key
              label={t({ id: 'ob.quiz.confirm', message: 'Confirm backup' })}
              disabled={busy || quiz.positions.some((p) => !(quiz.answers[p] ?? '').trim())}
              onPress={() =>
                run(async () => {
                  const r = await engine.vault.confirmBackup({
                    seedId: id,
                    answers: quiz.positions.map((p) => ({
                      position: p,
                      word: quiz.answers[p] ?? '',
                    })),
                  })
                  if (!r.ok) {
                    setError(
                      t({
                        id: 'quiz.wrong',
                        message:
                          'Those words do not match your phrase. Check the numbers and try again.',
                      }),
                    )
                    return
                  }
                  refresh()
                  setWords(null)
                  setDone(true)
                })
              }
              testID="backup-confirm"
            />
            <Key
              label={t({ id: 'ob.quiz.back', message: 'Show the words again' })}
              kind="secondary"
              disabled={busy}
              onPress={() => setQuiz(null)}
              testID="backup-quiz-back"
            />
          </Column>
        )}
      </ScrollView>
      <Column alignItems="center" paddingBottom="$6" zIndex={1} testID="backup-brand">
        <EsWordmark />
      </Column>
    </Column>
  )
}
