# paperdoll-viewer

An interactive demo space for the [paper\* protocol family](https://github.com/urcades/paperdoll#the-paper-family):
[paperdoll](https://www.npmjs.com/package/paperdoll) (`paper-doll/v3`, the
kernel), [paperfold](https://www.npmjs.com/package/paperfold) (patches as
values), [paperchain](https://www.npmjs.com/package/paperchain) (scenes and
relations), and [papermold](https://www.npmjs.com/package/papermold)
(conformance profiles). This app is a *consumer*: it edits documents through
protocol operations only and layers demonstrations (combat, gore, power
networks, versus fights) on top of the family's primitives:

- **Topology** — vessels connected through face-opposite `ports`, laid out on a
  derived unit grid (paperdoll).
- **Typed containment** — vessels `accept` and `contain` elements
  (`kind`/`type`/`id`), recursively: an element can carry a whole embedded
  `body` (paperdoll).
- **Opaque data** — elements carry JSON `data`; every simulation here (hp,
  materials, charge, blood) lives there (paperdoll).
- **Change as a value** — every edit and sim tick is a recorded, invertible
  patch: undo/redo and a combat timeline scrubber (paperfold).
- **Scenes** — app state is multiple named bodies plus typed, geometry-free
  relations (`wields`, `grapples`) with declared multiplicity laws
  (paperchain); the item pool is a body, and versus mode pits two combatants.
- **Judgment** — profiles (`living-combatant`, `armored`, `powered-rig`)
  judge structure with per-clause diagnostics; death is a reified
  `status/dead` element, not a number inspected in `data` (papermold).

The standing design principle: **the UI only offers legal moves.** Legality is
always decided by trial-applying the protocol mutation and validating — never
by re-implementing protocol rules in the viewer.

## Running

```sh
pnpm install
pnpm dev        # vite on 127.0.0.1
pnpm test       # vitest
pnpm typecheck  # tsc
pnpm check      # svelte-check
```

## The app

Two panes: the **canvas** (left) and, toggled by `construct | play` (right),
either a live **code editor** whose text round-trips with the canvas, or the
**item pool** for drag-and-drop.

Canvas interactions:

| Gesture | Effect |
| --- | --- |
| click node | select (targets strikes; syncs the editor) |
| click node handle | insert a connected vessel (or connect to an adjacent one) |
| drag node handle | connect to another vessel — legal faces highlight; free vessels can be dragged into the figure |
| click connector | select it; `delete` severs it (enabled only when the cut is legal) |
| double-click node | open its element list (data payloads, embedded bodies) |
| double-click canvas | add a free vessel |
| drag pool/list rows | `moveElement` between same-surface vessels, gated by `accepts` |

## The presets (dropdown, left of the canvas header)

- **Humanoid** — the reference body: recursive backpack (open it from the
  `back` vessel), pool of typed items including deliberate misfits that
  demonstrate `accepts` rejection.
- **Mech / Vehicle / Satellite** — plain topology examples.
- **Human Hand** — five fingers as chained segments, every knuckle a typed
  ring vessel (one vessel can stack several rings).
- **Combatant** — a simplified Dwarf Fortress health model. Ordered tissue
  stacks (skin→fat→muscle→bone→organs) with material properties in `data`;
  weapon select + `strike` folds momentum through the layers; armor is worn
  items walked before tissue; `bleed` drains a blood element over ticks;
  edged structural breaks **sever** (distal parts scatter as free vessels —
  drag them back on to reattach), blunt ones **pulp** in place. Conditions
  (dead, bleeding, useless limbs…) are derived from the document each commit.
- **Versus Arena** — two combatants (`red`, `blue`) in one paperchain scene.
  Select a fighter and `strike`: the *other* one attacks, using the weapon its
  hand `wields` (a typed relation to the weapon element) — sever the wielding
  arm and the relation is pruned in the same undoable commit, so the next
  swing is a fist. `grapples` (symmetric, one per fighter) raises strike
  momentum. The relations panel adds/removes edges with trial-apply legality,
  so multiplicity budgets (`fromMax`/`toMax`) come from the kind declaration.
- **Powered Mech** — data propagating through the topology graph. Electric
  floods from a battery through wire-conducting vessels to loads and a pump;
  the pump converts to hydraulic and drives the legs. `pulse`/`run` step the
  simulation; powered vessels render blue with animated flow direction on the
  edges. Cut power two ways: sever a leaf pipe (topology) or drag a conduit
  element out of a vessel (containment).

## Code map

| File | Role |
| --- | --- |
| `src/App.svelte` | Scene owner; the commit funnel (lift → `diffBodies` → `applyPatch` → prune relations → validate scene → derive → rewrite source); selection, windows, drags, tick loops, strike targeting |
| `src/scene.ts` | Scene addresses, body replacement, `pruneDanglingRelations` (relation-liveness policy) |
| `src/history.svelte.ts` | Patch-based history: `BodyStep[]` + relation `sceneOps` per entry; undo/redo/`seekTo` (composed scrubbing) |
| `src/protocol.svelte.ts` | The wrapper boundary: `snapshotBody`, `validateBody`, `assertApplied` |
| `src/profiles.ts` | papermold profiles, `judgeAll`, the `DEAD_STATUS` reification marker |
| `src/BodyCanvas.svelte` | Depth-agnostic canvas core (render, select, handles, connect-drag) — same component per figure body and inside windows |
| `src/PaperDollCanvas.svelte` | Shell: header (preset, actions, undo/redo, conformance badges), one canvas column per figure body, status toast, window host |
| `src/TimelinePanel.svelte` | Play-mode scrubber over history entries (play/pause/replay) |
| `src/RelationsPanel.svelte` | Relation list + trial-`addRelation` legality form |
| `src/VesselWindow.svelte` | Element list / nested canvas / drawer for a vessel |
| `src/SourcePanel.svelte` | CodeMirror editor, two-way sync with the scene literal |
| `src/PoolPanel.svelte` | Play-mode item pool (the scene's `pool` body) |
| `src/workbench.ts` | Pure body-scoped helpers: render pipeline, protocol addresses, trial-validate legality, `replaceBodyAtAddress` (nested-edit lift), `replaceElementData`, `severDistalSubtree` |
| `src/combat.ts` | DF damage model: `applyStrike`, `advanceTick` (bleeding), `deriveCondition`, `healAll` |
| `src/power.ts` | Power networks: `propagatePower` (per-component fold), `energizedDepths`, `derivePowerStatus` |
| `src/sample-document.ts` | All presets (scene presets incl. `versus-arena`) and their presentation |
| `src/construction-source.ts` | Scene ⇄ editor-text round-tripping (`paperScene` literal) |

## Docs

- [`docs/postmortem.md`](docs/postmortem.md) — the paper\* family migration:
  what each sibling package deleted from app code, what stayed hand-rolled,
  and concrete protocol improvement proposals.
- [`docs/development-transcript.md`](docs/development-transcript.md) — the
  narrative of how this demo space was built, episode by episode, with the
  protocol lessons collected at the end.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — the design specs that
  preceded the larger features (play mode, the Combatant, the Powered Mech).
