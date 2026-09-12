/**
 * One account in the rail (plan C2): the signature, the name, the short
 * address with the last-good balance beside it, an "Active" mark, and the
 * menu control. Tapping the row makes it the active account.
 */
import {
  Body,
  Column,
  Dot,
  Icon,
  IconButton,
  Pressable,
  Row,
  Signature,
  paint,
  shortAddress,
} from '@boltvault/ui'
import type { AccountView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../../engine/EngineProvider'
import { formatFiat } from '../../format'
import { useName } from '../../hooks/useNames'
import { t } from '../../i18n'

/** The account's last-good total, from the persisted portfolio document; '' until one exists. */
export function useAccountTotal(accountId: string): string {
  const engine = useEngine()
  const [text, setText] = useState('')
  useEffect(() => {
    let alive = true
    engine.portfolio.cached({ accountId }).then(
      (s) => {
        if (alive && s && s.total !== null) setText(formatFiat(s.total, s.currency))
      },
      () => undefined,
    )
    const off = engine.events.subscribe((e) => {
      if (
        e.type === 'portfolio.snapshot' &&
        e.snapshot.accountId === accountId &&
        e.snapshot.total !== null &&
        alive
      )
        setText(formatFiat(e.snapshot.total, e.snapshot.currency))
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, accountId])
  return text
}

export function kindLabel(a: AccountView): string {
  switch (a.kind) {
    case 'hd':
      return t({ id: 'acct.kind.hd', message: 'Recovery phrase' })
    case 'imported':
      return t({ id: 'acct.kind.imported', message: 'Imported key' })
    case 'ledger':
      return 'Ledger'
    case 'trezor':
      return 'Trezor'
    case 'keystone':
      return 'Keystone'
    case 'watch':
      return t({ id: 'acct.kind.watch', message: 'Watch-only' })
  }
}

/** "BIP-44 · #3" for a hardware account, "#3" for a phrase account, nothing for the rest. */
export function derivationLabel(a: AccountView): string | null {
  if (a.hardware) {
    const scheme =
      a.hardware.scheme === 'live' ? 'Ledger Live' : a.hardware.scheme === 'bip44' ? 'BIP-44' : null
    if (scheme && a.hardware.index !== undefined) return `${scheme} · #${a.hardware.index}`
    return a.hardware.path
  }
  if (a.kind === 'hd' && a.index !== undefined) return `#${a.index}`
  return null
}

export function AccountRow({
  account,
  active,
  onSelect,
  onMenu,
  onCopy,
  copied = false,
}: {
  account: AccountView
  active: boolean
  onSelect: () => void
  onMenu: () => void
  onCopy?: () => void
  copied?: boolean
}) {
  const total = useAccountTotal(account.id)
  /*
    The second line is the only place this row says which address it is, and
    `0x1F90…7B63` is not an answer anybody can check against what they were
    told. A primary name stands in its place when one resolves; copy still
    copies the address, because that is the thing you paste.
  */
  const name = useName(account.address)
  return (
    <Row
      alignItems="center"
      gap="$2"
      opacity={account.hidden ? 0.55 : 1}
      testID={`account-${account.id}`}
    >
      <Pressable
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel={account.label}
        accessibilityState={{ selected: active }}
        style={{ flex: 1, minHeight: 52, justifyContent: 'center' }}
        testID={`use-${account.id}`}
      >
        <Row gap="$3" alignItems="center">
          <Signature address={account.address} size={32} />
          <Column flex={1} minWidth={0} alignItems="flex-start">
            <Row gap="$2" alignItems="center">
              <Body fontWeight="600" numberOfLines={1} flexShrink={1}>
                {account.label}
              </Body>
              {active ? (
                <Row gap={4} alignItems="center">
                  <Dot color={paint.arc} size={6} />
                  <Body tone="arc" size="caption">
                    {t({ id: 'acct.active', message: 'Active' })}
                  </Body>
                </Row>
              ) : null}
              {account.hidden ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'acct.hidden', message: 'hidden' })}
                </Body>
              ) : null}
            </Row>
            <Row gap={2} alignItems="center">
              <Body
                tone={copied ? 'arc' : 'mute'}
                size="caption"
                fontVariant={['tabular-nums']}
                numberOfLines={1}
              >
                {copied
                  ? t({ id: 'copied', message: 'Copied' })
                  : (name ?? shortAddress(account.address))}
              </Body>
              {onCopy ? (
                <Pressable
                  onPress={onCopy}
                  accessibilityRole="button"
                  accessibilityLabel={t({ id: 'acct.copy', message: 'Copy address' })}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    marginVertical: -12,
                    justifyContent: 'center',
                    alignItems: 'flex-start',
                    paddingLeft: 4,
                  }}
                  testID={`copy-${account.id}`}
                >
                  <Icon
                    name={copied ? 'check' : 'copy'}
                    size={12}
                    color={copied ? paint.arc : paint.mute}
                  />
                </Pressable>
              ) : null}
            </Row>
          </Column>
          {total ? (
            <Body size="caption" fontVariant={['tabular-nums']} flexShrink={0}>
              {total}
            </Body>
          ) : null}
        </Row>
      </Pressable>
      <IconButton
        icon="more"
        label={t({ id: 'acct.menu', message: 'Account options' })}
        onPress={onMenu}
        testID={`menu-${account.id}`}
      />
    </Row>
  )
}
