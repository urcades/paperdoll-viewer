# Postmortem: migrating paperdoll-viewer onto the paper\* family

In July 2026 the paperdoll protocol's three sibling packages shipped —
**paperfold** (patches as values), **paperchain** (scenes and relations),
**papermold** (structural conformance) — and this app was rebuilt to lean on
them as hard as possible. This document walks through what the packages
absorbed from app code, what stayed hand-rolled and why, and what the
migration revealed about gaps in the protocols themselves.

The migration landed in six phases (see git history from `c1179d9` forward):
a characterization oracle pinning behavior before any refactor, a patch-based
commit funnel with undo/redo, sim ticks as scrubbing-friendly history entries,
conformance profiles with reified death, a scene-native rewrite, and a
two-combatant versus mode.

## 1. Ledger of deletions — what each package removed from app code

### paperfold deleted the impossibility of undo

Before: the app had **no** undo. Every commit re-parsed a whole replacement
document (`commitBodyAt` → `replaceBodyAtAddress` → `parseDocument`), and the
only history anywhere was CodeMirror's text-editor undo in the source panel.
Adding app-level undo would have meant either snapshotting whole documents per
edit or hand-writing an inverse for every mutation kind — including
reconstructing what `deleteVessel` destroyed.

After: the funnel diffs the previous body against the candidate
(`diffBodies`), commits `applyPatch`'s canonical result, and records
`{patch, inverse: invertPatch(patch)}`. paperfold's destruction records mean
undoing a vessel deletion restores its contents and connections without the
app remembering anything. The same entries power a timeline scrubber:
scrubbing composes inverses (or forward patches) into one `composePatches`
application, so a whole combat run rewinds and replays deterministically.
Roughly 150 lines of `src/history.svelte.ts` bought what would otherwise be a
per-operation inverse library.

A subtle bonus: `applyPatch` validates all eight kernel laws and returns the
canonical body, which **subsumed** the funnel's old `parseDocument`
re-validation (now needed only for untrusted source-panel text).

### paperchain deleted the pool hack

Before: play mode spliced a literal `pool` **vessel into the figure's own
body** (`insertVessel(body, {}, {id: "pool"})`), every canvas render carried
`excludeVessels={["pool"]}` to hide it, and `bleedRate` in `src/combat.ts`
carried an apology comment — "an unreachable item stash (the pool) is not a
wound" — special-casing the phantom vessel so the combat sim wouldn't treat
the party's luggage as a severed limb.

After: the pool is a **body** in a paperchain scene (`{main, pool}`), exactly
the shape paperchain's own `TRADING_DESK_SCENE` fixture models. The
`insertVessel` hack, the `excludeVessels` prop usage, and the comment's
apology all deleted. Cross-body drags became honest two-patch transactions
(one history entry, two `BodyStep`s), and versus mode — two combatants plus
typed `wields`/`grapples` relations with declared multiplicity laws — became
*expressible at all*, which it never was in a single document.

The "UI only offers legal moves" convention extended for free: relation
legality is a trial `addRelation` on a snapshot, and `fromMax`/`toMax`/
symmetric/irreflexive enforcement comes from the kind declaration rather than
app checks.

### papermold deleted death-by-data-inference

Before: "is this thing alive/armored/powered" was scattered ad-hoc structure
reading — `summarizeIntegrity` flagged `dead` by scanning opaque
`data.integrity` numbers, and there was no way to ask "is this body a valid
combatant" except running the combat code and seeing what happened.

After: consumer-authored profiles (`living-combatant`, `armored`,
`powered-rig`) judge structure with per-clause, path-annotated diagnostics
(`$.profiles.living-combatant.vessels.torso.forbids.0 — Body vessel "torso"
contains a forbidden "status/dead" element`). Because papermold *refuses* to
read `data`, death had to be **reified**: when the sim observes a dead
condition it inserts `{kind: "status", type: "dead", id: "status-dead"}` into
the root vessel inside the same funnel commit. That's the family's intended
relay — *the sim counts, paperfold records, papermold judges* — and it turned
out to be a feature, not a workaround: death is now one atomic, undoable
patch, visible to any validator in any language, and un-reified by the same
undo that un-kills.

### paperfold + canonical form deleted preset-matcher fragility

The "which preset is this" dropdown used naive `JSON.stringify` equality,
which broke the moment patches canonicalized a body (dropping empty
`ports:{}` / `contains:[]` residue). Comparing `canonicalizeBody` output made
preset matching survive edit → undo round-trips.

## 2. What stayed hand-rolled, and why

- **Layout and rendering** (`getRenderNodes`, bounds, pixel geometry).
  Presentation is deliberately outside all four protocols; `deriveLayout`
  gives unit-grid positions and everything visual is app territory.
- **`data` semantics** — the entire combat material model and power network
  (`combat.ts`, `power.ts`). Element `data` is opaque to every family member
  by design. The relay pattern means the app reifies *thresholds* (dead), not
  values (hp); simulation arithmetic is consumer code and should be.
- **`replaceElementData`** (remove+insert at index). The kernel still has no
  update-element op, so mutating `data` remains this honest composition. It
  stopped mattering for history — the funnel diffs the result — but the sims
  still route every write through it.
- **`replaceBodyAtAddress`** survives as the *nested-edit lift*: paperfold
  patches address one body's vessels, so an edit inside a drawer
  (`main/back/nested-backpack`) is lifted to a root-level replacement and
  diffed there. `diffBodies` sees it as removeElement+insertElement of the
  containing element — coarse (the whole nested element is the diff unit) but
  correct and invertible for free.
- **`severDistalSubtree`** — a policy ("what severing means") composed from
  kernel ops. Correctly not a protocol op.
- **Trial-validate legality** (`canDisconnect`, `legalConnectTargets`, and now
  trial `addRelation`). Kernel legality and scene legality are cheap to ask
  by attempting; papermold conformance is a different question and doesn't
  absorb this.
- **The `Function()` source-panel eval** and brace-scanner. App UX with no
  protocol analog; extended to scene literals, not replaced.
- **Relation liveness policy** (`pruneDanglingRelations`). paperchain
  refuses dangling *unresolvable* endpoints but deliberately has no
  state-vetoes: after a severing strike the hand still *exists* as a free
  vessel, so `wields` would legally persist on a severed arm. "A relation
  requires endpoints attached to their body's root" is consumer judgment.
  The payoff — disarm-by-dismemberment falls out mechanically — is the app's
  best demo, and it is exactly one reachability check per endpoint.

## 3. Protocol improvement proposals

Ordered by how much app code each would delete.

1. **Nested-body patch addressing (or a kernel `updateElementData` /
   `replaceBody` op).** The lift through `replaceBodyAtAddress` is the
   largest remaining protocol-shaped hole. Because paperfold entries can't
   address into `element.body`, a one-element edit three drawers deep diffs
   as remove+insert of the entire top-level containing element — correct, but
   the patch is opaque about *what changed*, destruction records balloon to
   the whole subtree, and any future collaborative merging would conflict at
   the wrong granularity. A `path` prefix on patch entries (scene-address
   grammar already exists) would fix this without new ops.

2. **Scene-level paperfold (`diffScenes` / scene patch entries).** Relations
   forced a second history entry species (`sceneOps`) with hand-written
   inverses, and `seekTo` now composes per-body patches *and* replays
   relation ops — two currencies in one ledger. paperchain's roadmap already
   names "scene targeting" as paperfold's next phase; this app is the
   concrete motivating consumer. Wanted: patch entries for
   `addRelation`/`removeRelation`/`insertBody`/`deleteBody` with the same
   destruction-record discipline (a removed relation records itself).

3. **papermold over scenes.** "Is red disarmed?" and "are these two figures
   engaged?" are un-judgeable today — profiles see one body, relations live
   in the scene. Profile clauses quantifying over relations
   (`relatedAtLeast: [{kind: "wields"}]`) would let the versus HUD be
   conformance badges instead of bespoke queries. (papermold's spec already
   defers "profiles-of-scenes" — +1 from a real consumer.)

4. **Relation-endpoint liveness hooks.** Every consumer that mutates bodies
   inside a scene must implement dangling-relation cleanup; paperchain
   validates but doesn't help repair. Either a documented
   `pruneRelations(scene) → {scene, removed}` helper, or (better, with #2) a
   scene-patch `deleteVessel` whose destruction record includes the relations
   it took down.

5. **Brand the kernel's document wrapper.** `validateDocument(input:
   unknown)` type-checks when handed the wrapper *or* the bare body and
   silently reports the wrong thing for one of them — this repo's CLAUDE.md
   has warned about it since before the migration. Either accept `Body`
   (validation is about the body; the envelope is transport) or make the
   wrapper a branded type so the mistake fails to compile. The siblings got
   this right: `applyPatch`, `judge`, and scene bodies all traffic in bare
   `Body`.

6. **Publish proxy-tolerance expectations.** All three siblings
   `structuredClone` internally and throw `"#<Object> could not be cloned"`
   when handed a framework proxy (Svelte 5 `$state`, Vue reactive). The fix
   is one `$state.snapshot` at the boundary, but the error surfaces deep
   inside the library on an unrelated call. A one-line input check ("inputs
   must be plain JSON values") with a clear message — or a note in each
   README — would save every UI consumer the same afternoon.

## 4. Numbers

| | before (c1179d9) | after |
|---|---|---|
| protocol packages | 1 (paperdoll) | 4 |
| test files / tests | 1 / 52 | 6 / 106 |
| app-level undo | none | full, incl. cross-body + relations |
| bodies on screen | 1 | any (scene-native; versus ships 2 + pool) |
| "pool" | vessel smuggled into the figure | a body in the scene |
| death | inferred from `data` each frame | a structural element, judged by profile |

The characterization oracle (`src/characterization.test.ts`, 21 pins written
before any refactor) never changed and never failed — the observable combat,
power, bleeding, and round-trip behavior of the original demo is byte-stable
across the entire migration.
