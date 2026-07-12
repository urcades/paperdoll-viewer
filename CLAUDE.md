# paperdoll-viewer — agent notes

Svelte 5 (runes) + TypeScript + Vite consumer app for the paper\* protocol
family: `paperdoll` (kernel, paper-doll/v3), `paperfold` (patches),
`paperchain` (scenes/relations), `papermold` (conformance profiles). See
README.md for the code map, docs/development-transcript.md for the original
build, and docs/postmortem.md for the family migration and protocol notes.

## Commands

- `pnpm test` (vitest, `src/*.test.ts`), `pnpm typecheck`, `pnpm check`
  (svelte-check). Run all three before committing.
- Dev server: `pnpm dev` (vite, 127.0.0.1). `.claude/launch.json` exists for
  the preview tools.

## Conventions that matter

- **App state is a paperchain Scene** (`{bodies: {main|red|blue…, pool},
  kinds, relations}`). The pool is a real body, never a vessel inside the
  figure. Figure bodies each render a canvas; addresses are scene addresses
  (`"main"`, `"pool"`, `"main/back/nested-backpack"`) split by
  `splitSceneAddress` in `src/scene.ts`.
- **Every mutation flows through App's commit funnel** into ONE paperfold/v2
  scene patch: top-level edits become candidate scenes (`commitCandidate` →
  prune dangling relations → `diffScenes`); nested drawer edits diff at the
  INNER body and ship as `{body, path}` entries (`commitBodyAt`'s nested
  branch — `replaceBodyAtAddress` survives only to build the prune
  candidate). Both paths share `commitPatch` (`applyScenePatch` validates
  all scene laws + canonicalizes, records patch+inverse, runs the
  `commitScene` tail). Don't mutate the scene anywhere else.
- **History is scene patches — one currency** (`src/history.svelte.ts`):
  each entry is `{patch, inverse}` of a `ScenePatchDocument`; cross-body
  transfers and relation edits are ordinary entries. Undo/redo/seek apply
  through the same funnel tail without pushing; `seekTo` composes with
  `composeScenePatches`. Preset swaps and source-panel commits are history
  barriers. Sim ticks commit with `tag: "sim"` and a `runId`.
- **The UI only offers legal moves.** Kernel legality = trial-apply the op +
  `validateDocument`; relation legality = trial `addRelation` +
  `validateScene`. Never re-implement protocol rules. See `canDisconnect` /
  `legalConnectTargets` (workbench) and `RelationsPanel`.
- **Derive, don't store**: layout, wound conditions, power status, edge flow,
  and profile verdicts are computed views. Simulation state lives in element
  `data`, written via `replaceElementData` (remove+insert — the kernel has no
  update op).
- **The reify relay**: papermold never reads `data`. State that judgment
  needs must become structure — death is a `{kind:"status", type:"dead"}`
  element inserted in the same commit that observed it (`reifyDeath` in
  App.svelte); `healAll` removes it. Profiles live in `src/profiles.ts`.
- **Relation liveness is app policy**: `pruneDanglingRelations` (scene.ts)
  drops relations whose endpoints no longer resolve or sit on severed
  (unreachable-from-root) vessels — applied to the candidate scene *before*
  the diff, so the removals are ordinary `removeRelation` entries in the
  same patch (paperfold v2's strict-dangling law would reject the commit
  otherwise).
- **Law 8**: element ids are lowercase slugs, unique per vessel. Give fungible
  elements (conduits etc.) vessel-scoped ids or drags will collide.
- Kernel ops return what they removed (`{body, ...}`) — always destructure —
  EXCEPT `insertElement`/`moveElement`, which return `Body` directly. Beware
  `validateDocument(input: unknown)`: passing the wrapper instead of `.body`
  type-checks and silently breaks (use `validateBody` in
  `src/protocol.svelte.ts`).
- **Canonical form**: patch commits canonicalize bodies (empty `ports`/
  `contains` dropped). Compare bodies via `canonicalizeBody`, never raw JSON.

## Svelte 5 gotchas hit in this repo

- `$state` proxies: `$state.snapshot(...)` before handing state to any
  protocol package (paperfold/paperchain/papermold `structuredClone`
  internally and throw "could not be cloned" on proxies). Use the helpers in
  `src/protocol.svelte.ts`; History snapshots entries on the way out.
- `$state.snapshot` on recursive protocol types can blow up svelte-check's
  type instantiation — for read-only protocol calls (e.g. `isAccepted`) the
  proxy is safe to pass directly.
- An `$effect` that early-returns before reading its reactive dependency
  tracks nothing and permanently detaches. Guard variables the effect checks
  must themselves be `$state`.
- Preferred typing for nullable state: `let x = $state<T | null>(null)` — the
  annotated-let form loses narrowing under svelte-check.

## Testing style

Behavioral tests over protocol documents: build a preset clone, apply ops,
assert on document/scene shape and derived outputs; fixed `rng` for combat
determinism. Suites: `workbench` (kernel-era behavior), `history` (patch
round-trips, scrubbing), `scene` (presets, transfers, relations),
`profiles` (conformance + reification), and **`characterization.test.ts` — a
frozen oracle of pre-migration behavior; do not edit it without explicit user
sign-off**. `scene.test.ts` enumerates preset ids and needs updating when
adding one (legacy ids are additionally pinned by the oracle).
