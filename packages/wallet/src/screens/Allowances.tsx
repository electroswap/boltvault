/**
 * Approvals (master plan §8.13): every allowance the account has granted,
 * grouped by token; unlimited ones are the fat fuse. Revoke runs through the
 * same sheet as everything else (`internal:approvals`).
 */
import {
  Body,
  Chip,
  Column,
  Icon,
  Key,
  Plate,
  Pressable,
  Row,
  ScrollView,
  Sheet,
  metrics,
  paint,
  shortAddress,
} from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import { ScreenFooter } from '../components/ScreenFooter'
import type { AllowanceView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'
import { formatAmount } from '../format'

const ETN = 52014

/** One allowance, identified the way the chain identifies it. */
function keyOf(r: AllowanceView): string {
  return `${r.chainId}:${r.token.toLowerCase()}:${r.spender.toLowerCase()}:${r.standard}`
}

export function Allowances({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const [rows, setRows] = useState<AllowanceView[]>([])
  const [at, setAt] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
    Revoking is one transaction per spender — there is no batch call to make,
    and inventing one would mean rewriting calldata (§3.4). So the many-row
    case is a queue, and the queue is shown as a queue: how many sheets are
    coming, and which one is in front of you. Firing N focused prompts with
    no warning is how a user ends up rejecting their own revokes.
  */
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [confirm, setConfirm] = useState(false)
  const [queueing, setQueueing] = useState<{ done: number; total: number } | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  const scan = (): void => {
    if (!active) return
    setScanning(true)
    setError(null)
    // Electroneum first, then every enabled chain (§8.13); rows carry their chain.
    engine.settings
      .get()
      .then(async (s) => {
        const all: AllowanceView[] = []
        for (const chainId of [ETN, ...s.enabledChains]) {
          const r = await engine.allowances
            .scan({ accountId: active.id, chainId })
            .catch(() => [] as AllowanceView[])
          all.push(...r)
        }
        setRows(all)
        setAt(Date.now())
        setScanning(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setScanning(false)
      })
  }

  useEffect(() => {
    if (!active) return
    let alive = true
    engine.allowances.cached({ accountId: active.id, chainId: ETN }).then(
      (c) => {
        if (!alive) return
        setRows(c.rows)
        setAt(c.at)
        if (Date.now() - c.at > 60_000) scan()
      },
      () => undefined,
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'allowances.changed' && e.accountId === active.id) {
        setRows(e.rows)
        setAt(Date.now())
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, active?.id])

  const unlimited = rows.filter((r) => r.amount === 'unlimited' || r.amount === 'all')
  const byToken = new Map<string, AllowanceView[]>()
  for (const r of rows)
    byToken.set(r.token.toLowerCase(), [...(byToken.get(r.token.toLowerCase()) ?? []), r])

  const revoke = (r: AllowanceView): void => {
    if (!active) return
    engine.allowances
      .revoke({
        accountId: active.id,
        chainId: r.chainId,
        token: r.token,
        spender: r.spender,
        standard: r.standard,
      })
      .then(
        (res) => router.navigate('sign', { requestId: res.requestId }),
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      )
  }

  const chosen = rows.filter((r) => picked.includes(keyOf(r)))
  const toggle = (r: AllowanceView): void => {
    const k = keyOf(r)
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  }
  const leaveSelection = (): void => {
    setSelecting(false)
    setPicked([])
  }

  /*
    Queued in order, then the first sheet is opened. Each request lands in the
    same approval queue the rest of the product uses, so the sheet's "{n} more
    waiting" is an honest count of what is left — and a rejection stops nothing
    that follows, which is why the count is stated before the first prompt
    rather than discovered at the third.
  */
  const revokeChosen = async (): Promise<void> => {
    if (!active || chosen.length === 0) return
    setConfirm(false)
    setError(null)
    setQueueing({ done: 0, total: chosen.length })
    let first: string | null = null
    for (const r of chosen) {
      try {
        const res = await engine.allowances.revoke({
          accountId: active.id,
          chainId: r.chainId,
          token: r.token,
          spender: r.spender,
          standard: r.standard,
        })
        first ??= res.requestId
      } catch (err) {
        // One spender that cannot be revoked must not swallow the rest.
        setError(err instanceof Error ? err.message : String(err))
      }
      setQueueing((q) => (q ? { ...q, done: q.done + 1 } : q))
    }
    setQueueing(null)
    leaveSelection()
    if (first !== null) router.navigate('sign', { requestId: first })
  }

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="allowances">
        <PageHeader title={t({ id: 'allow.title', message: 'Approvals' })} />
        <Plate role="raised" gap="$1" testID="allow-summary">
          <Body size="title" tone={unlimited.length ? 'burn' : 'ink'}>
            {unlimited.length
              ? t({
                  id: 'allow.summary.unlimited',
                  message: '{n} unlimited',
                  values: { n: unlimited.length },
                })
              : t({ id: 'allow.summary.none', message: 'No unlimited approvals' })}
          </Body>
          <Body tone="mute" size="caption">
            {rows.length
              ? t({
                  id: 'allow.summary.body',
                  message: '{n} contracts can move tokens from this account.',
                  values: { n: rows.length },
                })
              : t({
                  id: 'allow.summary.empty',
                  message: 'Nothing can move your tokens without a signature.',
                })}
          </Body>
          <Row gap="$2" alignItems="center" flexWrap="wrap">
            <Key
              label={
                scanning
                  ? t({ id: 'allow.scanning', message: 'Checking…' })
                  : t({ id: 'allow.rescan', message: 'Check again' })
              }
              kind="secondary"
              size="compact"
              disabled={scanning}
              onPress={scan}
              testID="allow-scan"
            />
            {rows.length > 1 ? (
              <Key
                label={
                  selecting
                    ? t({ id: 'cancel', message: 'Cancel' })
                    : t({ id: 'allow.select', message: 'Select several' })
                }
                kind="secondary"
                size="compact"
                disabled={queueing !== null}
                onPress={() => (selecting ? leaveSelection() : setSelecting(true))}
                testID="allow-select"
              />
            ) : null}
            {at ? (
              <Body tone="mute" size="caption">
                {new Date(at).toLocaleTimeString()}
              </Body>
            ) : null}
          </Row>
        </Plate>
        {[...byToken.entries()].map(([token, list]) => (
          <Plate key={token} gap="$2" testID={`allow-token-${token}`}>
            <Body size="title">{list[0]?.tokenSymbol ?? shortAddress(token)}</Body>
            {list.map((r) => {
              const chosenHere = picked.includes(keyOf(r))
              const row = (
                <Row justifyContent="space-between" alignItems="center" gap="$2">
                  {selecting ? (
                    <Column
                      width={22}
                      height={22}
                      borderRadius={6}
                      borderWidth={1}
                      borderColor={chosenHere ? paint.arc : paint.mute}
                      alignItems="center"
                      justifyContent="center"
                      testID={`allow-check-${r.spender}`}
                    >
                      {chosenHere ? <Icon name="check" size={14} color={paint.arc} /> : null}
                    </Column>
                  ) : null}
                  <Column flex={1}>
                    <Row gap="$2" alignItems="center">
                      <Body numberOfLines={1}>{r.spenderName ?? shortAddress(r.spender)}</Body>
                      {!r.known ? (
                        <Chip borderColor={paint.ember}>
                          <Body tone="ember" size="caption">
                            {t({ id: 'allow.unknown', message: 'Unknown' })}
                          </Body>
                        </Chip>
                      ) : null}
                    </Row>
                    <Body tone="mute" size="caption">
                      {r.standard === 'permit2'
                        ? 'Permit2'
                        : r.standard === 'erc721'
                          ? t({ id: 'allow.operator', message: 'Collection operator' })
                          : t({ id: 'allow.erc20', message: 'Token allowance' })}
                      {r.expiration
                        ? ` · ${t({ id: 'allow.until', message: 'until {d}', values: { d: new Date(r.expiration * 1000).toLocaleDateString() } })}`
                        : ''}
                    </Body>
                  </Column>
                  <Body
                    tone={r.amount === 'unlimited' || r.amount === 'all' ? 'burn' : 'ink'}
                    size="caption"
                    testID={`allow-amount-${r.spender}`}
                  >
                    {/* `amount` is a raw uint256. Scale it, or say plainly that we cannot. */}
                    {r.amount === 'unlimited'
                      ? t({ id: 'allow.unlimited', message: 'Unlimited' })
                      : r.amount === 'all'
                        ? t({ id: 'allow.all', message: 'Every item' })
                        : r.decimals === null
                          ? t({
                              id: 'allow.raw',
                              message: '{n} base units',
                              values: { n: r.amount },
                            })
                          : formatAmount(r.amount, r.decimals)}
                  </Body>
                  {/* In selection mode the whole row is the control; a second one inside it would be two answers to one tap. */}
                  {selecting ? null : (
                    <Key
                      label={t({ id: 'allow.revoke', message: 'Revoke' })}
                      kind="danger"
                      size="compact"
                      onPress={() => revoke(r)}
                      testID={`allow-revoke-${r.spender}`}
                    />
                  )}
                </Row>
              )
              return (
                <Column key={`${r.spender}:${r.standard}`} gap={4}>
                  {selecting ? (
                    <Pressable
                      onPress={() => toggle(r)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: chosenHere }}
                      accessibilityLabel={r.spenderName ?? shortAddress(r.spender)}
                      style={{ minHeight: 44, justifyContent: 'center' }}
                      testID={`allow-row-${r.spender}`}
                    >
                      {row}
                    </Pressable>
                  ) : (
                    row
                  )}
                </Column>
              )
            })}
          </Plate>
        ))}
        {error ? <Body tone="burn">{error}</Body> : null}
      </ScrollView>

      {selecting ? (
        <ScreenFooter inset={inset} testID="allow-footer">
          <Body tone="mute" size="caption" fontSize={11} lineHeight={14}>
            {queueing
              ? t({
                  id: 'allow.bulk.queueing',
                  message: 'Queuing {d} of {n}…',
                  values: { d: queueing.done, n: queueing.total },
                })
              : t({
                  id: 'allow.bulk.note',
                  message:
                    'Each approval is revoked by its own transaction, so you will sign one sheet per row, in this order.',
                })}
          </Body>
          <Key
            label={
              chosen.length
                ? t({ id: 'allow.bulk.key', message: 'Revoke {n}', values: { n: chosen.length } })
                : t({ id: 'allow.bulk.none', message: 'Pick the ones to revoke' })
            }
            kind="danger"
            disabled={chosen.length === 0 || queueing !== null}
            onPress={() => setConfirm(true)}
            testID="allow-revoke-selected"
          />
        </ScreenFooter>
      ) : null}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t({
          id: 'allow.bulk.title',
          message: 'Revoke {n} approvals',
          values: { n: chosen.length },
        })}
        footer={
          <Column gap="$2">
            <Key
              label={t({ id: 'allow.bulk.start', message: 'Start signing' })}
              kind="danger"
              onPress={() => void revokeChosen()}
              testID="allow-bulk-start"
            />
            <Key
              label={t({ id: 'cancel', message: 'Cancel' })}
              kind="secondary"
              size="compact"
              onPress={() => setConfirm(false)}
              testID="allow-bulk-cancel"
            />
          </Column>
        }
        testID="allow-bulk-sheet"
      >
        <Column gap="$3">
          <Body>
            {t({
              id: 'allow.bulk.body',
              message:
                'There is no single transaction that revokes several spenders, so this queues {n} of them. You will see a signing sheet for each one in turn, and each costs its own network fee.',
              values: { n: chosen.length },
            })}
          </Body>
          <Column gap={2}>
            {chosen.map((r, i) => (
              <Body key={keyOf(r)} tone="mute" size="caption" numberOfLines={1}>
                {t({
                  id: 'allow.bulk.row',
                  message: '{i}. {spender} · {token}',
                  values: {
                    i: i + 1,
                    spender: r.spenderName ?? shortAddress(r.spender),
                    token: r.tokenSymbol ?? shortAddress(r.token),
                  },
                })}
              </Body>
            ))}
          </Column>
          <Body tone="mute" size="caption">
            {t({
              id: 'allow.bulk.reject',
              message: 'Rejecting one leaves that approval as it was; the rest stay in the queue.',
            })}
          </Body>
        </Column>
      </Sheet>
    </Column>
  )
}
