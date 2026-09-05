/**
 * Moments — the harness screen for the signature moments (master plan §7.12):
 * Ignition, Discharge, the engraved QR. Not reachable from the product UI;
 * the screenshot harness and reviewers open it directly.
 */
import { Body, Column, Discharge, Field, Ignition, Key, LiveFilament, Plate, QR, RollingReadout, Row, metrics, useWindowDimensions } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { t } from '../i18n'

export function Moments({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const { width, height } = useWindowDimensions()
  const [fire, setFire] = useState(0)
  const [value, setValue] = useState('12,478.00')
  const [block, setBlock] = useState(15_100_000)
  useEffect(() => {
    const id = setInterval(() => setBlock((b) => b + 1), 5000)
    return () => clearInterval(id)
  }, [])
  return (
    <Column flex={1} backgroundColor="$void" testID="moments">
      <Field address="0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63" pulse={1} width={width} height={height} reducedMotion={reducedMotion} />
      <Discharge fire={fire} width={width} height={height} reducedMotion={reducedMotion} testID="discharge" />
      <Column padding={metrics.insetWide} gap="$5" zIndex={1} position="relative">
        <Ignition reducedMotion={reducedMotion} order={0}>
          <Body size="title">{t({ id: 'moments.title', message: 'Signature moments' })}</Body>
        </Ignition>
        <Ignition reducedMotion={reducedMotion} order={2}>
          <Column gap="$2">
            <RollingReadout value={`$${value}`} hero reducedMotion={reducedMotion} testID="moments-readout" />
            <LiveFilament tick={block} live reducedMotion={reducedMotion} />
          </Column>
        </Ignition>
        <Ignition reducedMotion={reducedMotion} order={3}>
          <Row gap="$3">
            <Key label={t({ id: 'moments.discharge', message: 'Fire discharge' })} onPress={() => setFire((n) => n + 1)} testID="fire-discharge" />
            <Key label={t({ id: 'moments.roll', message: 'Roll digits' })} kind="secondary" onPress={() => setValue((v) => (v === '12,478.00' ? '12,491.36' : '12,478.00'))} testID="roll" />
          </Row>
        </Ignition>
        <Ignition reducedMotion={reducedMotion} order={3}>
          <Plate role="raised" alignItems="center" gap="$3" testID="qr-plate">
            <QR value="ethereum:0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63@52014" size={180} />
            <Body tone="arc" size="caption">
              Electroneum · 52014
            </Body>
          </Plate>
        </Ignition>
      </Column>
    </Column>
  )
}
