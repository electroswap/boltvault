# BoltVault style bible — "the Grid, lit"

The owner's three concept renders (`/inspiration`, 2026-09-05) replace the "Chamber" wording of the reference board wherever the two disagree. This file is the contract every primitive, screen and shader is reviewed against; `packages/ui/src/tokens.ts` is its machine-readable half.

## What the concepts say

Three renders of the ElectroSwap swap card, one brand:

1. **A deep navy night, never black.** The base is `#070A1F`-`#0B1030`, and it is always lit from somewhere: a violet aurora high on one side, an electric-blue one low on the other.
2. **A living mesh under the glass.** Low waves of luminous nodes and hairline links roll across the bottom half — violet where they are far, cyan where they come near. Calm. Slow. Visible but never louder than a number.
3. **Glass with a lit rim.** Panels are translucent navy with a one-pixel rim that reads as light on an edge: cyan at one corner fading to violet at the other, and a soft glow around the whole plate. Panels nest; the inner ones are darker and dimmer-rimmed.
4. **One current, two colours.** Electric blue `#37A6FF` flowing into violet `#8A4DFF`. That gradient *is* the brand: the primary key, the active rim, the filament, the share bars. Cyan alone marks the live thing; violet alone marks the far thing; together they mean "do this".
5. **Numbers are the hero.** Big, white, geometric, tabular. Labels are quiet lavender-grey. Gains are mint, losses are coral; both are also signed text.
6. **Pills, not buttons, for choices.** Tokens, durations, slippage: a dark pill with a rim, an icon, a chevron.

## What we refuse (calibration)

- Pure black with one neon accent; identical cards with one radius and a grey drop-shadow.
- A second accent used as *flat paint* on chrome — violet and cyan appear as light (rims, glows, gradients) and only ever as a flat fill inside the gradient key.
- Backgrounds that compete: the earlier Field (white-blue lightning across the whole frame) was louder than the readout. The Grid stays in the lower half, below 40 % luminance, and the top of every screen is near-plain glass so type reads.
- Tracked all-caps eyebrows, `A · B · C` meta strings, `→` on buttons, monospace for small labels, mascots.

## Palette

Paint (chrome, text, controls) — `paint` in tokens.ts:

| Token | Value | Job |
|---|---|---|
| `void` | `#070A1F` | Base under the Grid |
| `deep` | `#0B1030` | Sheet and menu base, bottom of the page gradient |
| `glass` | `rgba(13, 18, 52, 0.66)` | Recessed plate |
| `glassRaised` | `rgba(22, 30, 78, 0.72)` | Raised plate, sheet, console |
| `well` | `rgba(6, 9, 30, 0.72)` | Inputs and inner terminals (darker than their plate) |
| `ink` | `#F1F4FF` | Body text, numerals |
| `mute` | `#8F99C4` | Labels, captions, unpriced rows |
| `arc` | `#4FC3FF` | The live mark: filament, selected, links, active tab |
| `plasma` | `#8B5CF6` | The far mark: rims fade into it; never a flat fill on its own |
| `surge` | `#3EE6A5` | Gains, confirmed, "to collect" |
| `ember` | `#F5C66B` | Tier marks, offers, warnings that are not danger |
| `burn` | `#FF5C7A` | Losses, danger, revoke |

The current — `current` in tokens.ts: `#37A6FF → #8A4DFF`, left to right (or top-left to bottom-right on rims).

Light (only the scene renders these): `core #EAF6FF`, `arc #4FC3FF`, `plasma #8B5CF6`, `auroraViolet #5B2BD9`, `auroraBlue #1E4DFF`, `flare #FF8A5B` (tier warmth).

Edges: `edge rgba(122,140,255,0.16)` on recessed plates; the **lit rim** (an SVG gradient stroke, `arc` 70 % → `plasma` 70 %) on raised plates, sheets, the active segment, pills and secondary keys; `edgeStrong rgba(140,170,255,0.34)` for focus.

Glow: raised plates `rgba(60,100,255,0.22)` radius 24; the primary key `rgba(70,120,255,0.45)` radius 18, offset y 6; the active tab a 4 px `arc` dot with radius 8 glow.

## Type

- **Readouts** (totals, quotes, amounts ≥ 24 px): Oxanium 600, tabular, tracking −0.03 em, `ink`, with a faint text glow (`rgba(79,195,255,0.35)`, radius 12) on the hero only. Hero 40 px in the popup, 48 px in the tab and on the phone.
- **Text**: Sora 400/600, 13–17 px, sentence case, ≤ 70 characters a line. Labels above a number are Sora 400 13 px `mute`.
- **Addresses and hashes**: Sora tabular 13–14 px `mute`, `0x1F90…7B63`, with their own copy control beside them. There is no monospace face in the product (2026-09-06: the IBM Plex Mono declaration was never shipped as a file and fell back to a serif; it is gone from the tokens, the config and every call site).
- No third family. Numerals never fall back to Sora.
- **The fonts are never seen arriving.** Both faces ship as local woff2, every weight is preloaded in every entry document, and `font-display` is `block` — never `swap`, which by definition paints fallback text first and then changes it under the reader. Every family in `tokens.ts` is a full stack ending in a generic sans; a bare `font-family: Sora` falls back to the UA default, which is a *serif*, and that is twice now that a bare declaration has put a serif on screen (the Plex Mono note above was the first). `e2e/fonts.spec.ts` holds all three of these.

## Materials and roles

| Role | Fill | Rim | Radius | Glow |
|---|---|---|---|---|
| Console (a screen's main panel: the swap card, the sign sheet) | `glassRaised` | lit rim 70 % | 20 | yes |
| Raised plate (at most one hero per screen: your position, the dividends card) | `glassRaised` | lit rim 45 % | 16 | soft |
| Card (anything in a list that opens something: token rows, activity, offers, wallets) | `glass` | lit rim 30 % | 14 | none; hover raises |
| Tile (the Home action grid) | `glassRaised` | lit rim 45 % | 14 | none; press goes solid |
| Recessed plate (fee line, notice, secondary info) | `glass` | `edge` | 14 | none |
| Well (an input, a terminal's amount area) | `well` | `edge`, lit rim on focus | 12 | none |
| Pill (token, duration, slippage, scope) | `glassRaised` | `edge`; lit rim when selected | 999 | none |
| Key, primary | current gradient | none | 16 | yes |
| Key, secondary | `glassRaised` | lit rim 35 % | 16 | none |
| Key, danger | `burn` | none | 16 | none |
| Tab bar | `rgba(9,13,38,0.88)` | gradient hairline on top | 0 | active dot |
| Sheet | `glassRaised` | lit rim on the top edge | 20 top | yes |

Plates never carry a grey shadow. Depth comes from the rim and the glow, and from the Grid showing through the fill.

**Corners nest concentrically.** A shape inside a rounded shape takes the parent's radius minus the gap between them — `innerRadius(outer, inset)` in `tokens.ts`. Equal radii make the inner corner look too round and glue the pair together; an unrelated radius reads as two designs meeting. A child that sits flush inside a clipping parent takes **no** radius of its own and lets the parent's clip shape it: two radii on one corner draw that corner twice, which is the doubled edge the owner saw on cards nested inside cards. (2026-09-06: the campaign banner drew 12 inside a 14 clip, and a dApp favicon drew 12 inside an 11 px circle.)

The glow rule: `console` is a screen's one main panel; `raised` is at most one hero plate per screen; everything a `map()` produces is a `card`; the action grid is `tile`s; static information is `recessed`; inputs and stat strips are `well`s. Two glowing plates next to each other bleed into one — that is why lists are cards.

Chrome: one header per pushed screen (`ScreenHeader` / `PageHeader`): a 44 px row with an icon-only Back, the title beside it, and a right slot; in the popup the right slot ends with the expand control that opens the same screen in a full tab. Keys are 56 px only for a screen's primary verb (Swap, Send, Unlock, Deposit, Claim); Back, Copy, Pin, Hide, Save, Cancel, Close, the auto-lock options and every option chip are compact (44 px hit, 36 px surface) or pills. Every list paints its last-good rows at once and refreshes behind them; a first visit shows a skeleton with the current sweeping through it, never a blank body, and a value older than a minute shows the still, mute filament with "as of" beside it.

## Layout

Left-aligned, 20 px inset in the popup, 24 px on the phone and in the tab. The hero readout sits directly on the Grid (no plate) so the mesh is seen beneath it; everything below it sits on glass. Four keys as glass tiles in the thumb zone; four tabs. Minimum hit 44 px, bus bars 52 px, keys 56 px — unchanged from the master plan.

The swap card follows the concept: two terminals stacked inside one console, each a well with the label top-left, the amount large, the token pill right, the balance line beneath; the flip control is a lit-rim circle sitting on the seam; the rate line is a recessed plate; the Swap key is the full-width gradient.

## The Grid (the Field, rebuilt)

One fragment shader, written twice (GLSL ES 3.0 for the extension, SkSL for Skia), same picture:

- **Ground**: a vertical gradient `void` → `deep`; a violet aurora centred near (0.15, 0.85) and a blue one near (0.9, 0.2), each breathing ± 10 % over ~14 s with a seeded phase; the tier's warmth pulls the blue aurora toward `flare`.
- **Sheets**: four wave lines in the lower 55 % of the frame. Each is `base + a·sin(kx + φ + ωt) + b·sin(2.7kx − 0.6ωt + ψ)` with the amplitudes, phases and spacing seeded by the address. A 1.5 px core plus a wide halo; colour runs `plasma` on the left to `arc` on the right and brightens toward the front sheet.
- **Nodes**: a dot every ~0.06 of width along every sheet, white-cyan at the core. A block pulse flares them 1.6× for ~120 ms.
- **Lattice**: a faint dot grid displaced by the same wave height field, fading away from the sheets, and hairline links between neighbouring sheets at node positions — the mesh's volume.
- **Touch**: sheets lift a few pixels toward the pointer; nothing chases the finger.
- **Limits**: nothing above 40 % luminance under the readout; the top third of the frame carries only the aurora and grain; 30 fps in the popup, half resolution at DPR ≥ 2; a still frame under reduced motion and at 15 % in quiet custody mode.

The seat avatar remains a 40 px crop of the account's Grid, so an account is still recognisable by its light.

## Token marks

A token shows its logo. We ship the ElectroSwap list's marks — all fifteen, plus native ETN — inside the bundle, so the common case needs no network and cannot flicker; anything else resolves from its list `logoURI`, then the sibling extension on the static host (it serves `.svg` for most and `.png` for a few, and the wrong one 404s).

A token with **no** logo is its symbol on a glass disc: `glassRaisedSolid` fill, an `edge` hairline, the symbol in `ink` at Sora 600, upper-cased, clipped to four characters and scaled so it fits. One look for every unknown token — it never competes with a real logo beside it.

There are **no generated pixel patterns anywhere in the product** (2026-09-06: the 5×5 mirrored identicon behind every token avatar is gone, and so is the second copy that lived in the unused `packages/design`). A generated pattern says nothing a symbol does not say better, and it read as a broken image. The account Signature above is not one of these — it is drawn geometry, not a hash grid.

## Selected

A chosen chip (a pill, a segment, a chain, a timeframe) is a **filled tint of the arc** — `arcSoft` fill, `arcEdge` hairline, ink label at 600 — never a lit rim, never a bare colour change of the label. Unchosen chips are raised glass with the edge hairline and a mute label. The fill eases in over 160 ms. This is the one selected treatment; a screen that invents another is wrong.

## Chain selector

One component, one place. The selector is a pill — the chain's mark, its name, a chevron — and it sits as the **first control under the header, at the left** (Send, Receive, Add token) or as the first row of the balance plate (Home, Portfolio). It opens the one chain sheet: left-aligned rows with the mark at 28 px, the name, a caption, the balance held there at the right, a check on the chosen one; a chain that is turned off says so and offers Networks. A screen that only *states* its chain (Token, Swap) uses the mark and name as a caption, never the pill shape. Bridge's From and To selects are the same pill inside the amount wells.

## Amount well

Every amount (Send, Swap, Bridge) is the same well: the label row with an optional control at its right, the amount big and bare beside the token pill, then what it is worth at the left and what you hold at the right with a **MAX key**. A read-only well (what you receive) shows the amount as a readout in the same place. Fields never draw the browser's focus ring; focus is the `arcEdge` hairline.

**MAX is not a pill** (2026-09-06, owner). A pill is this product's shape for a *choice* — a token, a duration, a scope, a filter. MAX is a verb, and wearing the pill shape made every amount well look like it held two selectable chips. It is a small square-shouldered key: `glassRaised`, an `edge` hairline, an `arc` label, 24 px tall at radius 8 — smaller than the well's 12 that contains it, per the concentric rule below.

The two wells sit close. The gap between them is 12 px with the flip control centred on the seam, not the 24 px that made one console read as two cards.

## The action grid

Home's verbs are cells of one recessed surface divided by hairlines — a glyph in its disc, a label, a badge pinned to the corner — never nine plates with rims. The press tint lives on the cell.

## Widths

The popup is 400 × 600 (Rabby-wide): 360 px of content between 20 px insets. Every row is designed for that width first; the tab centres a 560–680 px column; nothing is designed at 360 any more.

**400 × 600 is a hard edge, and motion must respect it.** Chrome sizes an action popup from the document and never shrinks it back, so a single frame of overflow leaves the popup permanently wider with a dead margin down the right. Every enter animation begins outside its own box — a push at `translateX(14)`, a tab change at `translateY(6)`, a sheet panel at `translateY(28)` — so the screen area clips, and `html`, `body` and `#root` are all sized and clipped (`overflow: hidden` on `body` alone propagates to the viewport and leaves body itself computing to `visible`, clipping nothing). `e2e/sizing.spec.ts` samples every frame across a full navigation and fails if the document ever exceeds 400 × 600; it caught this at 414 px.

## Motion

One ignition on unlock; everything else answers the person or the chain. The Grid's waves move at ~0.08 cycles per second; nodes pulse per block.

- **A view arrives** (`ScreenEnter`): a push slides in 14 px from the right and fades up over 180 ms; a pop returns from the left; a tab change rises 6 px over 160 ms. The Grid behind never moves. The same route never re-animates.
- **A press charges** (`Charge`): a soft highlight sweeps a primary key once, left to right, 260 ms — current finding its way through. The key also settles to 0.985 scale while held.
- **A choice fills**: a pill's or a segment's fill eases in over 160 ms; the dock's one indicator slides to the chosen tab over 180 ms instead of lighting up in place.
- **A confirmation pops**: the copied check scales in from 0.5 over 160 ms.
- **A sheet rises** 28 px on `cubicBezier(0.2, 0.9, 0.25, 1)` over 220 ms while its scrim fades.
- Every timing is ≤ 260 ms and eased. Under reduced motion transitions run at 0 ms and one-shot animations do not mount; the app is complete without them.

## Copy

Unchanged from the master plan §7.10. The vocabulary of the concepts — "You pay", "You receive", "Balance", "Max", "Swap" — is already ours.
