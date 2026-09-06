/**
 * Slippage (plan B4, owner item W2): a sheet, not an accordion. Three
 * presets, a custom field, and "Use as my default" which writes the
 * setting; Done keeps the choice for this swap only.
 */
import { Body, Column, Input, Key, Pill, Row, Sheet } from '@boltvault/ui'
import { useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { formatPct } from '../format'
import { t } from '../i18n'

const PRESETS = [10, 50, 100] as const

export function SlippageSheet({ open, onClose, value, onChange, reducedMotion = false }: { open: boolean; onClose: () => void; value: number; onChange: (bips: number) => void; reducedMotion?: boolean }) {
  const engine = useEngine()
  const [custom, setCustom] = useState('')
  const [saved, setSaved] = useState(false)
  const isPreset = (PRESETS as readonly number[]).includes(value)
  const useDefault = (): void => {
    void engine.settings.set({ slippageBips: value }).then(() => setSaved(true), () => undefined)
  }
  return (
    <Sheet open={open} onClose={onClose} title={t({ id: 'swap.slippage.title', message: 'Slippage' })} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'done', message: 'Done' })} size="compact" onPress={onClose} testID="swap-slippage-done" />} testID="swap-slippage-tray">
      <Column gap="$3">
        <Body tone="mute" size="caption">
          {t({ id: 'swap.slippage.body', message: 'How far the price may move between the quote and the block it lands in. The swap reverts past this instead of paying more.' })}
        </Body>
        <Row gap="$2" alignItems="center" flexWrap="wrap">
          {PRESETS.map((s) => (
            <Pill
              key={s}
              label={formatPct(s)}
              selected={value === s}
              onPress={() => {
                onChange(s)
                setCustom('')
                setSaved(false)
              }}
              testID={`swap-slippage-${s}`}
            />
          ))}
          <Column width={100}>
            <Input
              value={custom}
              onChange={(v) => {
                setCustom(v)
                setSaved(false)
                const n = Number(v)
                if (Number.isFinite(n) && n > 0 && n <= 50) onChange(Math.round(n * 100))
              }}
              placeholder={isPreset ? '1.5%' : formatPct(value)}
              testID="swap-slippage-custom"
            />
          </Column>
        </Row>
        {value > 300 ? (
          <Body tone="ember" size="caption" testID="swap-slippage-warn">
            {t({ id: 'swap.slippage.high', message: 'Above 3% a swap can be front-run for the difference.' })}
          </Body>
        ) : null}
        <Key label={saved ? t({ id: 'swap.slippage.saved', message: 'Saved as your default' }) : t({ id: 'swap.slippage.default', message: 'Use {p} as my default', values: { p: formatPct(value) } })} kind="secondary" size="compact" disabled={saved} onPress={useDefault} testID="swap-slippage-default" />
      </Column>
    </Sheet>
  )
}
