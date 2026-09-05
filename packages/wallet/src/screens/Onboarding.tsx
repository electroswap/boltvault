/**
 * Onboarding (master plan §8.1): Create → password → words (quiet) → quiz →
 * passkey offer → funding plate. Import and Watch are secondary paths. The
 * backup gate is a state on the vault (backupComplete), not a banner.
 *
 * Quiet custody mode throughout: the Field dims, nothing pulses.
 */
import { Body, Column, Field, Icon, Input, Key, Plate, Row, ScrollView, WordGrid, metrics, paint, useWindowDimensions } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

type Step = 'welcome' | 'password' | 'words' | 'quiz' | 'import' | 'preview' | 'watch' | 'passkey' | 'done'
type Path = 'create' | 'import' | 'watch'

const MIN_PASSWORD = 12
/** One vault per install, so one WebAuthn user handle; re-enrolling replaces the credential. */
export const PASSKEY_USER_ID = '626f6c747661756c742d7661756c74'

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < MIN_PASSWORD) return { score: 0, label: t({ id: 'pw.short', message: 'At least {n} characters', values: { n: MIN_PASSWORD } }) }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(pw)).length
  const words = pw.trim().split(/\s+/).length
  if (pw.length >= 20 || words >= 4) return { score: 3, label: t({ id: 'pw.strong', message: 'Strong' }) }
  if (classes >= 3 && pw.length >= 14) return { score: 2, label: t({ id: 'pw.good', message: 'Good' }) }
  return { score: 1, label: t({ id: 'pw.ok', message: 'Usable — a longer phrase is stronger' }) }
}

export function Onboarding({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const [path, setPath] = useState<Path>('create')
  const [step, setStep] = useState<Step>('welcome')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mnemonic, setMnemonic] = useState<string[]>([])
  const [seedId, setSeedId] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<{ positions: number[]; answers: Record<number, string> } | null>(null)
  const [phrase, setPhrase] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [preview, setPreview] = useState<{ bip44: string[]; ledgerLive: string[] } | null>(null)
  const [watchAddress, setWatchAddress] = useState('')
  const [passkeysSupported, setPasskeysSupported] = useState(false)

  useEffect(() => {
    let alive = true
    host.passkeys?.supported().then((ok) => alive && setPasskeysSupported(ok), () => undefined)
    return () => {
      alive = false
    }
  }, [host.passkeys])

  // The popup never renders secrets (§3.2): its welcome keys hand the flow to tab.html.
  const begin = (next: Path): void => {
    if (!host.secretsAllowed) {
      host.openSecretScreen?.('onboarding')
      return
    }
    setPath(next)
    setStep('password')
  }

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

  const strength = passwordStrength(password)
  const passwordOk = strength.score > 0 && password === confirm

  const startCreate = (): Promise<void> =>
    run(async () => {
      const r = await engine.vault.create({ password })
      setMnemonic(r.mnemonic.split(' '))
      setSeedId(r.seedId)
      setStep('words')
    })

  const startQuiz = (): Promise<void> =>
    run(async () => {
      if (!seedId) return
      const q = await engine.vault.backupQuiz({ seedId })
      setQuiz({ positions: q.positions, answers: {} })
      setStep('quiz')
    })

  const submitQuiz = (): Promise<void> =>
    run(async () => {
      if (!seedId || !quiz) return
      const r = await engine.vault.confirmBackup({ seedId, answers: quiz.positions.map((p) => ({ position: p, word: quiz.answers[p] ?? '' })) })
      if (!r.ok) {
        setError(t({ id: 'quiz.wrong', message: 'Those words do not match your phrase. Check the numbers and try again.' }))
        return
      }
      setMnemonic([])
      setStep(passkeysSupported ? 'passkey' : 'done')
    })

  const doImport = (): Promise<void> =>
    run(async () => {
      const r = await engine.vault.import({ mnemonic: phrase, password, ...(passphrase ? { passphrase } : {}) })
      setSeedId(r.seedId)
      setStep(passkeysSupported ? 'passkey' : 'done')
    })

  const doWatch = (): Promise<void> =>
    run(async () => {
      await engine.vault.createEmpty({ password })
      await engine.accounts.addWatch({ address: watchAddress.trim(), label: t({ id: 'watch.label', message: 'Watch address' }) })
      setStep(passkeysSupported ? 'passkey' : 'done')
    })

  const enrolPasskey = (): Promise<void> =>
    run(async () => {
      if (!host.passkeys) return
      const res = await host.passkeys.create({ userName: 'BoltVault', userIdHex: PASSKEY_USER_ID, rpName: 'BoltVault' })
      await engine.vault.enrolPasskey({ credentialId: res.credentialId, prfSecretHex: res.prfSecretHex })
      setStep('done')
    })

  const inset = metrics.insetWide
  const wordsOk = phrase.trim().split(/\s+/).length >= 12

  return (
    <Column flex={1} backgroundColor="$void" testID="onboarding">
      <Field address="0x0000000000000000000000000000000000000e7n" quiet width={width} height={height} reducedMotion={reducedMotion} />
      <ScrollView style={{ zIndex: 1 }} contentContainerStyle={{ padding: inset, gap: 20, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1, justifyContent: 'center' }}>
        {step === 'welcome' ? (
          <Column gap="$4">
            <Body size="title">{t({ id: 'ob.welcome.title', message: 'Your keys, your Electroneum' })}</Body>
            <Body tone="mute">{t({ id: 'ob.welcome.body', message: 'BoltVault keeps your recovery phrase on this device, sealed with your password. Nothing leaves it unless you export it.' })}</Body>
            <Key label={t({ id: 'ob.create', message: 'Create a new vault' })} onPress={() => begin('create')} testID="ob-create" />
            <Key label={t({ id: 'ob.import', message: 'Import a recovery phrase' })} kind="secondary" onPress={() => begin('import')} testID="ob-import" />
            <Key label={t({ id: 'ob.watch', message: 'Watch an address' })} kind="secondary" onPress={() => begin('watch')} testID="ob-watch" />
            <Body tone="mute" size="caption">
              {t({ id: 'ob.hardware.note', message: 'Ledger, Trezor and Keystone accounts are added from the Accounts sheet after your vault exists.' })}
            </Body>
          </Column>
        ) : null}

        {step === 'password' ? (
          <Column gap="$4">
            <Body size="title">{t({ id: 'ob.password.title', message: 'Choose a password' })}</Body>
            <Body tone="mute">{t({ id: 'ob.password.body', message: 'It seals your vault on this device. A few unrelated words beat a short string of symbols. We cannot reset it.' })}</Body>
            <Input label={t({ id: 'ob.password', message: 'Password' })} value={password} onChange={setPassword} secure autoFocus hint={password ? strength.label : null} testID="ob-password" />
            <Input label={t({ id: 'ob.confirm', message: 'Confirm password' })} value={confirm} onChange={setConfirm} secure error={confirm && confirm !== password ? t({ id: 'ob.mismatch', message: 'The passwords differ.' }) : null} testID="ob-confirm" />
            <Row gap="$2">
              {[0, 1, 2].map((i) => (
                <Row key={i} flex={1} height={4} borderRadius={2} backgroundColor={strength.score > i ? (strength.score === 3 ? paint.arc : paint.ember) : paint.glassRaisedSolid} />
              ))}
            </Row>
            {error ? <Body tone="burn">{error}</Body> : null}
            <Key
              label={path === 'create' ? t({ id: 'ob.create.key', message: 'Create vault' }) : t({ id: 'continue', message: 'Continue' })}
              disabled={!passwordOk || busy}
              onPress={() => (path === 'create' ? startCreate() : setStep(path === 'import' ? 'import' : 'watch'))}
              testID="ob-password-continue"
            />
            <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => setStep('welcome')} />
          </Column>
        ) : null}

        {step === 'words' ? (
          <Column gap="$4" testID="ob-words">
            <Row gap="$2">
              <Icon name="lock" size={18} color={paint.mute} />
              <Body size="title">{t({ id: 'ob.words.title', message: 'Write these 12 words down, in order' })}</Body>
            </Row>
            <Body tone="mute">{t({ id: 'ob.words.body', message: 'This is the only copy. Anyone with these words controls your funds; BoltVault will never ask for them except on this screen and the quiz.' })}</Body>
            <Plate role="raised">
              <WordGrid words={mnemonic} testID="word-grid" />
            </Plate>
            <Key label={t({ id: 'ob.words.done', message: 'I wrote them down' })} onPress={startQuiz} disabled={busy} testID="ob-words-done" />
          </Column>
        ) : null}

        {step === 'quiz' && quiz ? (
          <Column gap="$4" testID="ob-quiz">
            <Body size="title">{t({ id: 'ob.quiz.title', message: 'Confirm three words' })}</Body>
            <Body tone="mute">{t({ id: 'ob.quiz.body', message: 'Type the words at these positions. This is the backup check that unlocks swapping and signing.' })}</Body>
            {quiz.positions.map((p) => (
              <Input
                key={p}
                label={t({ id: 'ob.quiz.word', message: 'Word {n}', values: { n: p } })}
                value={quiz.answers[p] ?? ''}
                onChange={(v) => setQuiz({ ...quiz, answers: { ...quiz.answers, [p]: v } })}
                mono
                testID={`quiz-${p}`}
              />
            ))}
            {error ? <Body tone="burn">{error}</Body> : null}
            <Key label={t({ id: 'ob.quiz.confirm', message: 'Confirm backup' })} onPress={submitQuiz} disabled={busy || quiz.positions.some((p) => !(quiz.answers[p] ?? '').trim())} testID="ob-quiz-confirm" />
          </Column>
        ) : null}

        {step === 'import' ? (
          <Column gap="$4" testID="ob-import-words">
            <Body size="title">{t({ id: 'ob.import.title', message: 'Enter your recovery phrase' })}</Body>
            <Input value={phrase} onChange={setPhrase} multiline mono placeholder={t({ id: 'ob.import.ph', message: '12 or 24 words, separated by spaces' })} autoFocus testID="ob-phrase" />
            <Input label={t({ id: 'ob.passphrase', message: 'BIP-39 passphrase (optional, advanced)' })} value={passphrase} onChange={setPassphrase} secure testID="ob-passphrase" />
            {error ? <Body tone="burn">{error}</Body> : null}
            <Key
              label={t({ id: 'ob.import.preview', message: 'Preview addresses' })}
              disabled={!wordsOk || busy}
              onPress={() =>
                run(async () => {
                  setPreview(await engine.accounts.previewDerivations({ mnemonic: phrase, ...(passphrase ? { passphrase } : {}), count: 3 }))
                  setStep('preview')
                })
              }
              testID="ob-import-preview"
            />
          </Column>
        ) : null}

        {step === 'preview' && preview ? (
          <Column gap="$4" testID="ob-preview">
            <Body size="title">{t({ id: 'ob.preview.title', message: 'Which addresses do you recognise?' })}</Body>
            <Body tone="mute">{t({ id: 'ob.preview.body', message: 'Wallets derive accounts along two common trees. BoltVault uses the standard (BIP-44) tree; Ledger Live uses another. Both agree on the first address.' })}</Body>
            <Plate gap="$2">
              <Body size="title">BIP-44</Body>
              {preview.bip44.map((a) => (
                <Body key={a} tone="mute" size="caption">
                  {a}
                </Body>
              ))}
            </Plate>
            <Plate gap="$2">
              <Body size="title">Ledger Live</Body>
              {preview.ledgerLive.map((a) => (
                <Body key={a} tone="mute" size="caption">
                  {a}
                </Body>
              ))}
            </Plate>
            {error ? <Body tone="burn">{error}</Body> : null}
            <Key label={t({ id: 'ob.import.key', message: 'Import' })} onPress={doImport} disabled={busy} testID="ob-import-confirm" />
            <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => setStep('import')} />
          </Column>
        ) : null}

        {step === 'watch' ? (
          <Column gap="$4" testID="ob-watch-form">
            <Body size="title">{t({ id: 'ob.watch.title', message: 'Watch an address' })}</Body>
            <Body tone="mute">{t({ id: 'ob.watch.body', message: 'You will see balances and activity but cannot send or sign. Add a key or pair a device later.' })}</Body>
            <Input value={watchAddress} onChange={setWatchAddress} mono placeholder="0x… or name.etn" autoFocus testID="ob-watch-address" />
            {error ? <Body tone="burn">{error}</Body> : null}
            <Key label={t({ id: 'ob.watch.key', message: 'Watch' })} onPress={doWatch} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(watchAddress.trim())} testID="ob-watch-confirm" />
          </Column>
        ) : null}

        {step === 'passkey' ? (
          <Column gap="$4" testID="ob-passkey">
            <Body size="title">{t({ id: 'ob.passkey.title', message: 'Unlock with a passkey?' })}</Body>
            <Body tone="mute">{t({ id: 'ob.passkey.body', message: 'Your face or fingerprint unlocks the vault on this device. Your password still works, and it is still needed to reveal or export the phrase.' })}</Body>
            {error ? <Body tone="burn">{error === 'prf-unsupported' ? t({ id: 'ob.passkey.noprf', message: 'This browser created a passkey without the PRF feature, so it cannot unlock the vault on its own. Use your password.' }) : error}</Body> : null}
            <Key label={t({ id: 'ob.passkey.yes', message: 'Add passkey' })} onPress={enrolPasskey} disabled={busy} testID="ob-passkey-add" />
            <Key label={t({ id: 'ob.passkey.skip', message: 'Not now' })} kind="secondary" onPress={() => setStep('done')} testID="ob-passkey-skip" />
          </Column>
        ) : null}

        {step === 'done' ? (
          <Column gap="$4" testID="ob-done">
            <Body size="title">{t({ id: 'ob.done.title', message: 'This is Electroneum Smart Chain (52014)' })}</Body>
            <Body tone="mute">{t({ id: 'ob.done.body', message: 'Send ETN here from an exchange that supports the smart chain, or bridge USDC from Ethereum — you will need a little ETN for fees. Do not send from the old Electroneum app.' })}</Body>
            <Key label={t({ id: 'ob.done.key', message: 'Open my wallet' })} onPress={() => router.reset()} testID="ob-open" />
          </Column>
        ) : null}
      </ScrollView>
    </Column>
  )
}
