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
- **Addresses**: Sora tabular 14 px `mute`, `0x1F90…7B63`, copy-on-plate.
- No third family. Numerals never fall back to Sora.

## Materials and roles

| Role | Fill | Rim | Radius | Glow |
|---|---|---|---|---|
| Console (a screen's main panel: the swap card, the sign sheet) | `glassRaised` | lit rim 70 % | 20 | yes |
| Raised plate (holdings, positions, a campaign) | `glassRaised` | lit rim 45 % | 16 | soft |
| Recessed plate (fee line, notice, secondary info) | `glass` | `edge` | 14 | none |
| Well (an input, a terminal's amount area) | `well` | `edge`, lit rim on focus | 12 | none |
| Pill (token, duration, slippage, scope) | `glassRaised` | `edge`; lit rim when selected | 999 | none |
| Key, primary | current gradient | none | 16 | yes |
| Key, secondary | `glassRaised` | lit rim 35 % | 16 | none |
| Key, danger | `burn` | none | 16 | none |
| Tab bar | `rgba(9,13,38,0.88)` | gradient hairline on top | 0 | active dot |
| Sheet | `glassRaised` | lit rim on the top edge | 20 top | yes |

Plates never carry a grey shadow. Depth comes from the rim and the glow, and from the Grid showing through the fill.

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

## Motion

Unchanged from the master plan §7.7: one ignition on unlock, everything else caused by the user or the chain. The Grid's waves move at ~0.08 cycles per second; nodes pulse per block; the primary key's glow brightens 120 ms on press.

## Copy

Unchanged from the master plan §7.10. The vocabulary of the concepts — "You pay", "You receive", "Balance", "Max", "Swap" — is already ours.
