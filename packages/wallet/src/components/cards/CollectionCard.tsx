/**
 * A collection in a list (plan C3): the artwork, the name with its verified
 * check and marks, one line of numbers, and the alert star. A card, never a
 * glowing plate, so a list of them stays a list.
 */
import { Artwork, Body, Column, IconButton, Plate, Row } from '@boltvault/ui'
import type { CollectionView } from '@boltvault/engine'
import { formatRaw } from '../../format'
import { t } from '../../i18n'

export function CollectionCard({
  collection,
  onPress,
  onStar,
}: {
  collection: CollectionView
  onPress: () => void
  onStar?: () => void
}) {
  const line = [
    collection.paysDividends ? t({ id: 'explore.dividends.short', message: 'Dividends' }) : null,
    collection.custom ? t({ id: 'collection.custom', message: 'Custom' }) : null,
    collection.floorEtn !== null
      ? t({
          id: 'explore.floor',
          message: 'Floor {f} ETN',
          values: { f: formatRaw(String(Math.round(collection.floorEtn * 1e6)), 6) },
        })
      : null,
    collection.volume24hEtn !== null
      ? t({
          id: 'explore.vol24',
          message: '{v} ETN today',
          values: { v: Math.round(collection.volume24hEtn) },
        })
      : null,
    collection.percentListed !== null
      ? t({
          id: 'explore.listed',
          message: '{p}% listed',
          values: { p: Math.round(collection.percentListed) },
        })
      : null,
    collection.owned > 0
      ? t({ id: 'explore.own', message: 'you own {n}', values: { n: collection.owned } })
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Plate
      role="card"
      gap="$2"
      onPress={onPress}
      cursor="pointer"
      testID={`explore-collection-${collection.address}`}
    >
      <Row gap="$3" alignItems="center">
        <Artwork uri={collection.imageUrl} label={collection.name} size={44} />
        <Column flex={1} minWidth={0} alignItems="stretch">
          <Row gap="$2" alignItems="center" alignSelf="stretch">
            <Body fontWeight="600" numberOfLines={1} flexShrink={1} minWidth={0}>
              {collection.name}
            </Body>
            {collection.verified ? (
              <Body tone="arc" size="caption">
                ✓
              </Body>
            ) : null}
          </Row>
          <Body tone={collection.paysDividends ? 'ember' : 'mute'} size="caption" numberOfLines={1}>
            {line}
          </Body>
        </Column>
        {onStar && !collection.custom ? (
          <IconButton
            icon="star"
            label={
              collection.starred
                ? t({ id: 'watch.unstar', message: 'Stop alerts' })
                : t({ id: 'watch.alerts.on', message: 'Alert me' })
            }
            active={collection.starred}
            onPress={onStar}
            testID={`star-collection-${collection.address}`}
          />
        ) : null}
      </Row>
    </Plate>
  )
}
