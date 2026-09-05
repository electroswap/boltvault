/**
 * The flow plate (master plan §8.6, §8.10): a multi-sheet flow's steps with
 * their status, the Discharge when it lands, and one key back. Shared by
 * Swap, the Piece, the farm, the campaign and the Legends vault — each
 * shows only the flow kinds it started.
 */
import { Body, Column, Discharge, Icon, Key, Plate, Row, ScrollView, metrics, paint, useWindowDimensions } from '@boltvault/ui'
import type { SwapFlow } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

export function stepLabel(step: SwapFlow['steps'][number]['step']): string {
  switch (step) {
    case 'wrap':
      return t({ id: 'flow.wrap', message: 'Wrap ETN' })
    case 'approve':
      return t({ id: 'flow.approve', message: 'Allow the contract to pull the tokens' })
    case 'permit':
      return t({ id: 'flow.permit', message: 'Permit this amount' })
    case 'swap':
      return t({ id: 'flow.swap', message: 'Swap' })
    case 'submit':
      return t({ id: 'flow.submit', message: 'Place order' })
    case 'cancel':
      return t({ id: 'flow.cancel', message: 'Cancel order' })
    case 'approve_collection':
      return t({ id: 'flow.approveCollection', message: 'Let the marketplace move this collection' })
    case 'sign_order':
      return t({ id: 'flow.signOrder', message: 'Sign the order' })
    case 'post_order':
      return t({ id: 'flow.postOrder', message: 'Publish to the marketplace' })
    case 'buy':
      return t({ id: 'flow.buy', message: 'Buy' })
    case 'accept':
      return t({ id: 'flow.accept', message: 'Accept the offer' })
    case 'cancel_order':
      return t({ id: 'flow.cancelOrder', message: 'Cancel the order' })
    case 'transfer':
      return t({ id: 'flow.transfer', message: 'Send the piece' })
    case 'mint':
      return t({ id: 'flow.mint', message: 'Mint' })
    case 'deposit':
      return t({ id: 'flow.deposit', message: 'Deposit' })
    case 'withdraw':
      return t({ id: 'flow.withdraw', message: 'Withdraw' })
    case 'collect':
      return t({ id: 'flow.collect', message: 'Collect' })
    case 'contribute':
      return t({ id: 'flow.contribute', message: 'Contribute' })
    case 'claim':
      return t({ id: 'flow.claim', message: 'Claim' })
    case 'register':
      return t({ id: 'flow.register', message: 'Activate dividends' })
  }
}

export function statusLabel(status: SwapFlow['steps'][number]['status']): string {
  switch (status) {
    case 'pending':
      return t({ id: 'flow.pending', message: 'Next' })
    case 'signing':
      return t({ id: 'flow.signing', message: 'Waiting for you' })
    case 'submitted':
      return t({ id: 'flow.submitted', message: 'Confirming…' })
    case 'confirmed':
      return t({ id: 'flow.confirmed', message: 'Done' })
    case 'rejected':
      return t({ id: 'flow.rejected', message: 'Rejected' })
    case 'failed':
      return t({ id: 'flow.failed', message: 'Failed' })
  }
}

/** The active flow, only when it is one of these kinds and belongs to the active account. */
export function useActiveFlow(kinds: ReadonlyArray<SwapFlow['kind']>): { flow: SwapFlow | null; dismiss: () => void } {
  const { flow, dismiss } = useSwapFlow()
  const { active } = useWalletState()
  return { flow: flow && kinds.includes(flow.kind) && flow.accountId === active?.id ? flow : null, dismiss }
}

export interface FlowPlateProps {
  readonly flow: SwapFlow
  readonly titles: { readonly working: string; readonly done: string }
  readonly summary?: string | null
  readonly onDone: () => void
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function FlowPlate({ flow, titles, summary = null, onDone, body, reducedMotion = false, testID = 'flow' }: FlowPlateProps) {
  const { width, height } = useWindowDimensions()
  const [fire, setFire] = useState(0)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const finished = flow.status !== 'running'
  useEffect(() => {
    if (flow.status === 'done') setFire((n) => n + 1)
  }, [flow.status])
  return (
    <Column flex={1} backgroundColor="$void" testID={testID}>
      {finished ? <Discharge fire={fire} kind={flow.status === 'done' ? 'confirm' : 'reject'} width={width} height={height} reducedMotion={reducedMotion} /> : null}
      <ScrollView contentContainerStyle={{ padding: inset, gap: 14, flexGrow: 1, justifyContent: 'center' }} style={{ zIndex: 1 }}>
        <Body size="title" testID={`${testID}-title`}>
          {flow.status === 'done' ? titles.done : flow.status === 'rejected' ? t({ id: 'flow.rejected.title', message: 'Nothing was signed' }) : flow.status === 'failed' ? t({ id: 'flow.failed.title', message: 'The network refused it' }) : titles.working}
        </Body>
        {summary ? <Body tone="mute">{summary}</Body> : null}
        <Plate gap="$2" testID={`${testID}-steps`}>
          {flow.steps.map((s, i) => (
            <Row key={`${s.step}-${i}`} justifyContent="space-between" alignItems="center" minHeight={28}>
              <Row gap="$2" alignItems="center" flexShrink={1}>
                <Icon name={s.status === 'confirmed' ? 'check' : s.status === 'rejected' || s.status === 'failed' ? 'close' : 'chevronRight'} size={16} color={s.status === 'confirmed' ? paint.arc : s.status === 'rejected' || s.status === 'failed' ? paint.burn : paint.mute} />
                <Body tone={s.status === 'signing' ? 'ink' : 'mute'} numberOfLines={1}>
                  {stepLabel(s.step)}
                </Body>
              </Row>
              <Body tone={s.status === 'confirmed' ? 'arc' : s.status === 'rejected' || s.status === 'failed' ? 'burn' : 'mute'} size="caption" testID={`${testID}-step-${s.step}`}>
                {statusLabel(s.status)}
              </Body>
            </Row>
          ))}
        </Plate>
        {flow.error ? <Body tone="burn">{flow.error}</Body> : null}
        {flow.hash ? (
          <Body tone="mute" size="caption" fontFamily="$mono" numberOfLines={1} testID={`${testID}-hash`}>
            {flow.hash}
          </Body>
        ) : null}
        {finished ? <Key label={flow.status === 'done' ? t({ id: 'flow.back', message: 'Back' }) : t({ id: 'flow.tryAgain', message: 'Try again' })} onPress={onDone} testID={`${testID}-done`} /> : null}
      </ScrollView>
    </Column>
  )
}
