// Behavioral tests for the scene-native state: presets as paperchain scenes,
// the pool as a real body, cross-body transfers as multi-step history entries.

import { describe, expect, it } from "vitest";
import { insertElement, parseDocument, removeElement, type Body } from "paperdoll";
import { parseScene, validateScene } from "paperchain";
import { applyPatch, diffBodies, invertPatch } from "paperfold";
import { History } from "./history.svelte";
import { SCENE_PRESETS } from "./sample-document";
import { formatSceneSource, getSceneNodeRanges, parseSceneSource } from "./construction-source";
import { getBodyAtSceneAddress, replaceBodyInScene, splitSceneAddress } from "./scene";

function assertOk<T>(result: { ok: true; value: T } | { ok: false; errors: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

function elementMultiset(body: Body): string[] {
  return Object.values(body.vessels)
    .flatMap((vessel) => vessel.contains ?? [])
    .map((element) => `${element.kind}/${element.id ?? element.type ?? "?"}`)
    .sort();
}

const VIEW = { node: 33, connector: 55, padding: 0 };

describe("scene presets", () => {
  it("ships every legacy preset as a valid two-body scene", () => {
    expect(SCENE_PRESETS.map((preset) => preset.id)).toEqual([
      "humanoid",
      "mech",
      "vehicle",
      "satellite",
      "hand",
      "combatant",
      "powered-mech"
    ]);

    for (const preset of SCENE_PRESETS) {
      expect(validateScene(preset.scene), preset.id).toEqual([]);
      expect(Object.keys(preset.scene.bodies).sort(), preset.id).toEqual(["main", "pool"]);
      // Each body is independently paper-doll valid.
      for (const body of Object.values(preset.scene.bodies)) {
        expect(parseDocument({ protocol: "paper-doll/v3", body }).ok, preset.id).toBe(true);
      }
      // The figure no longer smuggles a pool vessel.
      expect(preset.scene.bodies.main.vessels.pool, preset.id).toBeUndefined();
      expect(preset.presentation.main[preset.scene.bodies.main.root], preset.id).toBeDefined();
    }
  });

  it("moved the humanoid pool contents into the pool body untouched", () => {
    const preset = SCENE_PRESETS.find((candidate) => candidate.id === "humanoid")!;
    const contents = preset.scene.bodies.pool.vessels.pool.contains ?? [];
    expect(contents.length).toBeGreaterThan(0);
    expect(contents.some((element) => element.id === "boarding-axe")).toBe(true);
  });
});

describe("scene addresses", () => {
  it("splits and resolves body-prefixed addresses", () => {
    const scene = structuredClone(SCENE_PRESETS[0].scene);
    expect(splitSceneAddress("main")).toEqual({ bodyName: "main", address: "" });
    expect(splitSceneAddress("main/back/nested-backpack")).toEqual({
      bodyName: "main",
      address: "back/nested-backpack"
    });
    expect(getBodyAtSceneAddress(scene, "main")?.root).toBe(scene.bodies.main.root);
    expect(getBodyAtSceneAddress(scene, "pool")?.root).toBe("pool");
    expect(getBodyAtSceneAddress(scene, "main/back/nested-backpack")?.root).toBe("pack-shell");
    expect(getBodyAtSceneAddress(scene, "ghost")).toBeNull();
  });
});

describe("cross-body transfers", () => {
  it("conserves elements and stays scene-valid through a pool→figure→pool round trip", () => {
    let scene = structuredClone(SCENE_PRESETS.find((candidate) => candidate.id === "humanoid")!.scene);
    const history = new History();
    const before = [...elementMultiset(scene.bodies.main), ...elementMultiset(scene.bodies.pool)].sort();

    // pool → figure (boarding-axe to left-hand), the App's transferElement sequence.
    const transfer = (fromName: string, fromVessel: string, index: number, toName: string, toVessel: string) => {
      const fromPrev = structuredClone(scene.bodies[fromName]);
      const removal = removeElement(fromPrev, fromVessel, index);
      const toPrev = structuredClone(scene.bodies[toName]);
      const inserted = insertElement(toPrev, toVessel, removal.element);
      const fromPatch = assertOk(diffBodies(fromPrev, removal.body));
      const toPatch = assertOk(diffBodies(toPrev, inserted));
      history.push({
        steps: [
          { bodyName: fromName, patch: fromPatch, inverse: invertPatch(fromPatch) },
          { bodyName: toName, patch: toPatch, inverse: invertPatch(toPatch) }
        ],
        label: "transfer",
        tag: "construct",
        runId: null
      });
      scene = replaceBodyInScene(scene, fromName, assertOk(applyPatch(fromPrev, fromPatch)));
      scene = replaceBodyInScene(scene, toName, assertOk(applyPatch(toPrev, toPatch)));
      expect(validateScene(scene)).toEqual([]);
    };

    const axeIndex = scene.bodies.pool.vessels.pool.contains!.findIndex((element) => element.id === "boarding-axe");
    transfer("pool", "pool", axeIndex, "main", "left-hand");
    expect(scene.bodies.main.vessels["left-hand"].contains?.some((element) => element.id === "boarding-axe")).toBe(
      true
    );

    const after = [...elementMultiset(scene.bodies.main), ...elementMultiset(scene.bodies.pool)].sort();
    expect(after).toEqual(before);

    // Undo restores both bodies atomically.
    const undoResult = history.undo()!;
    expect(undoResult.steps).toHaveLength(2);
    for (const step of undoResult.steps) {
      scene = replaceBodyInScene(scene, step.bodyName, assertOk(applyPatch(scene.bodies[step.bodyName], step.patch)));
    }
    expect(validateScene(scene)).toEqual([]);
    expect(scene.bodies.pool.vessels.pool.contains?.some((element) => element.id === "boarding-axe")).toBe(true);
    expect(scene.bodies.main.vessels["left-hand"].contains ?? []).toEqual(
      SCENE_PRESETS.find((candidate) => candidate.id === "humanoid")!.scene.bodies.main.vessels["left-hand"]
        .contains ?? []
    );
  });
});

describe("scene source round-trip", () => {
  it("formats and parses every scene preset losslessly", () => {
    for (const preset of SCENE_PRESETS) {
      const source = formatSceneSource(preset.scene, preset.presentation, VIEW);
      const parsed = parseSceneSource(source);
      expect(parsed.scene, preset.id).toEqual(preset.scene);
      expect(parsed.presentation, preset.id).toEqual(preset.presentation);
      expect(parsed.view, preset.id).toEqual(VIEW);
    }
  });

  it("rejects a scene literal that fails paperchain validation", () => {
    const preset = SCENE_PRESETS[0];
    const broken = structuredClone(preset.scene);
    broken.relations.push({ kind: "undeclared", from: "main/head", to: "pool/pool" });
    const source = formatSceneSource(broken, preset.presentation, VIEW);
    expect(() => parseSceneSource(source)).toThrowError(/undeclared/);
  });

  it("maps vessel node ranges per body for editor selection sync", () => {
    const preset = SCENE_PRESETS[0];
    const source = formatSceneSource(preset.scene, preset.presentation, VIEW);
    const ranges = getSceneNodeRanges(source);
    const ids = ranges.map((range) => range.id);
    expect(ids).toContain("main/head");
    expect(ids).toContain("pool/pool");
    for (const range of ranges) {
      expect(range.from).toBeLessThan(range.to);
    }
  });

  it("keeps parseScene's deep-copy ownership (mutating parsed output leaves input alone)", () => {
    const preset = SCENE_PRESETS[0];
    const parsed = assertOk(parseScene(structuredClone(preset.scene)));
    parsed.bodies.main.vessels.head.contains = [];
    expect(preset.scene.bodies.main.vessels.head.contains ?? []).not.toEqual([]);
  });
});
