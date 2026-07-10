# paperdoll-viewer

An interactive demo space for the [paperdoll protocol](https://www.npmjs.com/package/paperdoll)
(`paper-doll/v3`) — a document format for bodies made of connected vessels that
contain typed elements. This app is a *consumer*: it renders paperdoll
documents, edits them through protocol operations only, and layers
demonstrations (combat, gore, power networks) on top of the three primitives
the protocol provides:

- **Topology** — vessels connected through face-opposite `ports`, laid out on a
  derived unit grid.
- **Typed containment** — vessels `accept` and `contain` elements
  (`kind`/`type`/`id`), recursively: an element can carry a whole embedded
  `body`.
- **Opaque data** — elements carry JSON `data`; every simulation here (hp,
  materials, charge, blood) lives there.

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
- **Powered Mech** — data propagating through the topology graph. Electric
  floods from a battery through wire-conducting vessels to loads and a pump;
  the pump converts to hydraulic and drives the legs. `pulse`/`run` step the
  simulation; powered vessels render blue with animated flow direction on the
  edges. Cut power two ways: sever a leaf pipe (topology) or drag a conduit
  element out of a vessel (containment).

## Code map

| File | Role |
| --- | --- |
| `src/App.svelte` | Document owner; single commit funnel (validate → derive → rewrite source); selection, windows, drags, tick loops |
| `src/BodyCanvas.svelte` | Depth-agnostic canvas core (render, select, handles, connect-drag) — same component at root and inside windows |
| `src/PaperDollCanvas.svelte` | Root shell: header (preset, per-body actions), status toast, window host |
| `src/VesselWindow.svelte` | Element list / nested canvas / drawer for a vessel |
| `src/SourcePanel.svelte` | CodeMirror editor, two-way sync with the document |
| `src/PoolPanel.svelte` | Play-mode item pool (a literal free vessel) |
| `src/workbench.ts` | Pure helpers: render pipeline, protocol addresses, trial-validate legality (`canDisconnect`, `legalConnectTargets`, `legalDropVessels`), write-back (`replaceBodyAtAddress`, `replaceElementData`), `severDistalSubtree` |
| `src/combat.ts` | DF damage model: `applyStrike`, `advanceTick` (bleeding), `deriveCondition`, `healAll` |
| `src/power.ts` | Power networks: `propagatePower` (per-component fold), `energizedDepths`, `derivePowerStatus` |
| `src/sample-document.ts` | All presets and their presentation |
| `src/construction-source.ts` | Document ⇄ editor-text round-tripping |

## Docs

- [`docs/development-transcript.md`](docs/development-transcript.md) — the
  narrative of how this demo space was built, episode by episode, with the
  protocol lessons collected at the end.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — the design specs that
  preceded the larger features (play mode, the Combatant, the Powered Mech).
