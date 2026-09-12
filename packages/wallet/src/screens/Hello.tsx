/**
 * Hello — the M0 proof screen. One file, rendered by the extension popup, the
 * full tab and the Expo app. It exercises the whole path: UI → engine
 * (channel or in-process) → platform → chain RPC → event → UI.
 */
import {
  Address,
  Body,
  Column,
  Filament,
  Plate,
  Readout,
  Row,
  Screen,
  metrics,
} from '@boltvault/ui'
import { useEngineQuery } from '../engine/EngineProvider'
import { useChainHead } from '../hooks/useChainHead'

const ETN = 52014

export interface HelloProps {
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
}

function formatBlock(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function Hello({ body }: HelloProps) {
  const status = useEngineQuery((e) => e.vault.status(), [])
  const chains = useEngineQuery((e) => e.chains.list(), [])
  const head = useChainHead(ETN)

  return (
    <Screen
      padding={body === 'extension-popup' ? metrics.inset : metrics.insetWide}
      gap="$5"
      testID="hello"
    >
      <Row gap="$3">
        <Body size="title">BoltVault</Body>
        <Body tone="mute" size="caption">
          {body}
        </Body>
      </Row>

      <Column gap="$2">
        <Body tone="mute" size="caption">
          Electroneum block
        </Body>
        <Readout hero testID="head-block">
          {head ? formatBlock(head.blockNumber) : '—'}
        </Readout>
        <Filament stalled={!head?.live} testID="filament" />
        <Body tone="mute" size="caption">
          {head ? (head.live ? 'live' : 'stalled — showing the last block we saw') : 'connecting…'}
        </Body>
      </Column>

      <Plate role="raised" gap="$2">
        <Body size="title">Vault</Body>
        {status.error ? (
          <Body tone="burn">{status.error}</Body>
        ) : status.value ? (
          <Body testID="vault-status">
            {status.value.exists
              ? status.value.unlocked
                ? 'Unlocked'
                : 'Locked'
              : 'Not created yet'}{' '}
            · auto-lock {status.value.autoLock}
          </Body>
        ) : (
          <Body tone="mute">loading…</Body>
        )}
      </Plate>

      <Plate gap="$2">
        <Body size="title">Chains</Body>
        {chains.value?.map((c) => (
          <Row key={c.chainId} gap="$3" justifyContent="space-between">
            <Body tone={c.isHome ? 'arc' : 'ink'}>{c.name}</Body>
            <Address>{c.chainId}</Address>
          </Row>
        ))}
      </Plate>
    </Screen>
  )
}
