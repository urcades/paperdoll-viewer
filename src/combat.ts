import { type Body, type ContainedElement, type VesselId } from "paperdoll";
import { reachableVessels, replaceElementData, severDistalSubtree } from "./workbench";

// A simplified Dwarf Fortress material/damage model over paperdoll data.
// Tissue layers and armor are elements whose `data` carries material
// properties and integrity; a strike folds momentum through them in order.

export type Material = {
  shearY: number; // momentum needed for an edged attack to cut this layer
  shearF: number; // resistance to cut damage once yielded
  impactY: number; // momentum needed for a blunt attack to wound this layer
  impactF: number; // resistance to blunt damage once yielded
  absorb: number; // fraction of blunt momentum this layer soaks (0..1)
};

export type CombatData = {
  integrity: number;
  max: number;
  material: Material;
  vital?: boolean;
  function?: string; // e.g. "grasp", "stand" — lost when the element breaks
};

export type Weapon = {
  id: string;
  name: string;
  kind: "edged" | "blunt";
  momentum: number;
  contactArea: number; // small = concentrated (pierces), large = spread
};

export const WEAPONS: readonly Weapon[] = [
  { id: "fist", name: "Fist", kind: "blunt", momentum: 35, contactArea: 20 },
  { id: "dagger", name: "Dagger", kind: "edged", momentum: 55, contactArea: 8 },
  { id: "sword", name: "Sword", kind: "edged", momentum: 90, contactArea: 45 },
  { id: "warhammer", name: "Warhammer", kind: "blunt", momentum: 130, contactArea: 25 },
  { id: "arrow", name: "Arrow", kind: "edged", momentum: 65, contactArea: 4 }
];

type LayerRef = {
  index: number;
  element: ContainedElement;
  data: CombatData;
};

export function getCombatData(element: ContainedElement): CombatData | null {
  const data = element.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const candidate = data as Partial<CombatData>;
  if (
    typeof candidate.integrity !== "number" ||
    typeof candidate.max !== "number" ||
    !candidate.material ||
    typeof candidate.material.shearY !== "number"
  ) {
    return null;
  }
  return data as CombatData;
}

function getLayers(body: Body, vesselId: VesselId): LayerRef[] {
  const contains = body.vessels[vesselId]?.contains ?? [];
  const refs = contains
    .map((element, index) => ({ index, element, data: getCombatData(element)! }))
    .filter((ref) => ref.data);
  // armor items are worn over everything: walk them before tissue
  return [...refs.filter((ref) => ref.element.kind === "item"), ...refs.filter((ref) => ref.element.kind !== "item")];
}

export function hasCombatLayers(body: Body, vesselId: VesselId): boolean {
  return getLayers(body, vesselId).some((ref) => ref.element.kind !== "item");
}

// DF-style severity verbs per tissue family, indexed by wound tier (0 = fresh damage tier 1).
const SEVERITY_VERBS: Record<string, readonly string[]> = {
  skin: ["is bruised", "is cut", "is torn open", "is shredded"],
  fat: ["is bruised", "is torn", "is torn badly", "is pulped"],
  muscle: ["is bruised", "is torn", "is mangled", "is pulped"],
  bone: ["is dented", "is chipped", "is fractured", "is shattered"],
  organ: ["is bruised", "is damaged", "is mangled", "is pulped"],
  nerve: ["is bruised", "is bruised badly", "is severed", "is severed"],
  item: ["is scuffed", "is dented", "is mangled", "is destroyed"]
};

const PAIN_MULTIPLIER: Record<string, number> = {
  bone: 50,
  nerve: 40,
  organ: 25,
  muscle: 8,
  skin: 5,
  fat: 5,
  item: 0
};

function tissueFamily(element: ContainedElement): string {
  if (element.kind === "item") return "item";
  if (element.kind === "organ") return "organ";
  return element.type ?? "muscle";
}

export function severityTier(data: CombatData): number {
  const ratio = data.integrity / data.max;
  if (ratio >= 1) return -1;
  if (ratio > 0.6) return 0;
  if (ratio > 0.3) return 1;
  if (ratio > 0) return 2;
  return 3;
}

export function describeWound(element: ContainedElement, data: CombatData): string | null {
  const tier = severityTier(data);
  if (tier < 0) return null;
  const verbs = SEVERITY_VERBS[tissueFamily(element)] ?? SEVERITY_VERBS.muscle;
  return `the ${element.id ?? element.kind} ${verbs[tier]}`;
}

export type StrikeResult = {
  body: Body;
  log: string;
};

export function applyStrike(
  body: Body,
  vesselId: VesselId,
  weapon: Weapon,
  rng: () => number = Math.random
): StrikeResult {
  let next = body;
  const events: string[] = [];
  let momentum = weapon.momentum * (0.85 + rng() * 0.3);
  const spread = 1 + weapon.contactArea / 100;
  // Once an edged blow fails to shear a layer, the blade is stopped: only
  // impact transmits to everything deeper.
  let bladeStopped = weapon.kind === "blunt";
  // The load-bearing structural layer (bone) being destroyed this strike is
  // what severs everything distal to the part.
  let structureBroken = false;

  for (const layer of getLayers(next, vesselId)) {
    if (momentum < 8) break;
    // refresh: replace keeps positions, but data changes between iterations
    const data = getCombatData(next.vessels[vesselId].contains![layer.index])!;
    if (data.integrity <= 0) continue; // destroyed layers no longer protect

    const material = data.material;
    let wounded = false;

    if (!bladeStopped) {
      const threshold = material.shearY * spread;
      if (momentum >= threshold) {
        const damage = Math.round((momentum / material.shearF) * 30);
        next = wound(next, vesselId, layer.index, data, damage);
        wounded = true;
        momentum *= 0.85;
      } else {
        bladeStopped = true;
      }
    }

    if (!wounded && bladeStopped) {
      const threshold = material.impactY * spread;
      if (momentum >= threshold) {
        const damage = Math.round((momentum / material.impactF) * 22);
        next = wound(next, vesselId, layer.index, data, damage);
        wounded = true;
        momentum *= 1 - material.absorb;
      } else {
        // deflected: most momentum is soaked elastically (DF strain reduction)
        momentum *= 0.15 * (1 - material.absorb);
      }
    }

    if (wounded) {
      const after = getCombatData(next.vessels[vesselId].contains![layer.index])!;
      const justDestroyed = after.integrity <= 0 && data.integrity > 0;
      if (justDestroyed && layer.element.type === "bone") structureBroken = true;
      const line = describeWound(layer.element, after);
      if (line) events.push(justDestroyed ? `${line}!` : line);
    } else if (layer.element.kind === "item") {
      events.push(`glances off the ${layer.element.id}`);
      break; // armor deflected the blow outright
    }
  }

  // Structural failure severs everything distal: the cut edge is removed and
  // the orphaned subtree drops to free vessels (see severDistalSubtree).
  if (structureBroken) {
    const result = severDistalSubtree(next, vesselId);
    if (result.severed.length > 0) {
      next = result.body;
      const verb = weapon.kind === "edged" ? "severed" : "torn off";
      events.push(`the ${result.severed.join(", ")} ${result.severed.length > 1 ? "are" : "is"} ${verb}!`);
    }
  }

  // blunt momentum transfer: a heavy leftover blow jars a connected part
  if (weapon.kind === "blunt" && momentum > 30) {
    const neighborIds = Object.values(body.vessels[vesselId]?.ports ?? {})
      .filter((port): port is NonNullable<typeof port> => Boolean(port))
      .map((port) => port.vessel)
      .filter((id) => hasCombatLayers(next, id));
    if (neighborIds.length > 0) {
      const neighborId = neighborIds[Math.floor(rng() * neighborIds.length)];
      const outer = getLayers(next, neighborId).find(
        (ref) => ref.element.kind !== "item" && getCombatData(next.vessels[neighborId].contains![ref.index])!.integrity > 0
      );
      if (outer) {
        const data = getCombatData(next.vessels[neighborId].contains![outer.index])!;
        next = wound(next, neighborId, outer.index, data, Math.round(momentum / 4));
        events.push(`the blow jars the ${neighborId}`);
      }
    }
  }

  const narration =
    events.length === 0
      ? `The ${weapon.name.toLowerCase()} strikes the ${vesselId} to no effect`
      : `The ${weapon.name.toLowerCase()} strikes the ${vesselId}: ${events.join(", ")}`;
  return { body: next, log: narration };
}

function wound(body: Body, vesselId: VesselId, index: number, data: CombatData, damage: number): Body {
  const integrity = Math.max(0, data.integrity - Math.max(1, damage));
  return replaceElementData(body, vesselId, index, { ...data, integrity } as never);
}

export function healAll(body: Body): Body {
  let next = body;
  for (const vesselId of Object.keys(body.vessels)) {
    for (const layer of getLayers(next, vesselId)) {
      const data = getCombatData(next.vessels[vesselId].contains![layer.index])!;
      if (data.integrity === data.max) continue;
      next = replaceElementData(next, vesselId, layer.index, { ...data, integrity: data.max } as never);
    }
  }
  return next;
}

// Functional consequences are derived from the document, never stored —
// the same philosophy as deriveLayout.
export function deriveCondition(body: Body): string[] {
  const conditions: string[] = [];
  const reachable = reachableVessels(body);
  let pain = 0;
  let bleeding = 0;
  const destroyedVitals: string[] = [];
  const severedVitals: string[] = [];
  const destroyedLungs: string[] = [];
  const uselessParts: string[] = [];

  for (const [vesselId, vessel] of Object.entries(body.vessels)) {
    let partDisabled = false;
    const severed = vesselId !== body.root && !reachable.has(vesselId);
    for (const element of vessel.contains ?? []) {
      const data = getCombatData(element);
      if (!data) continue;
      const family = tissueFamily(element);
      const missing = 1 - data.integrity / data.max;
      pain += missing * (PAIN_MULTIPLIER[family] ?? 5);
      if (family === "skin" || family === "muscle" || family === "organ") bleeding += missing;

      // a vital organ riding a severed (unreachable) part is lost with it
      if (severed && data.vital) severedVitals.push(`${vesselId} severed`);

      if (data.integrity <= 0) {
        if (element.id?.includes("lung")) destroyedLungs.push(element.id);
        else if (data.vital) destroyedVitals.push(element.id ?? element.kind);
        if (family === "nerve" || family === "bone") partDisabled = true;
      }
    }
    if (partDisabled && !severed) uselessParts.push(vesselId);
  }

  for (const vital of destroyedVitals) conditions.push(`dead (${vital} destroyed)`);
  for (const severed of severedVitals) conditions.push(`dead (${severed})`);
  if (destroyedLungs.length >= 2) conditions.push("suffocating");
  if (pain >= 150) conditions.push("unconscious from pain");
  else if (pain >= 50) conditions.push("in great pain");
  if (bleeding >= 3) conditions.push("bleeding heavily");
  else if (bleeding >= 1) conditions.push("bleeding");
  for (const part of uselessParts) conditions.push(`${part} useless`);

  return conditions;
}
