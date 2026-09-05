/**
 * Settings › Appearance & feel (master plan §7.8, §7.14): motion, haptics,
 * the per-block tick, sound, and the display currency. Sound and the tick
 * are off until asked for; nothing here nags.
 */
import { Body, Chip, Icon, Key, Plate, Row, ScrollView, Toggle, metrics, paint } from '@boltvault/ui'
import type { Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'

export function Feel({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const [settings, setSettings] = useState<Settings | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  useEffect(() => {
    engine.settings.get().then(setSettings, () => undefined)
  }, [engine])
  const set = (patch: Partial<Settings>): void => {
    engine.settings.set(patch).then(setSettings, () => undefined)
  }
  const phone = body === 'mobile'
  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="feel">
      <Row justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'settings.feel', message: 'Appearance & feel' })}</Body>
      </Row>
      <Plate gap="$2" testID="feel-motion">
        <Toggle value={settings?.reducedMotion ?? false} onChange={(v) => set({ reducedMotion: v })} label={t({ id: 'feel.motion', message: 'Reduce motion' })} hint={t({ id: 'feel.motion.hint', message: 'The Field holds still, digits update without rolling, the discharge is a short fade. The app is complete without motion.' })} testID="feel-motion-toggle" />
      </Plate>
      <Plate gap="$2" testID="feel-haptics">
        <Toggle value={settings?.haptics ?? true} onChange={(v) => set({ haptics: v })} label={t({ id: 'feel.haptics', message: 'Haptics' })} hint={phone ? t({ id: 'feel.haptics.hint', message: 'A light tick on confirm and keys, medium on a receipt, heavy on danger.' }) : t({ id: 'feel.haptics.web', message: 'Felt on the phone.' })} disabled={!phone || !host.haptic} testID="feel-haptics-toggle" />
        <Toggle value={settings?.blockTick ?? false} onChange={(v) => set({ blockTick: v })} label={t({ id: 'feel.tick', message: 'Tick every Electroneum block' })} hint={t({ id: 'feel.tick.hint', message: 'One light tap every five seconds while Home is open. Off unless you like it.' })} disabled={!phone || !host.haptic || settings?.haptics === false} testID="feel-tick-toggle" />
      </Plate>
      <Plate gap="$2" testID="feel-sound">
        <Toggle value={settings?.sound ?? false} onChange={(v) => set({ sound: v })} label={t({ id: 'feel.sound', message: 'Sound' })} hint={phone ? t({ id: 'feel.sound.hint', message: 'Three sounds: a confirm, a receive, an error. Nothing else.' }) : t({ id: 'feel.sound.web', message: 'No sound in the extension.' })} disabled={!phone || !host.sound} testID="feel-sound-toggle" />
        {phone && host.sound ? (
          <Row gap="$2">
            {(['confirm', 'receive', 'error'] as const).map((k) => (
              <Chip key={k} onPress={() => host.sound?.(k)} cursor="pointer" minHeight={44} justifyContent="center" testID={`feel-sound-${k}`}>
                <Body tone="mute" size="caption">
                  {k}
                </Body>
              </Chip>
            ))}
          </Row>
        ) : null}
      </Plate>
      <Plate gap="$2" testID="feel-currency">
        <Body size="title">{t({ id: 'feel.currency', message: 'Display currency' })}</Body>
        <Row gap="$2">
          {(['USD', 'ETN'] as const).map((c) => (
            <Chip key={c} onPress={() => set({ displayCurrency: c })} cursor="pointer" minHeight={44} justifyContent="center" borderColor={settings?.displayCurrency === c ? paint.arc : undefined} testID={`feel-currency-${c}`}>
              <Body tone={settings?.displayCurrency === c ? 'arc' : 'mute'} size="caption">
                {c}
              </Body>
            </Chip>
          ))}
        </Row>
      </Plate>
    </ScrollView>
  )
}
