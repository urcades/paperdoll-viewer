# Development Transcript

A narrative record of the collaborative sessions (July 8–10, 2026) in which this
repo grew from a static topology visualizer into a demo space for the
[paperdoll protocol](https://www.npmjs.com/package/paperdoll). Written up from
the working sessions between é. urcades and Claude; commit hashes anchor each
episode to the history.

The recurring theme: **when in doubt, align app behavior with the protocol.**
Nearly every feature below started as a UI wish and ended as a discovery about
what the protocol's laws already imply.

---

## Prologue: the viewer before this record (pre-`7263011`)

The repo began as a single-view visualizer: a canvas rendering one hardcoded
humanoid document (later four presets) beside a live code editor whose text
round-trips with the canvas. Early sessions in this period fixed the embedded
backpack window's layout math (it treated node points as top-left corners while
the root canvas treated them as centers — everything mutually offset by half a
node) and taught the add-handles a heuristic: clicking a handle whose adjacent
grid cell is already occupied *connects* to the occupant instead of erroring
with a layout collision.

That heuristic came from a user question that set the tone for the whole
project: *"Is this an inherent limitation of the protocol, or of the viewer?"*
Reading `deriveLayout` showed rings are perfectly legal (a 4-cycle is
geometrically consistent) — the viewer just offered no gesture to close one.
The fix was app-layer; the protocol was never the obstacle.

## Episode 1: the play-mode plan (`7263011`–`148be9e`, July 9)

The user stepped back from incremental fixes and asked: *what protocol
capabilities aren't we demonstrating at all?* The audit found the containment
half of the protocol dormant — `moveElement`, `isAccepted`, `disconnect`,
element `data` — plus read-only embedded bodies.

A design dialogue settled five decisions, each defaulting toward the protocol:

1. **The UI only offers legal moves.** Illegal cuts/drops/connects are
   prevented up front, and legality is always decided by *trial-applying the
   protocol mutation and validating* — never by re-implementing rules app-side.
2. **Item manipulation lives in detail windows** (double-click any vessel),
   not on the tiny canvas nodes.
3. **The item pool is literally a free vessel** with open `accepts` — every
   drag anywhere is one `moveElement`; nothing bespoke.
4. **Click = add, drag = connect** on the same node handles, so free vessels
   can be dragged into the figure in one gesture.
5. **One shared document across a `construct | play` mode toggle** — no router.

One deviation surfaced mid-plan: `moveElement` operates within a single body,
so cross-depth drags (pool → nested backpack pouch) can't be one protocol op.
Decision: **same-surface only** — consistent with "only legal moves."

Implementation ran in seven phases (one commit each): a depth-agnostic
`BodyCanvas` with path-based recursive write-back; connector selection with
legal-only disconnect; edge-drag-to-connect with trial-validated targets;
modes + pool; drag-and-drop gated by `isAccepted` with narrated rejections;
detail windows (element lists with `data` payloads, nested canvases, and a
bottom *drawer* so drags at depth always have their same-surface canvas
visible); cleanup. The repo also went public on GitHub at the start of this
episode.

## Episode 2: protocol v3 migration (`f7ff74e`, July 10)

Upstream shipped breaking changes (0.6.0 → 0.8.1, protocol `paper-doll/v2` →
`v3`):

- `connect`/`disconnect`/`deleteVessel` now return what they removed
  (`{body, displaced/removed/vessel+collapsed}`) for undo-without-diffing.
- **Law 8**: element ids are lowercase address segments, unique per vessel.
- New addressing API: `parseAddress`/`resolveAddress`.

The sneakiest part: two call sites (`canDisconnect`, `legalConnectTargets`)
passed the new `{body, ...}` wrapper into `validateDocument(input: unknown)` —
type-checked fine, would have silently disabled every disconnect and
connect-drag. All sample element ids got slugged (`"Nested backpack"` →
`nested-backpack`).

## Episode 3: replacing homegrown systems with protocol affordances (`6163400`)

The user's directive: *"replace as much of our homegrown/app-specific systems
with the native affordances granted by the protocol."* The homegrown
`BodyPath` (`{vessel, elementIndex}[]`) became protocol **address strings**
(`""` = root, `"back/nested-backpack"`), resolved via `resolveAddress`;
`pathsEqual` became `===` and was deleted. Only write-back
(`replaceBodyAtAddress`) stayed app-side — the protocol has no replace op.

Id-based addresses turned out *more* robust than index paths: reordering a
`contains` list no longer retargets an open window (a real latent bug the
migration fixed, now under test). One honest new constraint: an element must
carry an id to have its embedded body opened, which the UI now explains.

## Episode 4: the Human Hand (`b5b05c2`)

A whimsy request — five fingers, each able to sport rings — that mapped
cleanly: a knuckle row of finger-base vessels chained horizontally, tips
stacked above, thumb off the palm, every segment `accepts: item/ring`, and
`contains` being a list means one knuckle stacks several rings.

Verifying it exposed a long-latent Svelte 5 bug: SourcePanel's source-sync
`$effect` early-returned on a non-reactive `view` variable *before reading*
`source`, so it tracked zero dependencies and permanently detached — external
source rewrites had never reached the editor. (`view` became `$state`.)

## Episode 5: data made interactive — the Patient (`0359e9b`)

First mutation-of-`data` demo: a simplified humanoid whose every part contains
a `part` element carrying `{hp, max}`, a header button applying random damage.
Two protocol facts shaped it:

- Vessels have no `data` field — state rides on the things *in* vessels.
- There is no update-element op — a data write is honestly `removeElement` +
  `insertElement(at)` (the position argument 0.8.1 added), landed as
  `replaceElementData`.

## Episode 6: Dwarf Fortress — the Combatant (`ccc670d`)

The user asked to take it "up several notches" and model DF's damage system,
supplying the wiki's Combat/Wound/Material-science/Human-raw pages. The
mapping held up almost embarrassingly well:

- **Tissue stacks are ordered `contains` lists** (skin→fat→muscle→bone→organ);
  list order *is* penetration order.
- **Material science is a fold**: edged attacks check shear per layer and
  convert to blunt when a layer stops the blade; blunt bruises *through*
  layers with per-layer absorption. A hammer leaves the skull dented but the
  brain mangled behind it.
- **Armor is typed worn items** (`item/helm` fits only the head), walked
  before tissue — drag an iron helm on and daggers glance off.
- **Conditions are derived, never stored** (`deriveCondition`): dead,
  suffocating, unconscious-from-pain (DF's bone-weighted 50×), bleeding,
  useless limbs — `deriveLayout`'s philosophy applied to gameplay.

## Episode 7: gore — severing, bleeding, pulping, reattachment (`a24010d`, `43be026`)

Severing collided directly with the reachability law, and the law forced the
gore model: cutting mid-limb would orphan a ported subtree (illegal), so
`severDistalSubtree` cuts the edge *and* strips every port in the orphaned
subtree — the hand and fingers scatter as free vessels. Getting gibbed is the
protocol maintaining validity by construction. The limbs gained hinges
(upper/lower arm, hand, fingers) to give it room.

Three composing mechanics then closed a game loop (fight → bleed → race to
survive):

- **Pulping**: blunt structural breaks destroy the part in place instead of
  severing — an honest edged/blunt asymmetry.
- **Bleeding over time**: blood is a `fluid` element (no material, so weapons
  can't strike it); a 1s tick drains it by wound severity — stumps pour — with
  conditions escalating pale → dizzy → unconscious → dead. The first time the
  document evolved without a click.
- **Reattachment needed zero new machinery**: a severed head is a valid free
  vessel, so the existing edge-drag-to-connect *is* the surgery mechanic. The
  gore demo run backwards.

## Episode 8: the Powered Mech (`6075a06`–`d4c384f`)

The user picked the one dynamic nothing exercised: *data propagating through
the topology graph* — "maybe power systems in something mechanical." Design:
power lives on contained elements; a vessel *conducts* a medium if it contains
an element referencing it, so the live network derives from **containment +
topology together**. Two media bridge through a converter: electric floods
from the battery to loads and the pump; the powered pump becomes a hydraulic
source driving the legs.

Discoveries along the way:

- **Two ways to cut power.** Severing the pump's feed is *blocked* (would
  orphan the subtree — reachability again), but dragging the `spine-wire`
  element out to the pool kills the same cascade without touching topology.
  Containment edits and topology edits are genuinely different verbs.
- **Law 8 caught a modeling bug**: fungible conduits sharing `id: "wire"`
  collided when dragged; conduits now carry vessel-scoped ids.
- **Propagation must fold per connected component**: a spare battery in the
  pool is an isolated island and must source (and drain) nothing — until you
  drag it into the wired figure, which relights a browned-out mech.
- Battery drain tuned to ~1%/s after the first cut ran dry in five seconds.

## Episode 9: polish (`fced24f`–`2e7f318`)

Visual/UX passes, each small but principled:

- Powered nodes went solid blue with white labels (red stays reserved for
  hover/add affordances); energized edges animate blue marching ants **in the
  direction of flow**, driven by a new derived view `energizedDepths` (BFS
  depth from sources) — which also lights passive conduits the stored flags
  couldn't see.
- The construct/play toggle moved into the right panel's header, replacing
  the panel titles; helper hints removed (parse errors still surface).
- The status line became a free-floating toast at the canvas's bottom center;
  the body selector took the header's left corner, giving per-body actions
  (weapon/strike/bleed/heal, pulse/run, delete) room on the right.

---

## Protocol lessons, collected

1. **Trial-apply + validate beats re-implementing rules.** Every legality
   question (can this edge be cut? where can this drag land?) is answered by
   running the protocol op on a clone and validating.
2. **The reachability law is a game mechanic generator.** It forced the
   sever-cascade (gibbing), blocked mid-graph power cuts, and made
   reattachment-as-surgery fall out for free.
3. **Derive, don't store.** Layout, wound conditions, power status, and flow
   direction are all computed views over the document — the same shape as
   `deriveLayout`.
4. **Law 8 (element identity) is load-bearing**: it makes addresses stable
   under reordering, and it rejects sloppy fungible-item modeling.
5. **`data` is where simulation lives** — vessels stay structural; hp,
   materials, charge, and blood volume all ride contained elements, mutated
   through the remove+insert-at composition.
6. **The compiler won't save you at `unknown` boundaries** (the v3 migration's
   silent `validateDocument({body: wrapper})` bug); only behavioral tests did.
