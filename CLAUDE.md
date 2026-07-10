# paperdoll-viewer — agent notes

Svelte 5 (runes) + TypeScript + Vite consumer app for the `paperdoll` protocol
package (v3). See README.md for the code map and docs/development-transcript.md
for how everything got here.

## Commands

- `pnpm test` (vitest, single file `src/workbench.test.ts`), `pnpm typecheck`,
  `pnpm check` (svelte-check). Run all three before committing.
- Dev server: `pnpm dev` (vite, 127.0.0.1). `.claude/launch.json` exists for
  the preview tools.

## Conventions that matter

- **The UI only offers legal moves.** Decide legality by trial-applying the
  protocol op on a clone and running `validateDocument` — never re-implement
  protocol rules. See `canDisconnect` / `legalConnectTargets` in
  `src/workbench.ts` for the pattern.
- **Every mutation flows through App's commit funnel** (`commitBodyAt` →
  `replaceBodyAtAddress` → `commitConstruction`), which validates, re-derives,
  reconciles selection/windows, and rewrites the editor source. Don't mutate
  the document anywhere else.
- **Bodies are located by protocol address strings** (`""` = root,
  `"back/nested-backpack"`), resolved with the protocol's `resolveAddress`.
  Don't reintroduce index-based paths — addresses are id-stable under
  `contains` reordering.
- **Derive, don't store**: layout, wound conditions, power status, and edge
  flow direction are computed views over the document (`deriveCondition`,
  `derivePowerStatus`, `energizedDepths`). Simulation state itself lives in
  element `data`, written via `replaceElementData` (removeElement +
  insertElement-at — the protocol has no update op).
- **Law 8**: element ids are lowercase slugs, unique per vessel. Give fungible
  elements (conduits etc.) vessel-scoped ids or drags will collide.
- Protocol ops return what they removed (`{body, ...}`); always destructure.
  Beware `validateDocument(input: unknown)` — passing the wrapper instead of
  `.body` type-checks and silently breaks.

## Svelte 5 gotchas hit in this repo

- `$state` proxies: call `$state.snapshot(...)` before handing state to
  protocol ops, `structuredClone`, or JSON comparison.
- An `$effect` that early-returns before reading its reactive dependency
  tracks nothing and permanently detaches. Guard variables the effect checks
  (like a mounted editor view) must themselves be `$state`.
- Preferred typing for nullable state: `let x = $state<T | null>(null)` — the
  annotated-let form loses narrowing under svelte-check.

## Testing style

Behavioral tests over protocol documents in `src/workbench.test.ts` — build a
preset clone, apply ops, assert on document shape and derived outputs. Combat
tests pass a fixed `rng` for determinism. Presets must stay `parseDocument`-
valid; there's a test enumerating preset ids that needs updating when adding
one.
