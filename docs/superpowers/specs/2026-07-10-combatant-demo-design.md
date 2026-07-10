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

## Out of scope

Skills/dodging, weapon quality/lodging, wrestling stress types, infection,
healing-over-time, body-size scaling, multi-combatant.
