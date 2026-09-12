/**
 * Moments — the harness for the six signature moments (master plan §7.12):
 * Ignition, Discharge, the engraved QR, the Rack, the Coil and the Legends
 * vault. Not reachable from the product UI — no route leads here; the
 * screenshot harness (`harness.html?screen=moments`) and the clip recorder
 * (`apps/extension/e2e/clips.spec.ts`) open it directly.
 *
 * Only the first three used to be here. The other three had their production
 * screens and a pixel baseline, which is close to having no review at all: a
 * still frame cannot show a moment whose whole acceptance criterion is how it
 * moves, and a production screen cannot be *made* to move on demand. So every
 * moment now has a stage with one key per beat, and every stage states its own
 * acceptance criterion beside it, verbatim from §7.12 — a reviewer checks the
 * clip against the sentence instead of remembering it.
 *
 * Where the real component can be driven it is the real component: the Rack
 * stage mounts `Rack` itself and the Legends stage mounts `DividendsCard` over
 * the engine's own `LegendsStatus`. Only the beats — a purchase, a fee
 * arriving, a claim — are staged, because the fixture engine has no chain to
 * produce them.
 */
import {
  Body,
  Coil,
  Column,
  CurrentFill,
  Discharge,
  Field,
  Icon,
  Ignition,
  Key,
  LiveFilament,
  Pill,
  Plate,
  QR,
  RollingReadout,
  Row,
  ScrollView,
  Signature,
  metrics,
  motion,
  paint,
  useWindowDimensions,
} from '@boltvault/ui'
import type { LegendsStatus } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { DividendsCard } from '../components/DividendsCard'
import { useEngine } from '../engine/EngineProvider'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'
import { Rack } from './Rack'

const ADDRESS = '0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63'
const ETN = 52014

export type MomentId = 'ignition' | 'discharge' | 'qr' | 'rack' | 'coil' | 'legends'
type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

/** The six, in the plan's order. M1 reviews the first three, M6 the rest. */
export const MOMENT_IDS: readonly MomentId[] = [
  'ignition',
  'discharge',
  'qr',
  'rack',
  'coil',
  'legends',
]

/**
 * The name on the pill and the acceptance criterion, quoted from §7.12 with
 * nothing added. Quoted, because a criterion a reviewer has to reconstruct
 * from memory is a criterion nobody applies — and because when the plan's
 * wording changes, the harness should be wrong in an obvious place.
 */
function copy(id: MomentId): { name: string; criterion: string } {
  switch (id) {
    case 'ignition':
      return {
        name: t({ id: 'moments.name.ignition', message: 'Ignition' }),
        criterion: t({
          id: 'moments.criterion.ignition',
          message:
            'Unlock: the Field fades in from black around the seat avatar, the filament draws left→right, the readout digits settle from blurred to sharp; 400 ms total; must feel like a device powering on, not a page loading.',
        }),
      }
    case 'discharge':
      return {
        name: t({ id: 'moments.name.discharge', message: 'Discharge' }),
        criterion: t({
          id: 'moments.criterion.discharge',
          message:
            "Swap: on sign, an arc leaves the Swap key, crosses the Field, and lands as the new row in the Activity tab (the tab icon flickers once); ≤ 600 ms; the user's eye is led to where the result lives.",
        }),
      }
    case 'qr':
      return {
        name: t({ id: 'moments.name.qr', message: 'The engraved QR' }),
        criterion: t({
          id: 'moments.criterion.qr',
          message:
            'Receive on mobile: the QR reads as etched into glass with gyroscope parallax on the light across it (Reanimated + device motion), static on web; it must scan first time at 30 cm.',
        }),
      }
    case 'rack':
      return {
        name: t({ id: 'moments.name.rack', message: 'The Rack' }),
        criterion: t({
          id: 'moments.criterion.rack',
          message:
            'Collectibles: pieces sit on glass shelves with depth, contact shadows and a specular edge from the Field; opening a piece is a shared-element move into a view where the artwork is lit by a single slow light sweep; buying a piece lands it on your shelf with a Discharge. Acceptance: a first-time viewer can tell which pieces are listed and which have offers without reading text.',
        }),
      }
    case 'coil':
      return {
        name: t({ id: 'moments.name.coil', message: 'The Coil' }),
        criterion: t({
          id: 'moments.criterion.coil',
          message:
            'Farms: the ring hums brighter as DYNO accrues, dates are engraved on the ring, and Collect discharges the coil into the readout while the DYNO bar rolls. Acceptance: the multiplier and the date to 2.5× are readable at a glance; nothing twitches per block except the pending-reward digits.',
        }),
      }
    case 'legends':
      return {
        name: t({ id: 'moments.name.legends', message: 'The Legends vault' }),
        criterion: t({
          id: 'moments.criterion.legends',
          message:
            'Electric Legends dividends: claimable ETN rises as liquid light in a glass vessel between claims; Claim drains it into the readout. Acceptance: a holder understands "marketplace fees are paying me" from the plate alone; the vessel never animates when nothing has changed.',
        }),
      }
  }
}

export function Moments({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const { width, height } = useWindowDimensions()
  const [moment, setMoment] = useState<MomentId>('ignition')
  const [fire, setFire] = useState(0)
  const { name, criterion } = copy(moment)
  /*
    The harness screen is mounted without a body (TabShell passes none), so it
    reads the one thing it can see. The three widths are the three the
    screenshot harness and the clip recorder use.
  */
  const body: BodyKind =
    width >= 900 ? 'extension-tab' : width >= 420 ? 'mobile' : 'extension-popup'
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const onFire = (): void => setFire((n) => n + 1)

  return (
    <Column flex={1} backgroundColor="$void" testID="moments">
      <Field
        address={ADDRESS}
        pulse={1}
        width={width}
        height={height}
        reducedMotion={reducedMotion}
      />
      <Discharge
        fire={fire}
        width={width}
        height={height}
        reducedMotion={reducedMotion}
        testID="discharge"
      />
      <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="moments-scroll">
        <Body size="title">{t({ id: 'moments.title', message: 'Signature moments' })}</Body>
        <Row gap="$2" flexWrap="wrap" testID="moment-picker">
          {MOMENT_IDS.map((id) => (
            <Pill
              key={id}
              label={copy(id).name}
              selected={id === moment}
              size="sm"
              onPress={() => setMoment(id)}
              testID={`moment-pick-${id}`}
            />
          ))}
        </Row>
        <Plate role="recessed" gap={4} testID="moment-criterion">
          <Row justifyContent="space-between" alignItems="center" gap="$2">
            <Body fontWeight="600">{name}</Body>
            <Body tone="arc" size="caption">
              {t({ id: 'moments.acceptance', message: 'Acceptance' })}
            </Body>
          </Row>
          <Body tone="mute" size="caption" testID="moment-criterion-text">
            {criterion}
          </Body>
        </Plate>
        {moment === 'ignition' ? <IgnitionStage reducedMotion={reducedMotion} /> : null}
        {moment === 'discharge' ? (
          <DischargeStage reducedMotion={reducedMotion} onFire={onFire} />
        ) : null}
        {moment === 'qr' ? <QrStage /> : null}
        {moment === 'rack' ? (
          <RackStage body={body} reducedMotion={reducedMotion} onFire={onFire} />
        ) : null}
        {moment === 'coil' ? <CoilStage reducedMotion={reducedMotion} onFire={onFire} /> : null}
        {moment === 'legends' ? (
          <LegendsStage reducedMotion={reducedMotion} onFire={onFire} />
        ) : null}
      </ScrollView>
    </Column>
  )
}

/* ---------------------------------------------------------------- Ignition */

function IgnitionStage({ reducedMotion }: { reducedMotion: boolean }) {
  const [take, setTake] = useState(0)
  const [block, setBlock] = useState(15_100_000)
  useEffect(() => {
    // The filament's travel is per block; reduced motion holds it still, so
    // there is nothing for a tick to drive.
    if (reducedMotion) return
    const h = setInterval(() => setBlock((b) => b + 1), 5000)
    return () => clearInterval(h)
  }, [reducedMotion])
  return (
    <Column gap="$4">
      {/*
        `take` remounts the whole ceremony. An enter animation can only be
        reviewed by being entered again, and a page reload would restart the
        harness rather than the moment.
      */}
      <Column key={take} gap="$4" testID="moment-ignition">
        <Ignition reducedMotion={reducedMotion} order={0}>
          <Row gap="$3" alignItems="center">
            <Signature address={ADDRESS} size={44} />
            <Column alignItems="flex-start">
              <Body>{t({ id: 'moments.ignition.seat', message: 'volt.etn' })}</Body>
              <Body tone="mute" size="caption">
                {t({
                  id: 'moments.ignition.seat.caption',
                  message: 'The Field comes up around the seat',
                })}
              </Body>
            </Column>
          </Row>
        </Ignition>
        <Ignition reducedMotion={reducedMotion} order={2}>
          <Column gap="$2">
            <RollingReadout
              value="$12,478.00"
              hero
              reducedMotion={reducedMotion}
              testID="moments-readout"
            />
            <LiveFilament
              tick={block}
              live
              reducedMotion={reducedMotion}
              testID="moments-filament"
            />
          </Column>
        </Ignition>
        <Ignition reducedMotion={reducedMotion} order={3}>
          <Plate role="raised" gap="$2">
            <Body tone="mute" size="caption">
              {t({
                id: 'moments.ignition.plate',
                message: 'The plates arrive last, 400 ms after the first light.',
              })}
            </Body>
          </Plate>
        </Ignition>
      </Column>
      <Row gap="$2">
        <Key
          label={t({ id: 'moments.ignition.replay', message: 'Replay ignition' })}
          onPress={() => setTake((n) => n + 1)}
          testID="moment-ignition-replay"
        />
      </Row>
    </Column>
  )
}

/* --------------------------------------------------------------- Discharge */

function DischargeStage({ reducedMotion, onFire }: { reducedMotion: boolean; onFire: () => void }) {
  const [signed, setSigned] = useState(0)
  const [landed, setLanded] = useState(0)
  const [lit, setLit] = useState(false)
  const [value, setValue] = useState('12,478.00')
  useEffect(() => {
    if (signed === 0) return
    /*
      The row appears when the arc lands, not when the key is pressed. That
      ordering is the moment: the eye follows the arc to the Activity tab and
      the result is already there when it arrives.
    */
    const arrive = reducedMotion ? 0 : motion.discharge
    const land = setTimeout(() => {
      setLanded((n) => n + 1)
      setLit(true)
      setValue((v) => (v === '12,478.00' ? '12,491.36' : '12,478.00'))
    }, arrive)
    const dim = setTimeout(() => setLit(false), arrive + (reducedMotion ? 0 : 220))
    return () => {
      clearTimeout(land)
      clearTimeout(dim)
    }
  }, [signed, reducedMotion])
  const rows = Math.min(landed, 3)
  return (
    <Column gap="$4" testID="moment-discharge">
      <Column gap="$2">
        <Body tone="mute" size="caption">
          {t({ id: 'moments.discharge.total', message: 'Total' })}
        </Body>
        <RollingReadout
          value={`$${value}`}
          hero
          reducedMotion={reducedMotion}
          testID="moments-readout"
        />
      </Column>
      <Plate role="raised" gap="$2" testID="moment-activity">
        <Row gap="$2" alignItems="center">
          {/* The tab icon flickers once as the arc lands — the only thing that marks where the result went. */}
          <Icon name="activity" size={16} color={lit ? paint.arc : paint.mute} />
          <Body fontWeight="600" tone={lit ? 'arc' : 'ink'}>
            {t({ id: 'moments.discharge.activity', message: 'Activity' })}
          </Body>
        </Row>
        {Array.from({ length: rows }, (_, i) => (
          <Row key={i} justifyContent="space-between" gap="$2" testID={`moment-activity-row-${i}`}>
            <Body size="caption">
              {t({ id: 'moments.discharge.row', message: 'Swapped 4,200 BOLT → 2.31 USDC' })}
            </Body>
            <Body tone="mute" size="caption">
              {t({ id: 'moments.discharge.now', message: 'just now' })}
            </Body>
          </Row>
        ))}
        <Row justifyContent="space-between" gap="$2">
          <Body size="caption" tone="mute">
            {t({ id: 'moments.discharge.older', message: 'Received 250 ETN' })}
          </Body>
          <Body tone="mute" size="caption">
            {t({ id: 'moments.discharge.older.when', message: 'Tuesday' })}
          </Body>
        </Row>
      </Plate>
      <Row gap="$2" flexWrap="wrap">
        <Key
          label={t({ id: 'moments.discharge.sign', message: 'Sign' })}
          onPress={() => {
            onFire()
            setSigned((n) => n + 1)
          }}
          testID="fire-discharge"
        />
        <Key
          label={t({ id: 'moments.discharge.clear', message: 'Clear the list' })}
          kind="secondary"
          onPress={() => setLanded(0)}
          testID="moment-discharge-clear"
        />
      </Row>
    </Column>
  )
}

/* -------------------------------------------------------------- Engraved QR */

function QrStage() {
  return (
    <Column gap="$3" testID="moment-qr">
      <Plate role="raised" alignItems="center" gap="$3" testID="qr-plate">
        {/* The well is the engraving: the code is cut into the plate, not printed on it. */}
        <Plate role="well" padding={12} alignItems="center" testID="qr-well">
          <QR value={`ethereum:${ADDRESS}@${ETN}`} size={180} />
        </Plate>
        <Body tone="arc" size="caption">
          {t({ id: 'moments.qr.chain', message: 'Electroneum · 52014' })}
        </Body>
      </Plate>
      <Body tone="mute" size="caption">
        {t({
          id: 'moments.qr.note',
          message:
            'The light across the engraving follows the phone on native (device motion); on the web it is static by design. Scan it from 30 cm to review the criterion.',
        })}
      </Body>
    </Column>
  )
}

/* ------------------------------------------------------------------- Rack */

function RackStage({
  body,
  reducedMotion,
  onFire,
}: {
  body: BodyKind
  reducedMotion: boolean
  onFire: () => void
}) {
  // The fixture account holds three pieces: one with an offer, one listed, one
  // plain — exactly the three states the criterion asks a stranger to tell apart.
  const TOTAL = 3
  const [shelf, setShelf] = useState(2)
  const [bought, setBought] = useState(0)
  useEffect(() => {
    if (bought === 0) return
    const h = setTimeout(
      () => setShelf((n) => Math.min(TOTAL, n + 1)),
      reducedMotion ? 0 : motion.discharge,
    )
    return () => clearTimeout(h)
  }, [bought, reducedMotion])
  return (
    <Column gap="$3" testID="moment-rack">
      {/* The real Rack, not a copy of it: the shelves, the price tag and the offer mark are the ones that ship. */}
      <Rack body={body} embedded limit={shelf} />
      <Row gap="$2" flexWrap="wrap">
        <Key
          label={t({ id: 'moments.rack.buy', message: 'Buy a piece' })}
          disabled={shelf >= TOTAL}
          onPress={() => {
            onFire()
            setBought((n) => n + 1)
          }}
          testID="moment-rack-buy"
        />
        {/* Not product copy — no user reaches this screen, and a beat has to be re-armable to be reviewed twice. */}
        <Key
          label={t({ id: 'moments.rack.reset', message: 'Empty the shelf again' })}
          kind="secondary"
          onPress={() => setShelf(2)}
          testID="moment-rack-reset"
        />
      </Row>
      <Body tone="mute" size="caption">
        {t({
          id: 'moments.rack.note',
          message:
            'Press a piece to take the shared-element move into it, where the artwork is lit by one slow light sweep.',
        })}
      </Body>
    </Column>
  )
}

/* ------------------------------------------------------------------- Coil */

/** Pending DYNO is held in thousandths so the digits move without floating-point drift. */
const DYNO_START_MILLI = 12_400
/** A "full" coil for the glow's scale — the screen decides it (§7.6, CoilProps.glow). */
const DYNO_FULL_MILLI = 20_000

function CoilStage({ reducedMotion, onFire }: { reducedMotion: boolean; onFire: () => void }) {
  const [pending, setPending] = useState(DYNO_START_MILLI)
  const [collected, setCollected] = useState(0)
  const [block, setBlock] = useState(15_100_000)
  useEffect(() => {
    if (reducedMotion) return
    /*
      One tick a second stands in for one block. It moves the block number and
      the pending digits and NOTHING else: the ring's position comes from the
      duration multiplier, which moves about a pixel a week, so a reviewer can
      watch this for a minute and confirm the ring is still.
    */
    const h = setInterval(() => {
      setBlock((b) => b + 1)
      setPending((p) => p + 37)
    }, 1000)
    return () => clearInterval(h)
  }, [reducedMotion])
  const glow = Math.min(1, pending / DYNO_FULL_MILLI)
  const dyno = (milli: number): string => (milli / 1000).toFixed(3)
  return (
    <Column gap="$4" testID="moment-coil">
      <Column alignItems="center">
        <Coil
          durationMultiplier={17_500}
          boltMultiplier={10_500}
          glow={glow}
          size={200}
          at2x="12 Mar"
          at25x="9 Sep"
          reducedMotion={reducedMotion}
          testID="coil"
        />
      </Column>
      <Column gap="$2">
        <Row justifyContent="space-between" alignItems="flex-end" gap="$2">
          <Column alignItems="flex-start">
            <Body tone="mute" size="caption">
              {t({ id: 'moments.coil.pending', message: 'DYNO to collect' })}
            </Body>
            <RollingReadout
              value={dyno(pending)}
              hero
              reducedMotion={reducedMotion}
              testID="moment-coil-pending"
            />
          </Column>
          <Column alignItems="flex-end">
            <Body tone="mute" size="caption">
              {t({ id: 'moments.coil.block', message: 'Block' })}
            </Body>
            <Body tone="mute" size="caption" testID="moment-coil-block">
              {String(block)}
            </Body>
          </Column>
        </Row>
        {/* The DYNO bar: how full the coil is, the same number the glow reads. */}
        <Column
          height={6}
          borderRadius={3}
          backgroundColor="rgba(122, 140, 255, 0.16)"
          overflow="hidden"
        >
          <Column
            width={`${Math.round(glow * 100)}%`}
            height={6}
            overflow="hidden"
            position="relative"
            testID="moment-coil-bar"
          >
            <CurrentFill />
          </Column>
        </Column>
      </Column>
      <Row justifyContent="space-between" alignItems="center" gap="$2">
        <Body tone="mute" size="caption">
          {t({ id: 'moments.coil.collected', message: 'Collected' })}
        </Body>
        <RollingReadout
          value={dyno(collected)}
          reducedMotion={reducedMotion}
          testID="moment-coil-collected"
        />
      </Row>
      <Row gap="$2" flexWrap="wrap">
        <Key
          label={t({ id: 'moments.coil.collect', message: 'Collect' })}
          disabled={pending === 0}
          onPress={() => {
            onFire()
            setCollected((c) => c + pending)
            setPending(0)
          }}
          testID="moment-coil-collect"
        />
        {/* Reduced motion has no ticker, so the accrual needs a hand to review the hum at all. */}
        <Key
          label={t({ id: 'moments.coil.accrue', message: 'Accrue a day' })}
          kind="secondary"
          onPress={() => setPending((p) => p + 3_200)}
          testID="moment-coil-accrue"
        />
      </Row>
    </Column>
  )
}

/* ----------------------------------------------------------- Legends vault */

/**
 * The vessel's level, mirroring `vesselLevel` in packages/electroswap — the
 * engine computes it in production and the card only reads it, but the stage
 * has to move `claimableWei` itself, and a level that did not follow the
 * amount would make the whole moment a lie.
 */
function levelOf(claimableWei: bigint, bestWei: bigint): number {
  if (claimableWei <= 0n) return 0
  if (bestWei <= 0n) return 1
  return Math.max(0, Math.min(1, Number((claimableWei * 1000n) / bestWei) / 1000))
}

/** One marketplace fee's worth of dividends, for the "fees arrive" beat. */
const FEE_WEI = 420_000_000_000_000_000n

function LegendsStage({ reducedMotion, onFire }: { reducedMotion: boolean; onFire: () => void }) {
  const engine = useEngine()
  const { active } = useWalletState()
  const [base, setBase] = useState<LegendsStatus | null>(null)
  const [claimable, setClaimable] = useState(0n)
  const [claimed, setClaimed] = useState(0n)
  const [polls, setPolls] = useState(0)
  const [details, setDetails] = useState(false)

  useEffect(() => {
    if (!active) return
    let alive = true
    engine.legends.status({ accountId: active.id, chainId: ETN }).then(
      (s) => {
        // Null means the chain has no dividend distributor — not a state this
        // moment can be staged from, so the stage simply does not appear.
        if (!alive || s === null) return
        setBase(s)
        setClaimable(BigInt(s.claimableWei))
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [engine, active])

  if (!base) return null
  const best = BigInt(base.bestClaimWei)
  const status: LegendsStatus = {
    ...base,
    claimableWei: claimable.toString(),
    vesselLevel: levelOf(claimable, best),
  }
  const claim = (): void => {
    onFire()
    setClaimed((c) => c + claimable)
    setClaimable(0n)
  }
  return (
    <Column gap="$3" testID="moment-legends">
      <Body tone="mute" size="caption">
        {t({
          id: 'moments.legends.full',
          message: 'The Legends screen — the vessel at full size.',
        })}
      </Body>
      <DividendsCard
        status={status}
        reducedMotion={reducedMotion}
        onClaim={claim}
        testID="dividends"
      />
      <Body tone="mute" size="caption">
        {t({
          id: 'moments.legends.compact',
          message: 'The collection page — collapsed by default; the vessel stays.',
        })}
      </Body>
      <DividendsCard
        status={status}
        collapsed={!details}
        onDetails={() => setDetails((v) => !v)}
        reducedMotion={reducedMotion}
        onClaim={claim}
        testID="dividends-collection"
      />
      <Row justifyContent="space-between" alignItems="center" gap="$2">
        <Column alignItems="flex-start">
          <Body tone="mute" size="caption">
            {t({ id: 'moments.legends.claimed', message: 'Claimed into the readout' })}
          </Body>
          <RollingReadout
            value={formatRaw(claimed.toString(), 18)}
            hero
            reducedMotion={reducedMotion}
            testID="moment-legends-claimed"
          />
        </Column>
        {/* Proof the poll happened: if this number moves and the liquid does not, the criterion holds. */}
        <Body tone="mute" size="caption" testID="moment-legends-polls">
          {t({
            id: 'moments.legends.polls',
            message: 'Polls with no change: {n}',
            values: { n: polls },
          })}
        </Body>
      </Row>
      <Row gap="$2" flexWrap="wrap">
        <Key
          label={t({ id: 'moments.legends.fee', message: 'A fee arrives' })}
          kind="secondary"
          onPress={() => setClaimable((c) => c + FEE_WEI)}
          testID="moment-legends-fee"
        />
        {/*
          The criterion's teeth. This re-renders the card with byte-identical
          values, which is what a 30 s status poll does all day; the vessel must
          not move a pixel.
        */}
        <Key
          label={t({ id: 'moments.legends.poll', message: 'Poll — nothing changed' })}
          kind="secondary"
          onPress={() => setPolls((n) => n + 1)}
          testID="moment-legends-poll"
        />
      </Row>
    </Column>
  )
}
