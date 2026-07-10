# Powered Mech: Data Propagating Through Topology

A demo where power flows through the `ports` graph — the one dynamic the other
presets don't exercise. New preset alongside the plain Mech; engine in
`src/power.ts`.

## Model

Power lives on contained elements; a vessel *conducts* a medium if it holds any
element referencing it, so the live network is derived from **containment +
topology together**.

- `cell` — electric source with `{charge, max}` (drains).
- `conduit` — passive `{medium}` (a wire or pipe; carries but neither sources
  nor loads).
- `module` — a load `{draw, medium, powered}` (sensor, guns, legs).
- `converter` — the pump: an electric *load* that becomes a hydraulic *source*
  when powered (`{inMedium, inDraw, outMedium, active}`). Its vessel conducts
  both media — the bridge.

## `propagatePower(body)` — the fold over topology

1. Split the electric-conducting vessels into connected **components** (over
   ports). Each is an independent supply island — a spare battery in the pool
   sources nothing.
2. Per component: sum cell charge (available) vs load+converter demand; power
   its loads and activate its converters iff `available > 0`; drain its own
   cells by `min(demand, available)`.
3. Hydraulic floods from each *active* converter through pipe-conducting
   vessels; hydraulic loads it reaches are powered.

All writes go through `replaceElementData` (remove + insert-at), so the source
panel rewrites live. `derivePowerStatus` is computed each pulse, never stored.

## UI

- `pulse` (one step) and `run`/`stop` (1s auto, reusing the tick pattern),
  shown when the body has power elements. Status: "battery 80% · pump online ·
  offline: left-leg".
- Powered vessels (live cell / on module / active converter) outline red;
  passive conduits stay plain.

## Two ways to cut power — the key demonstration

Because conduction rides on topology, there are two distinct cuts:

1. **Leaf topology cut** — sever `hips ↔ left-leg` (legal: left-leg is a leaf →
   becomes free). That leg loses hydraulic; the other keeps running.
2. **Containment cut** — the direct electric feed to the pump
   (`spine ↔ pump`) *can't* be severed: it would orphan the pump+hips+legs
   subtree (reachability law), so the UI blocks it. Instead, drag the
   `spine-wire` element out to the pool: the spine stays topologically
   connected but stops conducting electric → pump offline → both hydraulic
   legs die, while the arms/sensor (fed directly from the core) stay lit. The
   cross-medium cascade, triggered by a containment edit rather than a
   topology one.

Modeling note: conduits are fungible but law 8 requires unique element ids, so
every wire/pipe carries a vessel-scoped id (`spine-wire`, `pump-pipe`, …) —
otherwise dragging one into a vessel that already holds a "wire" is rejected.

## Out of scope

Brownout priority/load-shedding, resistance/loss over distance, capacitors,
multiple hydraulic stores, AC/DC or voltage — all simulation depth without new
protocol demonstration.
