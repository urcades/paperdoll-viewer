import { type Body, type ContainedElement, type VesselId } from "paperdoll";
import { reachableVessels, replaceElementData } from "./workbench";

// A power network layered over paperdoll topology. Power floods from source
// elements along `ports`, but only through vessels that conduct the medium
// (i.e. contain an element referencing it). Two media are bridged by a
// converter (an electric load that becomes a hydraulic source), so cutting the
// converter's electric feed cascades to kill everything hydraulic downstream —
// data propagating across mediums through the graph.

export type Medium = "electric" | "hydraulic";

type Cell = { kind: "cell"; charge: number; max: number; medium: Medium };
type Conduit = { kind: "conduit"; medium: Medium };
type Module = { kind: "module"; draw: number; medium: Medium; powered: boolean };
type Converter = {
  kind: "converter";
  inMedium: Medium;
  inDraw: number;
  outMedium: Medium;
  active: boolean;
};
type PowerElement = Cell | Conduit | Module | Converter;

export function getPowerData(element: ContainedElement): PowerElement | null {
  const data = element.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (element.kind === "cell" && typeof (data as Cell).charge === "number") return { kind: "cell", ...(data as object) } as Cell;
  if (element.kind === "conduit" && typeof (data as Conduit).medium === "string") return { kind: "conduit", ...(data as object) } as Conduit;
  if (element.kind === "module" && typeof (data as Module).draw === "number") return { kind: "module", ...(data as object) } as Module;
  if (element.kind === "converter" && typeof (data as Converter).inDraw === "number") return { kind: "converter", ...(data as object) } as Converter;
  return null;
}

function mediaOf(element: PowerElement): Medium[] {
  if (element.kind === "converter") return [element.inMedium, element.outMedium];
  return [element.medium];
}

function conductsMedium(body: Body, vesselId: VesselId, medium: Medium): boolean {
  return (body.vessels[vesselId]?.contains ?? []).some((element) => {
    const power = getPowerData(element);
    return power !== null && mediaOf(power).includes(medium);
  });
}

export function hasPower(body: Body): boolean {
  return Object.values(body.vessels).some((vessel) =>
    (vessel.contains ?? []).some((element) => getPowerData(element))
  );
}

// Vessels reachable from any source along ports, traversing only vessels that
// conduct the medium.
function energizedFrom(body: Body, sources: VesselId[], medium: Medium): Set<VesselId> {
  const seen = new Set<VesselId>(sources.filter((id) => conductsMedium(body, id, medium)));
  const queue = [...seen];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const port of Object.values(body.vessels[id]?.ports ?? {})) {
      if (!port || seen.has(port.vessel)) continue;
      if (conductsMedium(body, port.vessel, medium)) {
        seen.add(port.vessel);
        queue.push(port.vessel);
      }
    }
  }
  return seen;
}

// Connected components of medium-conducting vessels over the port graph. Each
// is an independent supply island — a battery only powers (and drains for)
// loads in its own component, so an isolated spare in the pool sources nothing.
function conductingComponents(body: Body, medium: Medium): Set<VesselId>[] {
  const conducting = Object.keys(body.vessels).filter((id) => conductsMedium(body, id, medium));
  const remaining = new Set(conducting);
  const components: Set<VesselId>[] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as VesselId;
    const component = energizedFrom(body, [start], medium);
    for (const id of component) remaining.delete(id);
    components.push(component);
  }
  return components;
}

type Located<T> = { vessel: VesselId; index: number; data: T };

function locate<T extends PowerElement>(body: Body, kind: T["kind"]): Located<T>[] {
  const found: Located<T>[] = [];
  for (const [vessel, def] of Object.entries(body.vessels)) {
    (def.contains ?? []).forEach((element, index) => {
      const power = getPowerData(element);
      if (power?.kind === kind) found.push({ vessel, index, data: power as T });
    });
  }
  return found;
}

// One propagation step: energize the electric network from charged cells,
// power its loads (draining charge) and activate reached converters, then
// energize the hydraulic network from active converters and power its loads.
export function propagatePower(body: Body): { body: Body; changed: boolean } {
  const cells = locate<Cell>(body, "cell");
  const modules = locate<Module>(body, "module");
  const converters = locate<Converter>(body, "converter");
  const electricConverters = converters.filter((converter) => converter.data.inMedium === "electric");

  let next = body;
  const write = (vessel: VesselId, index: number, data: object): void => {
    next = replaceElementData(next, vessel, index, data as never);
  };
  const setFlag = (
    entry: Located<Module> | Located<Converter>,
    key: "powered" | "active",
    on: boolean
  ): void => {
    if ((entry.data as Record<string, unknown>)[key] !== on) write(entry.vessel, entry.index, { ...entry.data, [key]: on });
  };

  const activePumps = new Set<VesselId>();

  // Each electric component is independent: its own cells supply its own loads.
  for (const component of conductingComponents(body, "electric")) {
    const compCells = cells.filter((cell) => cell.data.medium === "electric" && component.has(cell.vessel));
    const available = compCells.reduce((sum, cell) => sum + cell.data.charge, 0);
    const on = available > 0;

    const compLoads = modules.filter((module) => module.data.medium === "electric" && component.has(module.vessel));
    const compConverters = electricConverters.filter((conv) => component.has(conv.vessel));
    const demand =
      compLoads.reduce((sum, load) => sum + load.data.draw, 0) +
      compConverters.reduce((sum, conv) => sum + conv.data.inDraw, 0);

    for (const load of compLoads) setFlag(load, "powered", on);
    for (const conv of compConverters) {
      setFlag(conv, "active", on);
      if (on) {
        activePumps.add(conv.vessel);
      }
    }

    // drain this component's own cells by its own demand
    let toDrain = Math.min(demand, available);
    for (const cell of compCells) {
      if (toDrain <= 0) break;
      const spent = Math.min(cell.data.charge, toDrain);
      toDrain -= spent;
      const index = next.vessels[cell.vessel].contains!.findIndex((element) => element.kind === "cell");
      const current = getPowerData(next.vessels[cell.vessel].contains![index]) as Cell;
      write(cell.vessel, index, { ...current, charge: Math.round((current.charge - spent) * 10) / 10 });
    }
  }

  // Hydraulic floods from active pumps through pipe-conducting vessels.
  const hydraulic = energizedFrom(body, [...activePumps], "hydraulic");
  for (const load of modules.filter((module) => module.data.medium === "hydraulic")) {
    setFlag(load, "powered", hydraulic.has(load.vessel));
  }

  return { body: next, changed: next !== body };
}

// Derived, never stored: BFS depth of every energized vessel from its power
// source (electric from charged cells; hydraulic continues from the pump's
// depth). Used by the canvas to paint the live network and animate flow
// direction along edges — shallower node -> deeper node.
export function energizedDepths(body: Body): Map<VesselId, number> {
  const depths = new Map<VesselId, number>();

  const flood = (sources: { vessel: VesselId; depth: number }[], medium: Medium): void => {
    const queue = [...sources].sort((a, b) => a.depth - b.depth);
    for (const source of queue) {
      if (!conductsMedium(body, source.vessel, medium)) continue;
      if (!depths.has(source.vessel) || depths.get(source.vessel)! > source.depth) {
        depths.set(source.vessel, source.depth);
      }
    }
    while (queue.length > 0) {
      const { vessel, depth } = queue.shift()!;
      if (depths.get(vessel) !== depth) continue;
      for (const port of Object.values(body.vessels[vessel]?.ports ?? {})) {
        if (!port || !conductsMedium(body, port.vessel, medium)) continue;
        const next = depth + 1;
        if (!depths.has(port.vessel) || depths.get(port.vessel)! > next) {
          depths.set(port.vessel, next);
          queue.push({ vessel: port.vessel, depth: next });
        }
      }
    }
  };

  const chargedCells = locate<Cell>(body, "cell")
    .filter((cell) => cell.data.medium === "electric" && cell.data.charge > 0)
    .map((cell) => ({ vessel: cell.vessel, depth: 0 }));
  flood(chargedCells, "electric");

  const activePumps = locate<Converter>(body, "converter")
    .filter((conv) => conv.data.inMedium === "electric" && depths.has(conv.vessel))
    .map((conv) => ({ vessel: conv.vessel, depth: depths.get(conv.vessel)! }));
  flood(activePumps, "hydraulic");

  return depths;
}

// Derived, never stored: a human-readable status of the live network.
export function derivePowerStatus(body: Body): string[] {
  const lines: string[] = [];
  // only cells wired into the figure count toward the readout; a spare in the
  // pool is an unreachable island
  const reachable = reachableVessels(body);
  const cells = locate<Cell>(body, "cell").filter((cell) => reachable.has(cell.vessel));
  if (cells.length > 0) {
    const charge = cells.reduce((sum, cell) => sum + cell.data.charge, 0);
    const max = cells.reduce((sum, cell) => sum + cell.data.max, 0);
    lines.push(`battery ${Math.round((charge / max) * 100)}%`);
  }

  for (const conv of locate<Converter>(body, "converter")) {
    lines.push(`${conv.vessel} ${conv.data.active ? "online" : "offline"}`);
  }

  const offline = locate<Module>(body, "module")
    .filter((module) => !module.data.powered)
    .map((module) => module.vessel);
  if (offline.length > 0) lines.push(`offline: ${offline.join(", ")}`);

  return lines;
}
