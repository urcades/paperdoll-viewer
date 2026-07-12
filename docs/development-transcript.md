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

---

# Part II: the family sessions (July 10–12, 2026)

The sibling protocols shipped — paperchain, paperfold, papermold — and the
question changed from *"what does the protocol imply?"* to *"how much of this
app should stop existing?"* Part I's theme held: when in doubt, align with
the protocol. Part II added its converse: **when the protocol can't say it,
ship the protocol change** — twice, to npm, with this app as the proving
consumer both times.

## Episode 10: the family migration (`91474c8`–`4de90f5`, July 10)

A four-agent exploration mapped the three new packages against the app's
hand-rolled inventory, and a six-phase plan rebuilt the viewer on all four
protocols. The discipline that made it safe: a **characterization oracle**
(21 pins over combat narration, power propagation, conditions, bleed rates,
preset structure, editor round-trips) written before any refactor and frozen
— it never changed and never failed across the entire migration.

- **paperfold** deleted the impossibility of undo: the commit funnel became
  diff → apply → record `{patch, inverse}`, and a timeline scrubber fell out
  of `composePatches`. First contact also produced the family's biggest
  consumer gotcha — all three siblings `structuredClone` internally and
  throw on Svelte `$state` proxies. Snapshot at the boundary.
- **papermold** deleted death-by-data-inference via the reify relay: the sim
  observes dying, inserts `{kind:"status", type:"dead"}` in the same commit,
  and profiles judge the shape. Undo un-kills.
- **paperchain** deleted the pool hack (a phantom vessel smuggled into the
  figure became a real second body) and made versus mode *expressible at
  all*: red and blue combatants, `wields`/`grapples` kinds with declared
  multiplicity, and disarm-by-dismemberment as app policy
  (`pruneDanglingRelations`) — one reachability check per endpoint.

The postmortem (`docs/postmortem.md`) closed the episode with six protocol
improvement proposals, ranked by app code each would delete.

## Episode 11: paperfold 0.2.0 — the scene is the document of record (July 11)

Proposals #1 and #2 turned out to be one idea: *change should speak the
family's full address grammar.* Both specs had already reserved the road —
paperfold's RFC names "bodies *and* paperchain scenes" as targets, and
paperchain's strict-dangling law exists to give paperfold transactions "a
real job."

paperfold 0.2.0 shipped `paperfold/v2`: scene patches whose kernel entries
carry a `body` name and an optional `path` into embedded bodies, plus six
entries reifying paperchain's ops with destruction records —
`removeRelation`'s relation doubles as its own record in **stored
orientation**, and `diffScenes` always emits the relation cleanup a severing
implies ("the rope drops as part of the severing"). The v1 surface stayed
byte-identical.

The viewer migration collapsed the two-currency history (`BodyStep[]` +
hand-inverted `SceneOp`s) into one `{patch, inverse}` pair per entry — net
−50 lines while gaining guarantees — and later the same day (`271c3d5`)
nested drawer edits switched from whole-element replacement to path entries
diffed at the inner body. An adversarial review caught one real bug before
release: relation pruning didn't recurse into embedded bodies.

## Episode 12: papermold 0.2.0 — judgment learns to see scenes (July 12)

Proposal #3 was enablement, not deletion: "is red disarmed?" was
un-judgeable because profiles saw one body while relations lived in the
scene. papermold 0.2.0 shipped `papermold/v2` scene profiles — relation
demands with **subtree anchoring** (a sheathed sword still counts as
wielded; anchor `"red"` can never match body `"red-two"`), kind demands as
field-subset matches, and three universal-quantifier forms (`forAllBodies`
with per-witness errors, `forbidsRelations`, and universal multiplicity
delegated to the kind declarations paperchain already enforces). The rich
vocabulary stayed inside the founding law: one implicit variable per clause,
no joins, judgment remains a linear walk.

The versus HUD proved it live: *armed-red*, *armed-blue*, *engaged*, and
*legal-duel* as dashed scene badges. Adding a grapple flipped *engaged*;
red's wielded-sword kill flipped *legal-duel* with a diagnostic naming blue
as the witness; severing the wielding arm disarms in the same undoable
patch. ~40 lines of app code bought four judgments that previously could not
exist as code.

## Protocol lessons, collected (Part II)

7. **Characterize before you migrate.** A frozen oracle of pinned behavior
   let four protocols replace the app's core with zero observable drift.
8. **Destruction records are the whole trick.** Undo, staleness detection,
   and same-transaction cleanup all fall out of ops that report what they
   destroyed.
9. **Consumer-first works.** Every deferral in the sibling RFCs ("scene
   targeting," "profiles-of-scenes") resolved cleanly the moment a real
   consumer arrived — and not before.
10. **Enablement counts differently from deletion.** paperfold v2 shrank the
    app; papermold v2 grew it slightly and was still the right protocol
    change — measure features-per-line, not lines.
11. **Quantifiers don't require joins.** One implicit variable per clause
    covers "every fighter lives" and "no hand wields two weapons" while
    judgment stays linear; the NP-hard cliff starts exactly at shared
    variables.
12. **The wedge is usually the tooling.** Twice a "hung page" was a stale
    browser-extension session, not the app; read the accessibility tree
    before diagnosing an infinite loop.
