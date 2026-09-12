/**
 * Onboarding (master plan §8.1): intro → the fork → the path → done.
 *
 * **The words come before the password**, as §8.1 always specified and the
 * implementation never did. `vault.create` could not do it — it is the call
 * that mints the phrase and it needs the password in the same breath, because
 * the password is the KDF input that seals the file. `vault.propose` splits
 * minting from sealing, so the phrase can be shown and checked first and
 * `vault.import` turns it into a vault once a password exists.
 *
 * That ordering is not only spec compliance. Under the old one, `create`
 * succeeded at the password step and the words came after — so abandoning the
 * flow there left an unlocked vault with no backup behind it, recoverable only
 * through Home's backup gate. Now nothing reaches disk until the last step, and
 * walking away leaves nothing at all.
 *
 * Quiet custody mode throughout: the Field dims, nothing pulses. The words and
 * the quiz are screenshot-blocked and masked when the surface is not in front
 * (`useSecretGuard`), which is the promise `packages/platform` had been making
 * on the product's behalf without anything implementing it.
 */
import {
  Backdrop,
  Body,
  Column,
  EsWordmark,
  Icon,
  Input,
  Key,
  Plate,
  Row,
  ScrollView,
  WordGrid,
  metrics,
  paint,
  useWindowDimensions,
} from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { usePrefs } from '../hooks/usePrefs'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useScene } from '../state/useScene'
import { useWalletState } from '../state/useWalletState'
import { IntroCarousel } from './onboarding/IntroCarousel'
import {
  clampEntryStep,
  engineErrorCopy,
  mnemonicHint,
  mnemonicLengthOk,
  mnemonicWords,
  passwordStrength,
  progressFor,
  type OnboardingPath as Path,
  type Step,
} from './onboarding/rules'
import { useSecretGuard } from './onboarding/useSecretGuard'

/** One vault per install, so one WebAuthn user handle; re-enrolling replaces the credential. */
export const PASSKEY_USER_ID = '626f6c747661756c742d7661756c74'

export { passwordStrength }

/**
 * Kept for the tests that pin the shape of a quiz; the positions a user is
 * asked about now come from the engine, which is the only thing that will
 * accept an answer to them (ES-BV-004).
 */
export function quizPositions(count: number, random: () => number): number[] {
  const out = new Set<number>()
  while (out.size < 3) out.add(Math.floor(random() * count) + 1)
  return [...out].sort((a, b) => a - b)
}

export function Onboarding({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const scene = useScene()
  const { vault } = useWalletState()
  const { prefs, loaded: prefsLoaded, set: setPrefs } = usePrefs()

  const [path, setPath] = useState<Path>('create')
  const [step, setStep] = useState<Step>('intro')
  const [resolvedStart, setResolvedStart] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mnemonic, setMnemonic] = useState<string[]>([])
  const [positions, setPositions] = useState<number[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [phrase, setPhrase] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [preview, setPreview] = useState<{ bip44: string[]; ledgerLive: string[] } | null>(null)
  const [watchAddress, setWatchAddress] = useState('')
  const [watchResolved, setWatchResolved] = useState<string | null>(null)
  const [passkeysSupported, setPasskeysSupported] = useState(false)
  const [biometricsSupported, setBiometricsSupported] = useState(false)

  // Screenshot-blocked and masked-when-hidden wherever a phrase is on the glass.
  const { masked } = useSecretGuard(step === 'words' || step === 'quiz')

  useEffect(() => {
    let alive = true
    host.passkeys?.supported().then(
      (ok) => alive && setPasskeysSupported(ok),
      () => undefined,
    )
    host.deviceKey?.available().then(
      (ok) => alive && setBiometricsSupported(ok),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [host.passkeys, host.deviceKey])

  /*
    Where to start.

    Optimistically `intro`, corrected once the prefs document lands — guessing
    is right almost always (onboarding is only reached with no vault, where the
    flag is false), and the alternative is a loader over the first frame. The
    popup hands the tab an explicit step, so the tab never guesses at all.
  */
  useEffect(() => {
    if (resolvedStart || !prefsLoaded || vault === null) return
    setResolvedStart(true)
    if (vault.exists) {
      setStep('blocked')
      return
    }
    const params =
      router.current.screen === 'onboarding'
        ? (router.current.params as { path?: Path; step?: string } | undefined)
        : undefined
    const asked = clampEntryStep(params?.step)
    if (asked) {
      if (params?.path) setPath(params.path)
      setStep(asked)
      return
    }
    if (prefs.introSeen) setStep('welcome')
  }, [resolvedStart, prefsLoaded, prefs.introSeen, vault, router])

  /** Every transition goes through here, so a previous step's error cannot follow the user. */
  const go = (next: Step): void => {
    setError(null)
    setStep(next)
  }

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(engineErrorCopy(err))
    } finally {
      setBusy(false)
    }
  }

  const seenIntro = (): void => {
    if (!prefs.introSeen) setPrefs({ introSeen: true })
  }

  const strength = passwordStrength(password)
  const passwordOk = strength.score > 0 && password === confirm

  /** The fork. The popup renders no secrets (§3.2), so it hands the whole path to tab.html. */
  const begin = (next: Path): void => {
    if (host.secretsAllowed) {
      setPath(next)
      go(next === 'create' ? 'words' : next === 'import' ? 'import' : 'watch')
      if (next === 'create') void startWords()
      return
    }
    if (host.openInTab) {
      // Carry the chosen path, so the tab does not restart at the fork.
      host.openInTab({
        screen: 'onboarding',
        params: { path: next, step: next === 'create' ? 'welcome' : next },
      })
      return
    }
    if (host.openSecretScreen) {
      host.openSecretScreen('onboarding')
      return
    }
    // Never a key that does nothing.
    setError(
      t({
        id: 'ob.needtab',
        message:
          'This step needs the full tab, and this window cannot open one. Open BoltVault from the toolbar and try again.',
      }),
    )
  }

  const startWords = (): Promise<void> =>
    run(async () => {
      const r = await engine.vault.propose({})
      const words = r.mnemonic.split(' ')
      setMnemonic(words)
      // The engine chose these and will only accept an answer to them
      // (ES-BV-004); the screen no longer picks its own.
      setPositions(r.positions)
      setAnswers({})
    })

  /** The quiz is checked here because the seed does not exist yet; the engine checks it again at the end. */
  const quizOk =
    positions.length > 0 &&
    positions.every((p) => (answers[p] ?? '').trim().toLowerCase() === mnemonic[p - 1])

  /**
   * The end of onboarding: the passkey offer if this device has a factor, and
   * otherwise the wallet itself.
   *
   * There used to be one more screen — "This is Electroneum Smart Chain
   * (52014)", the address, and a key that said "Open my wallet" — which is a
   * page whose entire job is to be dismissed. Owner: "remove the ... page at
   * the end of onboarding, go straight to the home screen." Nothing on it is
   * lost: the address is on Home under the account name and on Receive, and
   * the "send ETN here, not from the old app" advice is the funding notice
   * Home's rotor now carries while the wallet is empty.
   */
  const finish = (): void => {
    if (passkeysSupported || biometricsSupported) {
      go('passkey')
      return
    }
    router.reset()
  }

  const sealCreate = (): Promise<void> =>
    run(async () => {
      const r = await engine.vault.import({ mnemonic: mnemonic.join(' '), password })
      // The engine verifies the same words it stored, so the gate is earned, not asserted.
      const ok = await engine.vault.confirmBackup({
        seedId: r.seedId,
        answers: positions.map((p) => ({ position: p, word: answers[p] ?? '' })),
      })
      if (!ok.ok)
        throw new Error(
          t({
            id: 'quiz.wrong',
            message: 'Those words do not match your phrase. Check the numbers and try again.',
          }),
        )
      setMnemonic([])
      setAnswers({})
      finish()
    })

  const sealImport = (): Promise<void> =>
    run(async () => {
      await engine.vault.import({
        mnemonic: phrase,
        password,
        ...(passphrase ? { passphrase } : {}),
      })
      setPhrase('')
      finish()
    })

  const sealWatch = (): Promise<void> =>
    run(async () => {
      /*
        The address is already known-good: it was validated, and resolved if it
        was a name, at the watch step. This used to run `createEmpty` first and
        `addWatch` second, so a bad address left an empty vault on disk and
        every retry failed with "a vault already exists".
      */
      const address = watchResolved ?? watchAddress.trim()
      await engine.vault.createEmpty({ password })
      await engine.accounts.addWatch({
        address,
        label: t({ id: 'watch.label', message: 'Watch address' }),
      })
      finish()
    })

  /** A 0x address, or a name this chain can resolve. */
  const checkWatch = (): Promise<void> =>
    run(async () => {
      const raw = watchAddress.trim()
      if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
        setWatchResolved(raw)
        go('password')
        return
      }
      const hit = await engine.names.resolve({ chainId: 52014, name: raw })
      if (!hit.address)
        throw new Error(
          t({ id: 'ob.watch.noname', message: 'That name does not resolve to an address.' }),
        )
      setWatchResolved(hit.address)
      go('password')
    })

  const enrolBiometrics = (): Promise<void> =>
    run(async () => {
      if (!host.deviceKey) return
      const keyHex = await host.deviceKey.ensure()
      // The password was set moments ago in this same flow and is still in hand.
      await engine.vault.enrolDevice({ keyId: host.deviceKey.id, keyHex, password })
      router.reset()
    })

  const enrolPasskey = (): Promise<void> =>
    run(async () => {
      if (!host.passkeys) return
      const res = await host.passkeys.create({
        userName: 'BoltVault',
        userIdHex: PASSKEY_USER_ID,
        rpName: 'BoltVault',
      })
      await engine.vault.enrolPasskey({
        credentialId: res.credentialId,
        prfSecretHex: res.prfSecretHex,
        password,
      })
      router.reset()
    })

  const inset = metrics.insetWide
  const progress = progressFor(path, step)

  const back = (to: Step, label = t({ id: 'back', message: 'Back' })): React.ReactNode => (
    <Key label={label} kind="secondary" disabled={busy} onPress={() => go(to)} testID="ob-back" />
  )

  return (
    <Column flex={1} backgroundColor="$void" testID="onboarding">
      <Backdrop scene={scene} width={width} height={height} reducedMotion={reducedMotion} />
      <ScrollView
        style={{ zIndex: 1 }}
        contentContainerStyle={{ padding: inset, gap: 20, flexGrow: 1, justifyContent: 'center' }}
      >
        {/* Where you are, and only where the flow really is a sequence (§7.2.4). */}
        {progress ? (
          <Row
            gap={4}
            testID="ob-progress"
            accessibilityRole="progressbar"
            accessibilityValue={{ now: progress.now, max: progress.max }}
          >
            {Array.from({ length: progress.max }, (_, i) => (
              <Column
                key={i}
                flex={1}
                height={3}
                borderRadius={2}
                backgroundColor={i < progress.now ? paint.arcSoft : 'transparent'}
                borderWidth={1}
                borderColor={i < progress.now ? paint.arcEdge : paint.glassRaisedSolid}
              />
            ))}
          </Row>
        ) : null}

        {step === 'intro' ? (
          <IntroCarousel
            reducedMotion={reducedMotion}
            onSkip={() => {
              seenIntro()
              go('welcome')
            }}
            onDone={() => {
              seenIntro()
              go('welcome')
            }}
          />
        ) : null}

        {step === 'blocked' ? (
          <Column gap="$4" testID="ob-blocked">
            <Body size="title">
              {t({ id: 'ob.blocked.title', message: 'This device already has a vault' })}
            </Body>
            <Body tone="mute">
              {t({
                id: 'ob.blocked.body',
                message:
                  'Unlock it to carry on. To use a different recovery phrase, add it as another account once you are in.',
              })}
            </Body>
            <Key
              label={t({ id: 'ob.blocked.key', message: 'Open my wallet' })}
              onPress={() => router.reset()}
              testID="ob-blocked-open"
            />
          </Column>
        ) : null}

        {step === 'welcome' ? (
          <Column gap="$4">
            <Body size="title">
              {t({ id: 'ob.welcome.title', message: 'Your keys, your Electroneum' })}
            </Body>
            <Body tone="mute">
              {t({
                id: 'ob.welcome.body',
                message:
                  'BoltVault keeps your recovery phrase on this device, sealed with your password. Nothing leaves it unless you export it.',
              })}
            </Body>
            <Key
              label={t({ id: 'ob.create', message: 'Create a new vault' })}
              disabled={busy}
              onPress={() => begin('create')}
              testID="ob-create"
            />
            <Key
              label={t({ id: 'ob.import', message: 'Import a recovery phrase' })}
              kind="secondary"
              disabled={busy}
              onPress={() => begin('import')}
              testID="ob-import"
            />
            <Key
              label={t({ id: 'ob.watch', message: 'Watch an address' })}
              kind="secondary"
              disabled={busy}
              onPress={() => begin('watch')}
              testID="ob-watch"
            />
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            <Body tone="mute" size="caption">
              {t({
                id: 'ob.hardware.note',
                message:
                  'Ledger, Trezor and Keystone accounts are added from the Accounts sheet after your vault exists.',
              })}
            </Body>
          </Column>
        ) : null}

        {step === 'words' ? (
          <Column gap="$4" testID="ob-words">
            <Row gap="$2">
              <Icon name="lock" size={18} color={paint.mute} />
              <Body size="title">
                {t({ id: 'ob.words.title', message: 'Write these 12 words down, in order' })}
              </Body>
            </Row>
            <Body tone="mute">
              {t({
                id: 'ob.words.body',
                message:
                  'This is the only copy. Anyone with these words controls your funds; BoltVault will never ask for them except on this screen and the check that follows.',
              })}
            </Body>
            <Plate role="raised">
              {masked ? (
                <Column
                  minHeight={168}
                  alignItems="center"
                  justifyContent="center"
                  gap="$2"
                  testID="ob-words-masked"
                >
                  <Icon name="eyeOff" size={20} color={paint.mute} />
                  <Body tone="mute" size="caption">
                    {t({
                      id: 'secret.masked',
                      message: 'Hidden while this window is not in front',
                    })}
                  </Body>
                </Column>
              ) : mnemonic.length > 0 ? (
                <WordGrid words={mnemonic} testID="word-grid" />
              ) : (
                <Column minHeight={168} alignItems="center" justifyContent="center">
                  <Body tone="mute" size="caption">
                    {t({ id: 'ob.words.making', message: 'Making your phrase…' })}
                  </Body>
                </Column>
              )}
            </Plate>
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            <Key
              label={t({ id: 'ob.words.done', message: 'I wrote them down' })}
              onPress={() => go('quiz')}
              disabled={busy || mnemonic.length === 0}
              testID="ob-words-done"
            />
            {/* Nothing is written yet, so leaving here costs nothing and loses nothing. */}
            {back('welcome', t({ id: 'ob.words.back', message: 'Start over' }))}
          </Column>
        ) : null}

        {step === 'quiz' ? (
          <Column gap="$4" testID="ob-quiz">
            <Body size="title">{t({ id: 'ob.quiz.title', message: 'Confirm three words' })}</Body>
            <Body tone="mute">
              {t({
                id: 'ob.quiz.body',
                message:
                  'Type the words at these positions. This is the backup check that unlocks swapping and signing.',
              })}
            </Body>
            {positions.map((p) => {
              const given = (answers[p] ?? '').trim().toLowerCase()
              const wrong = given.length > 0 && given !== mnemonic[p - 1]
              return (
                <Input
                  key={p}
                  label={t({ id: 'ob.quiz.word', message: 'Word {n}', values: { n: p } })}
                  value={answers[p] ?? ''}
                  onChange={(v) => setAnswers({ ...answers, [p]: v })}
                  autoCapitalize="none"
                  // Per field, as it is typed — one error at the end never said which word was wrong.
                  error={
                    wrong
                      ? t({ id: 'ob.quiz.nomatch', message: 'Not the word at this position' })
                      : null
                  }
                  sensitive="code"
                  testID={`quiz-${p}`}
                />
              )
            })}
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            <Key
              label={t({ id: 'continue', message: 'Continue' })}
              onPress={() => go('password')}
              disabled={busy || !quizOk}
              testID="ob-quiz-confirm"
            />
            <Key
              label={t({ id: 'ob.quiz.back', message: 'Show the words again' })}
              kind="secondary"
              disabled={busy}
              onPress={() => go('words')}
              testID="ob-quiz-back"
            />
          </Column>
        ) : null}

        {step === 'import' ? (
          <Column gap="$4" testID="ob-import-words">
            <Body size="title">
              {t({ id: 'ob.import.title', message: 'Enter your recovery phrase' })}
            </Body>
            <Input
              value={phrase}
              onChange={setPhrase}
              multiline
              placeholder={t({
                id: 'ob.import.ph',
                message: '12 or 24 words, separated by spaces',
              })}
              autoFocus
              hint={mnemonicHint(phrase)}
              sensitive
              testID="ob-phrase"
            />
            <Input
              label={t({ id: 'ob.passphrase', message: 'BIP-39 passphrase (optional, advanced)' })}
              value={passphrase}
              onChange={setPassphrase}
              secure
              sensitive
              testID="ob-passphrase"
            />
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            <Key
              label={t({ id: 'ob.import.preview', message: 'Preview addresses' })}
              disabled={!mnemonicLengthOk(phrase) || busy}
              onPress={() =>
                run(async () => {
                  setPreview(
                    await engine.accounts.previewDerivations({
                      mnemonic: mnemonicWords(phrase).join(' '),
                      ...(passphrase ? { passphrase } : {}),
                      count: 3,
                    }),
                  )
                  go('preview')
                })
              }
              testID="ob-import-preview"
            />
            {back('welcome')}
          </Column>
        ) : null}

        {step === 'preview' && preview ? (
          <Column gap="$4" testID="ob-preview">
            <Body size="title">
              {t({ id: 'ob.preview.title', message: 'Which addresses do you recognise?' })}
            </Body>
            <Body tone="mute">
              {t({
                id: 'ob.preview.body',
                message:
                  'Wallets derive accounts along two common trees. BoltVault uses the standard (BIP-44) tree; Ledger Live uses another. Both agree on the first address.',
              })}
            </Body>
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
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            <Key
              label={t({ id: 'continue', message: 'Continue' })}
              onPress={() => go('password')}
              disabled={busy}
              testID="ob-import-confirm"
            />
            {back('import')}
          </Column>
        ) : null}

        {step === 'watch' ? (
          <Column gap="$4" testID="ob-watch-form">
            <Body size="title">{t({ id: 'ob.watch.title', message: 'Watch an address' })}</Body>
            <Body tone="mute">
              {t({
                id: 'ob.watch.body',
                message:
                  'You will see balances and activity but cannot send or sign. Add a key or pair a device later.',
              })}
            </Body>
            <Input
              value={watchAddress}
              onChange={setWatchAddress}
              placeholder="0x… or name.etn"
              autoCapitalize="none"
              autoFocus
              testID="ob-watch-address"
            />
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            <Key
              label={t({ id: 'continue', message: 'Continue' })}
              onPress={checkWatch}
              disabled={busy || watchAddress.trim().length === 0}
              testID="ob-watch-confirm"
            />
            {back('welcome')}
          </Column>
        ) : null}

        {step === 'password' ? (
          <Column gap="$4" testID="ob-password-step">
            <Body size="title">{t({ id: 'ob.password.title', message: 'Choose a password' })}</Body>
            <Body tone="mute">
              {t({
                id: 'ob.password.body',
                message:
                  'It seals your vault on this device. A few unrelated words beat a short string of symbols. We cannot reset it.',
              })}
            </Body>
            <Input
              label={t({ id: 'ob.password', message: 'Password' })}
              value={password}
              onChange={setPassword}
              secure
              autoFocus
              hint={password ? strength.label : null}
              sensitive
              testID="ob-password"
            />
            <Input
              label={t({ id: 'ob.confirm', message: 'Confirm password' })}
              value={confirm}
              onChange={setConfirm}
              secure
              error={
                confirm && confirm !== password
                  ? t({ id: 'ob.mismatch', message: 'The passwords differ.' })
                  : null
              }
              sensitive
              testID="ob-confirm"
            />
            <Row gap="$2">
              {[0, 1, 2].map((i) => (
                <Row
                  key={i}
                  flex={1}
                  height={4}
                  borderRadius={2}
                  backgroundColor={
                    strength.score > i
                      ? strength.score === 3
                        ? paint.arc
                        : paint.ember
                      : paint.glassRaisedSolid
                  }
                />
              ))}
            </Row>
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            <Key
              label={t({ id: 'ob.password.seal', message: 'Create vault' })}
              disabled={!passwordOk || busy}
              onPress={() =>
                path === 'create' ? sealCreate() : path === 'import' ? sealImport() : sealWatch()
              }
              testID="ob-password-continue"
            />
            {back(path === 'create' ? 'quiz' : path === 'import' ? 'preview' : 'watch')}
          </Column>
        ) : null}

        {step === 'passkey' ? (
          <Column gap="$4" testID="ob-passkey">
            <Body size="title">
              {passkeysSupported
                ? t({ id: 'ob.passkey.title', message: 'Unlock with a passkey?' })
                : t({ id: 'ob.biometric.title', message: 'Unlock with your fingerprint?' })}
            </Body>
            <Body tone="mute">
              {t({
                id: 'ob.passkey.body',
                message:
                  'Your face or fingerprint unlocks the vault on this device. Your password still works, and it is still needed to reveal or export the phrase.',
              })}
            </Body>
            {error ? (
              <Body tone="burn" testID="ob-error">
                {error}
              </Body>
            ) : null}
            {passkeysSupported ? (
              <Key
                label={t({ id: 'ob.passkey.yes', message: 'Add passkey' })}
                onPress={enrolPasskey}
                disabled={busy}
                testID="ob-passkey-add"
              />
            ) : null}
            {biometricsSupported ? (
              <Key
                label={t({ id: 'ob.biometric.yes', message: 'Turn on biometric unlock' })}
                onPress={enrolBiometrics}
                disabled={busy}
                testID="ob-biometric-add"
              />
            ) : null}
            <Key
              label={t({ id: 'ob.passkey.skip', message: 'Not now' })}
              kind="secondary"
              onPress={() => router.reset()}
              testID="ob-passkey-skip"
            />
          </Column>
        ) : null}
      </ScrollView>
      {/*
        Whose wallet this is, on every step but the intro — the same lock-up as
        Unlock.tsx. The intro is a full-bleed sequence with its own chrome, and
        in a 400×600 popup the wordmark's 60 px is the difference between the
        body copy fitting and being clipped.
      */}
      {step === 'intro' ? null : (
        <Column alignItems="center" paddingBottom="$6" zIndex={1} testID="ob-brand">
          <EsWordmark />
        </Column>
      )}
    </Column>
  )
}
