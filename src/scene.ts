// Scene-level helpers over paperchain. The app's top-level state is a Scene
// (multiple named bodies + typed relations); vessel-level machinery in
// workbench.ts stays body-scoped and this layer routes to the right body.
//
// Scene addresses: "<bodyName>" or "<bodyName>/<paperdoll-address>" —
// "main", "pool", "main/back/nested-backpack". The bare-body-name form is an
// app convenience (paperchain's own relation endpoints require at least a
// vessel segment).

import type { Body } from "paperdoll";
import { PAPERCHAIN_PROTOCOL, validateScene, type Scene } from "paperchain";
import { getBodyAtAddress } from "./workbench";

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

export { validateScene, type Scene };
