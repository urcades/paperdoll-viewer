import { describe, expect, it } from "vitest";
import { insertElement, type Body } from "paperdoll";
import { APP_PROFILES, DEAD_STATUS, PRESET_PROFILES, conforms, judge, judgeAll, validateProfiles } from "./profiles";
import { healAll } from "./combat";
import { replaceElementData, severDistalSubtree } from "./workbench";
import { PAPER_DOLL_PRESETS } from "./sample-document";

const presetBody = (id: string): Body => {
  const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`missing preset ${id}`);
  return structuredClone(preset.document.body);
};

describe("papermold profiles", () => {
  it("ships a valid profile document", () => {
    expect(validateProfiles(APP_PROFILES)).toEqual([]);
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
