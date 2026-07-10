// Scene-level helpers over paperchain. The app's top-level state is a Scene
// (multiple named bodies + typed relations); vessel-level machinery in
// workbench.ts stays body-scoped and this layer routes to the right body.
//
// Scene addresses: "<bodyName>" or "<bodyName>/<paperdoll-address>" —
// "main", "pool", "main/back/nested-backpack". The bare-body-name form is an
// app convenience (paperchain's own relation endpoints require at least a
// vessel segment).

import type { Body } from "paperdoll";
import {
  addRelation,
  PAPERCHAIN_PROTOCOL,
  relationsAt,
  removeRelation,
  resolveSceneAddress,
  validateScene,
  type Relation,
  type Scene
} from "paperchain";
import { getBodyAtAddress, reachableVessels } from "./workbench";
import type { SceneOp } from "./history.svelte";

export const MAIN_BODY = "main";
export const POOL_BODY = "pool";

export function splitSceneAddress(address: string): { bodyName: string; address: string } {
  const separator = address.indexOf("/");
  if (separator === -1) return { bodyName: address, address: "" };
  return { bodyName: address.slice(0, separator), address: address.slice(separator + 1) };
}

export function joinSceneAddress(bodyName: string, address: string): string {
  return address === "" ? bodyName : `${bodyName}/${address}`;
}

/** Resolve a (possibly nested) body by scene address; null when missing. */
export function getBodyAtSceneAddress(scene: Scene, sceneAddress: string): Body | null {
  const { bodyName, address } = splitSceneAddress(sceneAddress);
  const body = scene.bodies[bodyName];
  if (!body) return null;
  return getBodyAtAddress(body, address);
}

/** Pure replacement of one named body. */
export function replaceBodyInScene(scene: Scene, bodyName: string, nextBody: Body): Scene {
  return { ...scene, bodies: { ...scene.bodies, [bodyName]: nextBody } };
}

/** Wrap a single figure body (and optional pool contents) as a scene. */
export function makeScene(bodies: Record<string, Body>): Scene {
  return { protocol: PAPERCHAIN_PROTOCOL, bodies, kinds: {}, relations: [] };
}

/** Names of bodies that render as figure canvases (everything but the pool). */
export function figureBodyNames(scene: Scene): string[] {
  return Object.keys(scene.bodies).filter((name) => name !== POOL_BODY);
}

/** Apply recorded scene ops (relation add/removes) through paperchain. */
export function applySceneOps(scene: Scene, sceneOps: SceneOp[]): Scene {
  let next = scene;
  for (const sceneOp of sceneOps) {
    next =
      sceneOp.op === "addRelation"
        ? addRelation(next, sceneOp.relation)
        : removeRelation(next, sceneOp.relation).scene;
  }
  return next;
}

/**
 * Consumer judgment paperchain deliberately leaves to us: a relation only
 * holds while both endpoints resolve AND sit on vessels still attached to
 * their body's root. Severing the wielding arm therefore disarms — the
 * `wields` relation is pruned in the same commit that recorded the wound.
 * Returns the pruned scene plus the removals (recorded as inverse-able
 * scene ops in the same history entry).
 */
export function pruneDanglingRelations(scene: Scene): { scene: Scene; removed: Relation[] } {
  const reachableByBody = new Map<string, Set<string>>();
  const endpointHolds = (address: string): boolean => {
    const { bodyName } = splitSceneAddress(address);
    const body = scene.bodies[bodyName];
    if (!body) return false;
    let resolved;
    try {
      resolved = resolveSceneAddress(scene, address);
    } catch {
      return false;
    }
    if (!resolved) return false;
    if (!reachableByBody.has(bodyName)) reachableByBody.set(bodyName, reachableVessels(body));
    const reachable = reachableByBody.get(bodyName)!;
    const anchorVessel = splitSceneAddress(address).address.split("/")[0];
    return reachable.has(anchorVessel) || anchorVessel === body.root;
  };

  const removed: Relation[] = [];
  let next = scene;
  for (const relation of [...scene.relations]) {
    if (endpointHolds(relation.from) && endpointHolds(relation.to)) continue;
    removed.push(relation);
    next = removeRelation(next, relation).scene;
  }
  return { scene: next, removed };
}

export { addRelation, relationsAt, removeRelation, resolveSceneAddress, validateScene, type Relation, type Scene };
