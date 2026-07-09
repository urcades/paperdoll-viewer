# Play Mode: Containment, Compatibility, and Topology Interactions

Design for extending the paperdoll viewer to demonstrate the currently-dormant half
of the `paperdoll` protocol: element containment (`insertElement`, `removeElement`,
`moveElement`), the compatibility judgment (`isAccepted`/`matches`), connection
severing (`disconnect`), free↔figure transitions, and recursive editing of embedded
bodies.

## Guiding principle

**When in doubt, align UI behavior with the protocol.** The UI only offers legal
moves: illegal drops, illegal cuts, and illegal connections are prevented up front
(disabled/dimmed affordances) rather than attempted and error-handled after the
fact. Legality is always decided by the protocol itself — trial-apply the mutation
to a clone and validate — never by re-implementing protocol rules in the viewer.

## 1. Modes: `construct | play`

A header toggle swaps the right-hand panel:

- **construct** — the existing code editor (`SourcePanel`). Unchanged.
- **play** — an **item pool** panel (new `PoolPanel` component).

One shared document, canvas, selection, and pan state; switching modes never resets
work. Implementation is a single `$state` flag in `App.svelte` — no router.

## 2. The item pool is a free vessel

The pool is not a bespoke concept: it is a free vessel in the document with the
reserved id `pool`, open `accepts` (absent), and its `contains` list is the
catalog. Consequences:

- Dragging between pool and vessels is plain `moveElement` in both directions.
  The pool is finite: dragging moves, never copies.
- Presets are extended with a pre-filled `pool` vessel (including a few elements
  with types no vessel accepts, to demonstrate rejection, and at least one element
  carrying a `data` payload and one carrying an embedded `body`).
- If the current document has no `pool` vessel when play mode is entered, one is
  created (empty) via `insertVessel` with `id: "pool"`.
- The `pool` vessel is excluded from canvas rendering (both modes) — it renders
  only as the panel. It still appears in the source text, which is honest: the
  panel is a *view* of a protocol object.

### PoolPanel

A vertical list of the pool's elements. Each row shows `id ?? kind/type` and is
draggable. The panel is also a drop target (drag an element out of a vessel's
detail window onto the panel → `moveElement` back to pool).

## 3. Drag-and-drop of elements

Drag sources: pool rows, and element rows in vessel detail windows (§4).
Drop targets: vessel nodes on the same-surface canvas, and the pool panel.

**Same-surface only** (decided 2026-07-09): `moveElement` operates within one
body, so drags are offered only between vessels of the same surface (pool ↔ root
vessels; backpack pouch ↔ backpack pouch). Cross-depth drags are simply not
offered, consistent with "the UI only offers legal moves". To keep the
same-surface canvas visible as a drop target at depth, vessels double-clicked
inside a window's canvas open as a bottom **drawer** rather than replacing the
canvas (§4).

- On drag start, compute legal targets with `isAccepted(vessel, element)` and
  visually mark them (illegal targets dimmed; legal targets highlighted on hover).
- Drop on a legal target → `moveElement(body, from, index, to)` →
  `commitConstruction`.
- Drop on an illegal target is inert, but shows feedback: status line message
  (e.g. `Feet does not accept item/missile — accepts item/feet`) and a brief
  rejection animation on the node. This is the visible demonstration of the
  compatibility law, including the three `accepts` modes (absent = open,
  `[]` = sealed, non-empty = typed).
- Implementation uses pointer events (consistent with existing pan/drag code),
  not HTML5 drag-and-drop.

## 4. Vessel detail windows

Double-click **any** vessel (not just ones with embedded bodies) to open a window
(evolves `EmbeddedBodyWindow`):

- Content is the vessel's **element list**: one row per contained element showing
  `kind`, `type`, `id`, and pretty-printed `data` (opaque JSON payload). Rows are
  drag sources (§3). Empty vessels show their `accepts` tokens ("accepts
  item/head") so sealed/typed/open is inspectable.
- An element with an embedded `body` gets an **open** affordance that swaps the
  window content to a **fully interactive canvas** for that body — same component
  and same interactions as the root canvas (select, add, connect, disconnect,
  delete, double-click deeper, drag elements). A back affordance returns to the
  element list. Windows nest logically by replacement (breadcrumb-style), not by
  spawning multiple windows.

### Recursive write-back

The open window is addressed by a **path**: a chain of `(vesselId, elementIndex)`
pairs from the root document down to the body being edited. All mutations at any
depth produce a new sub-body; the app writes it back immutably along the path and
runs the normal `commitConstruction` (so validation and source rewrite stay
single-sourced). The canvas component becomes agnostic
about depth: it receives a `Body` and emits mutations; only `App.svelte` knows the
path.

## 5. Connector selection and legal-only delete

- Connection edges on the canvas become clickable (wider invisible hit-area path
  over each SVG edge). Clicking selects the connection; selection state becomes a
  discriminated union: `{ kind: "vessel", id } | { kind: "connection", from, to }`.
- The header `delete` button applies to the current selection. For a connection it
  calls `disconnect`; the button is **enabled only if the cut is legal** —
  determined by trial-applying `disconnect` to a clone and checking
  `validateDocument`/`deriveLayout`. Ring edges and leaf edges pass; mid-graph
  cuts that would orphan a ported subtree are disabled (with a status explanation
  on click of the disabled state).
- Severing a leaf's only connection clears both ports; the vessel then *derives*
  as free and automatically joins the free row — demonstrating that "free" is a
  derived property, not a stored kind.

## 6. Edge-drag to connect

The existing edge handles gain a second verb: **click = add vessel** (unchanged),
**drag = connect**.

- Drag from a handle → all faces that would form a legal connection light up as
  targets; drop completes with `connect`, anywhere else cancels.
- Legality by trial: `connect` on a clone must succeed *and* the result must
  validate/derive (covers face-opposition, occupied cells, geometric consistency).
- Free vessels also render handles, so a free vessel can be dragged into the
  figure (free → figure in one gesture; its grid position is implied by the face
  it connects to). Combined with §5, both directions of the free↔figure
  transition are interactive.

## 7. Out of scope

- Spawning/authoring new item definitions in the UI (edit the source instead).
- Custom vessel definitions from the canvas (`insertVessel` still inserts `{}`).
- `migrateV1` demonstration.
- Multiple simultaneous windows; window management beyond one breadcrumbed window.
- Persistence, undo/redo.

## Components & state (summary)

- `App.svelte` — adds `mode`, selection union, window path state, write-back
  helper, legality helpers (`canDisconnect`, `legalConnectTargets`,
  `legalDropTargets`) built on trial-apply + protocol validation.
- `PaperDollCanvas.svelte` — becomes depth-agnostic (props: body + callbacks);
  gains connector hit-areas/selection, handle-drag connect, drop-target rendering.
- `EmbeddedBodyWindow.svelte` → `VesselWindow.svelte` — element list view +
  nested canvas view with breadcrumb.
- `PoolPanel.svelte` — new.
- `workbench.ts` — shared drag state helpers.

## Testing

- Unit tests (vitest) for the legality helpers: `canDisconnect` on ring/leaf/
  mid-graph edges; drop-target computation across open/sealed/typed vessels;
  free→figure connect targets; recursive write-back path addressing.
- Existing 14 workbench tests must keep passing.
- Interactive verification of drag gestures via the preview browser.
