# Combatant: DF-Style Layered Damage Demo

Replaces the Patient preset. Models a simplified Dwarf Fortress health system on
paperdoll primitives to demonstrate `data` as live, structured state.

## Mapping DF onto paperdoll

| DF concept | paperdoll expression |
|---|---|
| Tissue layer stack (skin→fat→muscle→bone→organ) | Ordered `contains` list of tissue/organ elements per part vessel; list order = penetration order |
| Material properties (SHEAR/IMPACT yield+fracture) | `data.material = { shearY, shearF, impactY, impactF, absorb }` per element |
| Wound severity tiers | Numeric `data.integrity/max`; DF-style verb derived per tissue type (skin *torn*, bone *fractured*, brain *bruised*) |
| Attack types (edged/blunt; contact area) | Weapon presets `{ kind, momentum, contactArea }`; edged converts to blunt per-layer on failed shear check |
| Armor | `item` elements with `material` data, worn in part vessels via typed accepts (`item/helm` → head); walked before tissues; skipped when destroyed |
| Blunt momentum transfer to neighbors | One-hop bruise along `ports` when leftover blunt momentum is high |
| Functional consequences (brain death, suffocation, useless limbs, pain, bleeding) | `deriveCondition(body)` — computed from the document each commit, never stored (same philosophy as deriveLayout) |

## New module: `src/combat.ts` (pure, tested)

- `WEAPONS`: fist (blunt 35/a20), dagger (edged 55/a8), sword (edged 90/a45),
  warhammer (blunt 130/a25), arrow (edged 65/a4).
- `applyStrike(body, vesselId, weapon, rng) -> { body, log: string[] }` — folds
  momentum through armor items then tissue layers: edged passes a layer if
  momentum beats `shearY` scaled by contact area (damage scaled by `shearF`,
  momentum decays), otherwise converts to blunt *for that layer*; blunt beats
  `impactY` to wound (scaled by `impactF`) and passes `momentum * (1 - absorb)`
  inward, else is absorbed. Data writes via `replaceElementData`
  (removeElement + insertElement-at). Leftover blunt momentum may bruise one
  connected neighbor's outer layer.
- `deriveCondition(body) -> string[]`: dead (brain/heart destroyed), suffocating
  (both lungs), unconscious/in pain (pain sum, bone-weighted), bleeding (soft
  tissue wounds), `<part> useless` (nerve or bone destroyed in a limb).
- Severity verbs per tissue kind/type from integrity ratio.

## Preset: Combatant (replaces Patient)

Patient's body plan + neck (head–neck–torso spine). Layers per part; brain in
head behind skull, heart/lungs/guts in torso behind ribs, spine+nerve in neck,
motor nerves in limbs. Typed armor accepts: head `item/helm`, torso
`item/mail`, hands `item/gauntlet`, feet `item/boot` (plus tissue/organ kinds
so validation passes). Pool: iron-helm, leather-cap, mail-shirt,
leather-jerkin, iron-gauntlets, leather-boots — iron resists shear (deflects
edged), leather absorbs impact.

## UI

- Header (when the body has material-bearing elements): weapon `<select>`,
  `strike`, `heal`. Strike targets the selected root vessel when it has
  combat layers, otherwise a random part. Status line = DF-style narration
  ("The warhammer strikes the head: the iron helm dents, the skull fractures,
  the brain is bruised!") + derived condition summary.
- Node labels show aggregate part integrity percent; a part renders dead when
  a vital organ inside it is destroyed.
- Detail window (existing) already exposes per-layer wound data; play mode
  drag-drop equips armor.

## Severing (added 2026-07-10)

Limbs are segmented into hinges (`upper-arm → lower-arm → hand → fingers` per
side; legs `thigh → shin → foot`) so cuts can land mid-limb. When a strike
destroys a part's structural **bone** layer, everything distal to that part is
severed: `severDistalSubtree(body, vesselId)` (in workbench.ts) cuts each port
whose removal orphans its neighbor from root, then strips the ports of every
now-unreachable vessel so the detached subtree becomes **free vessels** on the
canvas. This is forced by the reachability law — a ported vessel unreachable
from root is invalid — so a mid-limb cut *must* scatter the whole distal chain
(hand + fingers drop together). Neck bone destroyed → head detaches as a free
vessel = decapitation. Edged narrates "severed", blunt "torn off".

Severing is its own operation, distinct from the manual connector-delete we
deliberately block: it maintains document validity by construction rather than
being an illegal move. `deriveCondition` treats a vital organ on a severed
(unreachable) part as death, so a severed head reads "dead (head severed)".
`heal` restores integrity only; it does not reattach severed parts (reset by
reselecting the preset) — thematically correct for the gore demo.

## Bleeding, pulping, reattachment (added 2026-07-10)

These three compose into a game loop: fight → bleed → race to reattach/heal
before death.

- **Pulping** — edged structural breaks sever (clean detach); blunt structural
  breaks *pulp*: the part stays attached but every tissue layer is destroyed
  in place ("crushed into a pulp"). Restores an honest edged/blunt asymmetry.
- **Bleeding over time** — blood is a `fluid` element in the torso
  (`data: {volume, max}`, no material so weapons can't strike it). A 1s tick
  (`advanceTick`, pure; driven by `setInterval` in App via the commit funnel)
  drains it by `bleedRate(body)` — open soft-tissue wounds drip, severed stumps
  pour. `deriveCondition` reads volume ratio (pale → dizzy → unconscious →
  "dead (bled out)"). The source panel visibly rewrites the volume each tick.
  A "bleed" header toggle starts/stops it; it self-stops on death or when
  bleeding reaches zero. Detached parts stop contributing pain/bleeding to the
  figure (their loop `continue`s in deriveCondition).
- **Reattachment** — needs *no new machinery*: a severed part is a valid free
  vessel, so the existing edge-drag-to-connect reattaches it (drag neck's top
  handle to the free head → `connect` → head rejoins the figure). The gore demo
  run backwards is the surgery demo. `heal` restores integrity and refills
  blood but does not reattach (drag to do that, or reselect the preset).

Known rough edge: severed free parts pile in the free row *below* the clipped
canvas — you must pan down to reach them for reattachment.

## Out of scope

Skills/dodging, weapon quality/lodging, wrestling stress types, infection,
healing-over-time, body-size scaling, multi-combatant.
