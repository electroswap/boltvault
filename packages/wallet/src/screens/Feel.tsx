/**
 * Settings › Appearance & feel (master plan §7.8, §7.14): motion, haptics,
 * the per-block tick, sound, and the display currency. Sound and the tick
 * are off until asked for; nothing here nags.
 */
import { Body, Chip, Pill, Plate, Row, ScrollView, Toggle, metrics } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'

export function Feel({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
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
      <PageHeader title={t({ id: 'settings.feel', message: 'Appearance & feel' })} />
      {/* The background is a choice, not a given (owner, 2026-09-06). */}
      <Plate gap="$3" testID="feel-scene">
        <Body size="title">{t({ id: 'feel.scene', message: 'Background' })}</Body>
        <Body tone="mute" size="caption">
          {t({
            id: 'feel.scene.hint',
            message:
              'Circuit is a printed board that lights a trace on every Electroneum block. Grid is the wave mesh. Off draws neither and uses the least battery.',
          })}
        </Body>
        <Row gap="$2">
          <Pill
            label={t({ id: 'feel.scene.circuit', message: 'Circuit' })}
            selected={(settings?.scene ?? 'circuit') === 'circuit'}
            onPress={() => set({ scene: 'circuit' })}
            testID="feel-scene-circuit"
          />
          <Pill
            label={t({ id: 'feel.scene.grid', message: 'Grid' })}
            selected={settings?.scene === 'grid'}
            onPress={() => set({ scene: 'grid' })}
            testID="feel-scene-grid"
          />
          <Pill
            label={t({ id: 'feel.scene.off', message: 'Off' })}
            selected={settings?.scene === 'off'}
            onPress={() => set({ scene: 'off' })}
            testID="feel-scene-off"
          />
        </Row>
      </Plate>
      <Plate gap="$2" testID="feel-motion">
        <Toggle
          value={settings?.reducedMotion ?? false}
          onChange={(v) => set({ reducedMotion: v })}
          label={t({ id: 'feel.motion', message: 'Reduce motion' })}
          hint={t({
            id: 'feel.motion.hint',
            message:
              'The background holds still and digits update without rolling. Also follows your system’s reduce-motion setting.',
          })}
          testID="feel-motion-toggle"
        />
      </Plate>
      {/* Haptics and sound are the phone's (plan A4); the extension never shows them. */}
      {phone ? (
        <>
          {/*
        The widget's total (§7.13, ATT-BV-033). The snapshot is a plaintext
        file the widget process reads, so a total in it is a balance readable
        from a stolen phone while the wallet is locked. Off unless it is asked
        for, and the switch says what it costs.
      */}
          <Plate gap="$2" testID="feel-widget">
            <Toggle
              value={settings?.widgetShowsTotal ?? false}
              onChange={(v) => set({ widgetShowsTotal: v })}
              label={t({
                id: 'feel.widget.total',
                message: 'Show the total on the home-screen widget',
              })}
              hint={t({
                id: 'feel.widget.total.hint',
                message:
                  'Off. The widget always shows your Field and your account name; the total is a number anyone holding the phone can read without unlocking, and it is written to a file on disk to get there.',
              })}
              testID="feel-widget-toggle"
            />
          </Plate>

          <Plate gap="$2" testID="feel-haptics">
            <Toggle
              value={settings?.haptics ?? true}
              onChange={(v) => set({ haptics: v })}
              label={t({ id: 'feel.haptics', message: 'Haptics' })}
              hint={
                phone
                  ? t({
                      id: 'feel.haptics.hint',
                      message:
                        'A light tick on confirm and keys, medium on a receipt, heavy on danger.',
                    })
                  : t({ id: 'feel.haptics.web', message: 'Felt on the phone.' })
              }
              disabled={!phone || !host.haptic}
              testID="feel-haptics-toggle"
            />
            <Toggle
              value={settings?.blockTick ?? false}
              onChange={(v) => set({ blockTick: v })}
              label={t({ id: 'feel.tick', message: 'Tick every Electroneum block' })}
              hint={t({
                id: 'feel.tick.hint',
                message:
                  'One light tap every five seconds while Home is open. Off unless you like it.',
              })}
              disabled={!phone || !host.haptic || settings?.haptics === false}
              testID="feel-tick-toggle"
            />
          </Plate>
          <Plate gap="$2" testID="feel-sound">
            <Toggle
              value={settings?.sound ?? false}
              onChange={(v) => set({ sound: v })}
              label={t({ id: 'feel.sound', message: 'Sound' })}
              hint={
                phone
                  ? t({
                      id: 'feel.sound.hint',
                      message: 'Three sounds: a confirm, a receive, an error. Nothing else.',
                    })
                  : t({ id: 'feel.sound.web', message: 'No sound in the extension.' })
              }
              disabled={!phone || !host.sound}
              testID="feel-sound-toggle"
            />
            {phone && host.sound ? (
              <Row gap="$2">
                {(['confirm', 'receive', 'error'] as const).map((k) => (
                  <Chip
                    key={k}
                    onPress={() => host.sound?.(k)}
                    cursor="pointer"
                    minHeight={44}
                    justifyContent="center"
                    testID={`feel-sound-${k}`}
                  >
                    <Body tone="mute" size="caption">
                      {k}
                    </Body>
                  </Chip>
                ))}
              </Row>
            ) : null}
          </Plate>
        </>
      ) : null}
      <Plate gap="$2" testID="feel-currency">
        <Body size="title">{t({ id: 'feel.currency', message: 'Display currency' })}</Body>
        <Row gap="$2">
          {(['USD', 'ETN'] as const).map((c) => (
            <Pill
              key={c}
              label={c}
              selected={settings?.displayCurrency === c}
              onPress={() => set({ displayCurrency: c })}
              testID={`feel-currency-${c}`}
            />
          ))}
        </Row>
      </Plate>
    </ScrollView>
  )
}
