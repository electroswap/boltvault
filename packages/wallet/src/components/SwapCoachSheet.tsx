/**
 * The first-swap coach (plan B4, owner item W7): an overlay, once. What the
 * three signatures are, where the fee goes, and that BOLT lowers it. "Got
 * it" is remembered in the prefs document.
 */
import { Body, Column, Icon, Key, Row, Sheet, paint } from '@boltvault/ui'
import { t } from '../i18n'

export function SwapCoachSheet({ open, onDismiss, reducedMotion = false }: { open: boolean; onDismiss: () => void; reducedMotion?: boolean }) {
  const steps = [
    { icon: 'approvals' as const, title: t({ id: 'swap.coach.1', message: 'Allow Permit2, once' }), body: t({ id: 'swap.coach.1.body', message: 'The shared allowance contract ElectroSwap uses. One signature per token, ever.' }) },
    { icon: 'key' as const, title: t({ id: 'swap.coach.2', message: 'Permit this exact amount' }), body: t({ id: 'swap.coach.2.body', message: 'A signed message, not a transaction. Nothing else can move.' }) },
    { icon: 'swap' as const, title: t({ id: 'swap.coach.3', message: 'The swap itself' }), body: t({ id: 'swap.coach.3.body', message: 'Paying with ETN needs only this one.' }) },
  ]
  return (
    <Sheet open={open} onClose={onDismiss} title={t({ id: 'swap.coach.title', message: 'Your first swap' })} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'swap.coach.ok', message: 'Got it' })} onPress={onDismiss} testID="swap-coach-ok" />} testID="swap-coach">
      <Column gap="$3">
        {steps.map((s) => (
          <Row key={s.title} gap="$3" alignItems="flex-start">
            <Row width={32} height={32} borderRadius={16} backgroundColor="$glassRaised" alignItems="center" justifyContent="center" marginTop={2}>
              <Icon name={s.icon} size={16} color={paint.arc} />
            </Row>
            <Column flex={1} gap={2}>
              <Body fontWeight="600">{s.title}</Body>
              <Body tone="mute" size="caption">
                {s.body}
              </Body>
            </Column>
          </Row>
        ))}
        <Body tone="mute" size="caption">
          {t({ id: 'swap.coach.fee', message: 'The wallet fee comes out of what you receive; holding BOLT lowers it. Tap the fee line for the schedule.' })}
        </Body>
      </Column>
    </Sheet>
  )
}
