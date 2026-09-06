/**
 * Settings › About (master plan §8.14, §7.10): the version and build hash,
 * the one place the encryption is named, the fee sink and schedule
 * addresses, the signed-flags state, crash reports (off by default), and
 * where the audit, the SBOM and the security policy live.
 */
import { Body, Column, Key, Plate, ScrollView, Toggle, metrics, paint, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AboutView, FlagsView, Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'

const ETN = 52014
const SECURITY_URL = 'https://wallet.electroswap.io/security'

export function About({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [flags, setFlags] = useState<FlagsView | null>(null)
  const [about, setAbout] = useState<AboutView | null>(null)
  const [fee, setFee] = useState<{ sink: string | null; schedule: string | null } | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  useEffect(() => {
    engine.settings.get().then(setSettings, () => undefined)
    engine.flags.get().then(setFlags, () => undefined)
    engine.about.get().then(setAbout, () => undefined)
    engine.holder.addresses({ chainId: ETN }).then(setFee, () => setFee({ sink: null, schedule: null }))
    return engine.events.subscribe((e) => {
      if (e.type === 'flags.changed') setFlags(e.flags)
    })
  }, [engine])
  const set = (patch: Partial<Settings>): void => {
    engine.settings.set(patch).then(setSettings, () => undefined)
  }
  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="about">
      <PageHeader title={t({ id: 'settings.about', message: 'About' })} />

      <Plate gap={4} testID="about-version">
        <Body size="title">BoltVault {host.version ?? '0.1.0'}</Body>
        <Body tone="mute" size="caption">
          {host.buildHash ? t({ id: 'about.build', message: 'Build {h} — reproducible; the hash is published with every release.', values: { h: host.buildHash.slice(0, 12) } }) : t({ id: 'about.build.dev', message: 'Development build.' })}
        </Body>
      </Plate>

      {about && !about.apiIsDefault ? (
        <Plate gap={4} borderColor={paint.ember} testID="about-dev-api">
          <Body size="title">{t({ id: 'about.dev', message: 'Development build' })}</Body>
          <Body tone="ember" size="caption">
            {t({ id: 'about.dev.body', message: 'This build talks to {o} instead of ElectroSwap’s servers. Prices, activity, the marketplace and the launchpad come from there.', values: { o: about.apiOrigin } })}
          </Body>
        </Plate>
      ) : null}

      <Plate gap={4} testID="about-encryption">
        <Body size="title">{t({ id: 'about.encryption', message: 'Encryption' })}</Body>
        <Body tone="mute" size="caption">
          Argon2id + XChaCha20-Poly1305 · secp256k1 (noble) · vault file v2
        </Body>
      </Plate>

      <Plate gap={4} testID="about-fee">
        <Body size="title">{t({ id: 'about.fee', message: 'Wallet fee' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'about.fee.body', message: 'In-wallet swaps pay 0.5% of the output, less by BOLT/DYNO tier, to the fee sink on Electroneum. Fees fund the wallet; the sink’s sweeps are on the explorer.' })}
        </Body>
        <Body tone="mute" size="caption">
          {fee?.sink ? `${t({ id: 'about.sink', message: 'Sink' })} ${shortAddress(fee.sink)} · ${t({ id: 'about.schedule', message: 'Schedule' })} ${fee.schedule ? shortAddress(fee.schedule) : '—'}` : t({ id: 'about.fee.none', message: 'Not configured in this build — in-wallet swaps stay off until it is.' })}
        </Body>
      </Plate>

      <Plate gap={4} testID="about-flags">
        <Body size="title">{t({ id: 'about.flags', message: 'Signed flags' })}</Body>
        <Body tone="mute" size="caption">
          {flags?.fetchedAt ? t({ id: 'about.flags.ok', message: 'Kill-switches and the scam list are signed by ElectroSwap and checked every six hours ({n} scam origins).', values: { n: flags.scamOriginsCount } }) : t({ id: 'about.flags.none', message: 'No signed flags received yet — nothing is switched off, and the built-in scam rules apply.' })}
          {flags?.problem ? ` ${flags.problem}` : ''}
        </Body>
        {flags?.flags.notice ? (
          <Body tone="ember" size="caption" testID="about-notice">
            {flags.flags.notice}
          </Body>
        ) : null}
      </Plate>

      <Plate gap="$2" testID="about-crash">
        <Toggle value={settings?.crashReports ?? false} onChange={(v) => set({ crashReports: v })} label={t({ id: 'about.crash', message: 'Send crash reports' })} hint={t({ id: 'about.crash.hint', message: 'Off by default. A crash sends the message and stack to ElectroSwap — addresses, secrets and URLs scrubbed — nothing else, ever.' })} testID="about-crash-toggle" />
      </Plate>

      <Plate gap="$2" testID="about-links">
        <Column gap="$2">
          <Key label={t({ id: 'about.security', message: 'Security policy & audits' })} kind="secondary" onPress={() => void host.openUrl?.(SECURITY_URL)} testID="about-security" />
          <Key label={t({ id: 'about.sbom', message: 'Software bill of materials' })} kind="secondary" onPress={() => void host.openUrl?.(`${SECURITY_URL}#sbom`)} testID="about-sbom" />
          <Key label={t({ id: 'about.report', message: 'Report a problem' })} kind="secondary" onPress={() => void host.openUrl?.('https://github.com/ElectroSwap/boltvault/issues')} testID="about-report" />
        </Column>
        <Body tone="mute" size="caption">
          {t({ id: 'about.privacy', message: 'No analytics. Only ElectroSwap’s API and the chain RPCs ever see an address.' })}
        </Body>
      </Plate>
    </ScrollView>
  )
}
