import { describe, expect, it } from "vitest";
import { insertElement, type Body } from "paperdoll";
import {
  APP_PROFILES,
  DEAD_STATUS,
  PRESET_PROFILES,
  PRESET_SCENE_PROFILES,
  conforms,
  judge,
  judgeAll,
  judgeSceneAll,
  validateSceneProfiles
} from "./profiles";
import { healAll } from "./combat";
import { replaceElementData, severDistalSubtree } from "./workbench";
import { PAPER_DOLL_PRESETS, SCENE_PRESETS } from "./sample-document";
import { addRelation, pruneDanglingRelations, replaceBodyInScene } from "./scene";

const presetBody = (id: string): Body => {
  const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`missing preset ${id}`);
  return structuredClone(preset.document.body);
};

describe("papermold profiles", () => {
  it("ships a valid papermold/v2 document", () => {
    expect(validateSceneProfiles(APP_PROFILES)).toEqual([]);
  });

  it("maps presets to profiles that exist in the document", () => {
    expect(PRESET_PROFILES).toEqual({
      combatant: ["living-combatant", "armored"],
      "powered-mech": ["powered-rig"],
      humanoid: []
    });
    for (const profileIds of Object.values(PRESET_PROFILES)) {
      for (const profileId of profileIds) {
        expect(APP_PROFILES.profiles[profileId]).toBeDefined();
      }
    }
  });

  it("judges the healthy combatant as living, and armored only once armor is worn", () => {
    const body = presetBody("combatant");

    expect(conforms(body, APP_PROFILES, "living-combatant")).toBe(true);
    // Pristine combatant is bare — its armor waits in the scene's pool body.
    expect(conforms(body, APP_PROFILES, "armored")).toBe(false);
    expect(judgeAll(body, PRESET_PROFILES.combatant).map((verdict) => verdict.conforms)).toEqual([true, false]);

    const equipped = insertElement(body, "torso", { kind: "item", type: "mail", id: "worn-mail" });
    expect(conforms(equipped, APP_PROFILES, "armored")).toBe(true);
  });

  it("judges the powered mech as a powered rig", () => {
    const body = presetBody("powered-mech");

    expect(conforms(body, APP_PROFILES, "powered-rig")).toBe(true);
  });

  it("flips living-combatant when the death marker is reified into the torso", () => {
    const dead = insertElement(presetBody("combatant"), "torso", DEAD_STATUS);

    expect(conforms(dead, APP_PROFILES, "living-combatant")).toBe(false);
    const errors = judge(dead, APP_PROFILES, "living-combatant");
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe("$.profiles.living-combatant.vessels.torso.forbids.0");
    // conformance is opt-in per profile: death does not affect the armored judgment
    expect(conforms(insertElement(dead, "torso", { kind: "item", type: "mail", id: "worn-mail" }), APP_PROFILES, "armored")).toBe(true);
  });

  it("cannot see data: zeroed blood and integrity alone do not flip conformance", () => {
    // The relay: papermold never reads element `data`. The sim counts hp/blood
    // there, and judgment only moves when the state is reified structurally.
    let body = presetBody("combatant");
    const contains = body.vessels.torso.contains!;
    const bloodIndex = contains.findIndex((element) => element.kind === "fluid");
    const heartIndex = contains.findIndex((element) => element.id === "heart");
    body = replaceElementData(body, "torso", bloodIndex, { volume: 0, max: 100 } as never);
    const heart = body.vessels.torso.contains![heartIndex].data as { integrity: number };
    body = replaceElementData(body, "torso", heartIndex, { ...heart, integrity: 0 } as never);

    expect(conforms(body, APP_PROFILES, "living-combatant")).toBe(true);
  });

  it("healAll removes the death marker and restores conformance", () => {
    const dead = insertElement(presetBody("combatant"), "torso", DEAD_STATUS);
    expect(conforms(dead, APP_PROFILES, "living-combatant")).toBe(false);

    const healed = healAll(dead);

    expect(healed.vessels.torso.contains!.some((element) => element.kind === "status")).toBe(false);
    expect(conforms(healed, APP_PROFILES, "living-combatant")).toBe(true);
  });

  it("judge names the broken head connection for a decapitated combatant", () => {
    const { body, severed } = severDistalSubtree(presetBody("combatant"), "neck");

    expect(severed).toContain("head");
    expect(conforms(body, APP_PROFILES, "living-combatant")).toBe(false);
    const paths = judge(body, APP_PROFILES, "living-combatant").map((error) => error.path);
    expect(paths).toContain("$.profiles.living-combatant.vessels.head.ports.bottom");
  });
});

describe("papermold/v2 scene profiles (versus arena)", () => {
  const arena = () => {
    const preset = SCENE_PRESETS.find((candidate) => candidate.id === "versus-arena");
    if (!preset) throw new Error("missing versus-arena preset");
    return structuredClone(preset.scene);
  };

  it("maps the versus preset to scene profiles that exist in the document", () => {
    for (const ids of Object.values(PRESET_SCENE_PROFILES)) {
      for (const id of ids) {
        expect(APP_PROFILES.sceneProfiles[id]).toBeDefined();
      }
    }
  });

  it("judges the pristine arena: red armed, blue unarmed, not engaged, a legal duel", () => {
    const verdicts = Object.fromEntries(
      judgeSceneAll(arena(), PRESET_SCENE_PROFILES["versus-arena"]).map((verdict) => [
        verdict.profileId,
        verdict.conforms
      ])
    );
    expect(verdicts).toEqual({
      "armed-red": true,
      "armed-blue": false,
      engaged: false,
      "legal-duel": true
    });
  });

  it("disarms red when the wielding arm is severed and the relation prunes in the same candidate", () => {
    const scene = arena();
    const { body: severed } = severDistalSubtree(structuredClone(scene.bodies.red), "lower-right-arm");
    const candidate = replaceBodyInScene(scene, "red", severed);
    const pruned = pruneDanglingRelations(candidate).scene;

    expect(judgeSceneAll(pruned, ["armed-red"])[0].conforms).toBe(false);
    const errors = judgeSceneAll(pruned, ["armed-red"])[0].errors;
    expect(errors[0].path).toBe("$.sceneProfiles.armed-red.relations.0.atLeast");
    expect(errors[0].message).toContain('participates in 0 counted "wields" relations');
  });

  it("engaged flips when a grapple between red and blue is added, in either stored orientation", () => {
    const grappled = addRelation(arena(), { kind: "grapples", from: "blue/left-hand", to: "red/right-hand" });
    expect(judgeSceneAll(grappled, ["engaged"])[0].conforms).toBe(true);

    // A red-internal grapple does not count: the other endpoint must be blue.
    // (grapples is irreflexive and fromMax 1, so use a fresh arena.)
    expect(judgeSceneAll(arena(), ["engaged"])[0].conforms).toBe(false);
  });

  it("legal-duel fails per witness when a fighter dies (reified status)", () => {
    const scene = arena();
    const dead = insertElement(structuredClone(scene.bodies.blue), "torso", DEAD_STATUS);
    const corpseScene = replaceBodyInScene(scene, "blue", dead);

    const verdict = judgeSceneAll(corpseScene, ["legal-duel"])[0];
    expect(verdict.conforms).toBe(false);
    expect(verdict.errors).toEqual([
      {
        path: "$.sceneProfiles.legal-duel.forAllBodies.0.check.conformsTo",
        message: 'Scene body "blue" does not conform to profile "living-combatant".'
      }
    ]);
    // The pool is excluded, so it never appears as a witness.
    expect(verdict.errors.some((error) => error.message.includes('"pool"'))).toBe(false);
  });
});
