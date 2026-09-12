/**
 * Electric Legends dividends (master plan §8.10, §7.12; plan C3, owner item
 * N7): the vessel the claimable ETN rises in, what there is to claim as a
 * readout, how much of your collection is earning as a bar of the current,
 * the lifetime paid and your share as a stat strip, your pieces as
 * medallions, and the two keys — Activate once, then Claim. Copy is
 * "marketplace fees shared with holders", never yield.
 *
 * The vessel and the compact card are the same thing, not two designs.
 * §7.12 names the vessel as a signature moment — "claimable ETN rises as
 * liquid light in a glass vessel between claims; Claim drains it into the
 * readout" — and the owner asked for dividends to take less room, so the
 * vessel is the one element that appears in *both* forms and the only one
 * that survives the collapse. It costs no height in either: expanded it
 * stands beside the readout and the earning bar, which are already taller
 * than it; collapsed it is a slim tube shorter than the Claim key next to
 * it. What the collapse removes is text, which is what was taking the room.
 */
import {
  Body,
  Column,
  CurrentFill,
  Key,
  Plate,
  Pressable,
  Readout,
  Row,
  ScrollView,
  Signature,
  StatStrip,
  Vessel,
} from '@boltvault/ui'
import type { LegendsStatus } from '@boltvault/engine'
import { formatRaw } from '../format'
import { t } from '../i18n'

export interface DividendsCardProps {
  readonly status: LegendsStatus
  readonly compact?: boolean
  /**
   * The one-line form: what there is to claim, Claim, and a way to see the rest.
   *
   * The Collection page opened with the whole card — bar, three stats and a
   * scroller of medallions — above the pieces the page is actually about. Owner:
   * "dividends should be collapsed by default, it's taking up too much space."
   * Everything is still here; it just waits to be asked for.
   */
  readonly collapsed?: boolean
  /** Shown beside Claim while collapsed. Absent means there is nothing to expand into. */
  readonly onDetails?: () => void
  readonly busy?: boolean
  readonly onActivate?: () => void
  readonly onClaim?: () => void
  readonly onOpen?: () => void
  readonly onPiece?: (tokenId: string) => void
  /** Passed to the vessel: reduced motion means the level is set, never poured. */
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function DividendsCard({
  status,
  compact = false,
  collapsed = false,
  busy = false,
  onActivate,
  onClaim,
  onDetails,
  onOpen,
  onPiece,
  reducedMotion,
  testID = 'dividends',
}: DividendsCardProps) {
  const claimable = BigInt(status.claimableWei)
  const owned = status.ownedTokenIds.length
  const earning = status.registeredTokenIds.length
  const canClaim = claimable > 0n && earning > 0
  const needsActivation = status.unregisteredTokenIds.length > 0
  const share = owned > 0 ? earning / owned : 0
  const medallions = status.ownedTokenIds.slice(0, compact ? 6 : 24)
  const more = owned - medallions.length
  /*
    Collapsed is one row, not a small version of the card.

    The first attempt kept the card's shape and hid its middle — title, hero
    readout, an ember sentence and two keys, about 180 px of a 600 px popup to
    say "you have 3.21 ETN". Owner: "dividends needs to be even more compact."

    So it drops to a line. The title goes because the only screen that collapses
    this is the collection's own page, which already names the collection in its
    header and carries a "Pays dividends" pill; the piece count goes because it
    is in that header too; the earning bar and its sentence become the number of
    pieces still to activate, which is the only part of them that asks anything
    of the reader. Everything removed is one press away on Details.
  */
  if (collapsed) {
    return (
      <Plate role="raised" gap={4} paddingVertical={10} testID={testID}>
        <Row gap="$2" alignItems="center">
          {/*
            Slimmer than the Claim key beside it, so the row is no taller than
            it was — but it is still the vessel, and it still says at a glance
            whether fees have been arriving since the last claim.
          */}
          <Vessel
            level={status.vesselLevel}
            width={13}
            height={40}
            {...(reducedMotion === undefined ? {} : { reducedMotion })}
            accessibilityLabel={t({
              id: 'legends.vessel.a11y',
              message: '{a} ETN to claim',
              values: { a: formatRaw(status.claimableWei, 18) },
            })}
            testID={`${testID}-vessel`}
          />
          <Column flex={1} minWidth={0} alignItems="flex-start">
            <Row gap={6} alignItems="baseline">
              <Readout testID={`${testID}-claimable`}>{formatRaw(status.claimableWei, 18)}</Readout>
              <Body tone="mute" size="caption" numberOfLines={1}>
                {t({ id: 'legends.toclaim', message: 'ETN to claim' })}
              </Body>
            </Row>
            {needsActivation ? (
              <Body
                tone="ember"
                size="caption"
                fontSize={11}
                lineHeight={13}
                numberOfLines={1}
                testID={`${testID}-needsactivation`}
              >
                {status.unregisteredTokenIds.length === 1
                  ? t({ id: 'legends.activate.one', message: '1 piece to activate' })
                  : t({
                      id: 'legends.activate.many',
                      message: '{n} pieces to activate',
                      values: { n: status.unregisteredTokenIds.length },
                    })}
              </Body>
            ) : null}
          </Column>
          {/* Sized to their labels rather than flexed: the amount deserves the slack. */}
          {onClaim ? (
            <Key
              label={t({ id: 'legends.claim', message: 'Claim' })}
              size="compact"
              disabled={busy || !canClaim}
              onPress={onClaim}
              testID={`${testID}-claim`}
            />
          ) : null}
          {onDetails ? (
            <Key
              label={t({ id: 'legends.details', message: 'Details' })}
              kind="secondary"
              size="compact"
              onPress={onDetails}
              testID={`${testID}-details`}
            />
          ) : null}
        </Row>
      </Plate>
    )
  }

  return (
    <Plate
      role="raised"
      gap="$3"
      testID={testID}
      {...(onOpen ? { onPress: onOpen, cursor: 'pointer' as const } : {})}
    >
      <Row justifyContent="space-between" alignItems="center">
        <Body fontWeight="600">
          {t({ id: 'legends.title', message: 'Electric Legends dividends' })}
        </Body>
        <Body tone="mute" size="caption">
          {owned === 1
            ? t({ id: 'legends.count.one', message: '1 piece' })
            : t({ id: 'legends.count.many', message: '{n} pieces', values: { n: owned } })}
        </Body>
      </Row>
      {/*
        The vessel is as tall as the readout and the earning bar together, so it
        reads as the container those two numbers describe rather than as a
        decoration beside them — and the card is no taller for it.
      */}
      <Row alignItems="center" gap="$3">
        <Vessel
          level={status.vesselLevel}
          width={compact ? 22 : 26}
          height={compact ? 64 : 78}
          {...(reducedMotion === undefined ? {} : { reducedMotion })}
          accessibilityLabel={t({
            id: 'legends.vessel.a11y',
            message: '{a} ETN to claim',
            values: { a: formatRaw(status.claimableWei, 18) },
          })}
          testID={`${testID}-vessel`}
        />
        <Column flex={1} minWidth={0} gap={10}>
          <Row alignItems="flex-end" gap="$2">
            <Readout hero={!compact} testID={`${testID}-claimable`}>
              {formatRaw(status.claimableWei, 18)}
            </Readout>
            <Body tone="mute" size="caption" marginBottom={compact ? 2 : 6}>
              {t({ id: 'legends.toclaim', message: 'ETN to claim' })}
            </Body>
          </Row>
          {/* The earning bar: how much of your collection shares in every fee. */}
          <Column gap={4} testID={`${testID}-earning`}>
            <Column
              height={6}
              borderRadius={3}
              backgroundColor="rgba(122, 140, 255, 0.16)"
              overflow="hidden"
            >
              <Column
                width={`${Math.round(share * 100)}%`}
                height={6}
                overflow="hidden"
                position="relative"
              >
                <CurrentFill />
              </Column>
            </Column>
            <Body tone={needsActivation ? 'ember' : 'mute'} size="caption">
              {owned === 0
                ? t({
                    id: 'legends.earning.none',
                    message: 'Hold a Legend and it shares a third of every marketplace fee.',
                  })
                : earning === owned
                  ? t({ id: 'legends.earning.all', message: 'Every piece is earning.' })
                  : t({
                      id: 'legends.earning.some',
                      message:
                        '{e} of {n} pieces earning — activate the rest once and they share every fee from then on.',
                      values: { e: earning, n: owned },
                    })}
            </Body>
          </Column>
        </Column>
      </Row>
      {!compact ? (
        <StatStrip
          bare
          small
          cells={[
            {
              label: t({ id: 'legends.stat.lifetime', message: 'Lifetime paid' }),
              value: `${formatRaw(status.lifetimePaidWei, 18)} ETN`,
              caption: t({ id: 'legends.stat.lifetime.caption', message: 'to all holders' }),
            },
            {
              label: t({ id: 'legends.stat.share', message: 'Your share' }),
              value:
                status.activeTokenCount > 0 ? `${(status.shareOfNextFee * 100).toFixed(3)}%` : '—',
              caption: t({ id: 'legends.stat.share.caption', message: 'of each fee' }),
            },
            {
              label: t({ id: 'legends.stat.active', message: 'Earning' }),
              value: String(status.activeTokenCount),
              caption: t({ id: 'legends.stat.active.caption', message: 'Legends in all' }),
            },
          ]}
          testID={`${testID}-stats`}
        />
      ) : null}
      {!compact && medallions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          testID={`${testID}-medallions`}
        >
          {medallions.map((id) => (
            <Pressable
              key={id}
              onPress={onPiece ? () => onPiece(id) : undefined}
              accessibilityRole="button"
              accessibilityLabel={`#${id}`}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Column alignItems="center" gap={2}>
                <Signature address={`0x${id.padStart(40, '0')}`} size={30} />
                <Body tone={status.registeredTokenIds.includes(id) ? 'arc' : 'mute'} size="caption">
                  #{id}
                </Body>
              </Column>
            </Pressable>
          ))}
          {more > 0 ? (
            <Column minWidth={44} minHeight={44} alignItems="center" justifyContent="center">
              <Body tone="mute" size="caption">
                +{more}
              </Body>
            </Column>
          ) : null}
        </ScrollView>
      ) : null}
      {onClaim || onDetails || (needsActivation && onActivate) ? (
        <Row gap="$2">
          {onClaim ? (
            <Column flex={1}>
              <Key
                label={t({ id: 'legends.claim', message: 'Claim' })}
                size="compact"
                disabled={busy || !canClaim}
                onPress={onClaim}
                testID={`${testID}-claim`}
              />
            </Column>
          ) : null}
          {onDetails ? (
            <Column flex={1}>
              <Key
                label={t({ id: 'legends.hide', message: 'Hide details' })}
                kind="secondary"
                size="compact"
                onPress={onDetails}
                testID={`${testID}-details`}
              />
            </Column>
          ) : null}
          {/* Activation is a decision, not a glance: it belongs with the pieces it is about. */}
          {needsActivation && onActivate ? (
            <Column flex={1}>
              <Key
                label={t({ id: 'legends.activate', message: 'Activate dividends' })}
                kind="secondary"
                size="compact"
                disabled={busy}
                onPress={onActivate}
                testID={`${testID}-activate`}
              />
            </Column>
          ) : null}
        </Row>
      ) : null}
    </Plate>
  )
}
