// CHARACTERIZATION ORACLE — frozen pins of current behavior, captured before
// a large refactor. These tests assert literal values observed from the code
// as it exists today (2026-07-10); they are not a specification of desired
// behavior. If a refactor changes any value asserted here, that is a behavior
// change and requires explicit user sign-off before this file is updated.
import { describe, expect, it } from "vitest";
import { type Body } from "paperdoll";
import { advanceTick, applyStrike, bleedRate, deriveCondition, getCombatData, WEAPONS, type Weapon } from "./combat";
import { propagatePower } from "./power";
import { severDistalSubtree } from "./workbench";
import {
  DEFAULT_CANVAS_PADDING,
  DEFAULT_CONNECTOR_LENGTH,
  DEFAULT_NODE_SIZE,
  PAPER_DOLL_PRESETS
} from "./sample-document";
import { formatConstructionSource, parseConstructionSource } from "./construction-source";

const preset = (id: string) => PAPER_DOLL_PRESETS.find((candidate) => candidate.id === id)!;
const combatant = () => structuredClone(preset("combatant").document.body);
const mech = () => structuredClone(preset("powered-mech").document.body);
const weapon = (id: string) => WEAPONS.find((candidate) => candidate.id === id)!;

const layerIntegrities = (body: Body, vessel: string): Record<string, number> => {
  const integrities: Record<string, number> = {};
  for (const element of body.vessels[vessel].contains ?? []) {
    const data = getCombatData(element);
    if (data) integrities[element.id ?? element.kind] = data.integrity;
  }
  return integrities;
};

const strikeScript = (target: string, arms: Weapon, rng: () => number) => {
  let body = combatant();
  const log: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const result = applyStrike(body, target, arms, rng);
    body = result.body;
    log.push(result.log);
  }
  return { body, log };
};

describe("characterization: combat determinism", () => {
  it("dagger to the head at rng 0.5 narrates and damages exactly as pinned", () => {
    const { body, log } = strikeScript("head", weapon("dagger"), () => 0.5);

    expect(log).toEqual([
      "The dagger strikes the head: the skin is shredded!, the fat is pulped!, the muscle is pulped!",
      "The dagger strikes the head: the skull is dented, the brain is mangled",
      "The dagger strikes the head: the skull is fractured, the brain is pulped!"
    ]);
    expect(layerIntegrities(body, "head")).toEqual({ skin: 0, fat: 0, muscle: 0, skull: 10, brain: 0 });
  });

  it("dagger to the head at rng 0.95 narrates and damages exactly as pinned", () => {
    const { body, log } = strikeScript("head", weapon("dagger"), () => 0.95);

    expect(log).toEqual([
      "The dagger strikes the head: the skin is shredded!, the fat is pulped!, the muscle is pulped!",
      "The dagger strikes the head: the skull is chipped, the brain is mangled",
      "The dagger strikes the head: the skull is fractured, the brain is pulped!"
    ]);
    expect(layerIntegrities(body, "head")).toEqual({ skin: 0, fat: 0, muscle: 0, skull: 6, brain: 0 });
  });

  it("sword to the torso at rng 0.5 narrates and damages exactly as pinned", () => {
    const { body, log } = strikeScript("torso", weapon("sword"), () => 0.5);

    expect(log).toEqual([
      "The sword strikes the torso: the skin is shredded!, the fat is pulped!, the muscle is mangled",
      "The sword strikes the torso: the muscle is pulped!, the ribs is chipped, the heart is pulped!, the left-lung is pulped!, the right-lung is pulped!, the guts is damaged",
      "The sword strikes the torso: the ribs is shattered!, the guts is pulped!"
    ]);
    expect(layerIntegrities(body, "torso")).toEqual({
      skin: 0,
      fat: 0,
      muscle: 0,
      ribs: 0,
      heart: 0,
      "left-lung": 0,
      "right-lung": 0,
      guts: 0
    });
  });

  it("sword to the torso at rng 0.95 narrates and damages exactly as pinned", () => {
    const { body, log } = strikeScript("torso", weapon("sword"), () => 0.95);

    expect(log).toEqual([
      "The sword strikes the torso: the skin is shredded!, the fat is pulped!, the muscle is mangled, the ribs is dented, the heart is pulped!, the left-lung is pulped!, the right-lung is mangled, the guts is damaged",
      "The sword strikes the torso: the muscle is pulped!, the ribs is fractured, the right-lung is pulped!, the guts is pulped!",
      "The sword strikes the torso: the ribs is shattered!"
    ]);
    expect(layerIntegrities(body, "torso")).toEqual({
      skin: 0,
      fat: 0,
      muscle: 0,
      ribs: 0,
      heart: 0,
      "left-lung": 0,
      "right-lung": 0,
      guts: 0
    });
  });

  it("warhammer to the left hand at rng 0.5 pulps it exactly as pinned", () => {
    const { body, log } = strikeScript("left-hand", weapon("warhammer"), () => 0.5);

    expect(log).toEqual([
      "The warhammer strikes the left-hand: the skin is shredded!, the fat is pulped!, the muscle is pulped!, the bone is fractured",
      "The warhammer strikes the left-hand: the bone is shattered!, the nerve is severed!, the left-hand is crushed into a pulp!, the blow jars the left-fingers",
      "The warhammer strikes the left-hand: the blow jars the left-fingers"
    ]);
    expect(layerIntegrities(body, "left-hand")).toEqual({ skin: 0, fat: 0, muscle: 0, bone: 0, nerve: 0 });
  });

  it("warhammer to the left hand at rng 0.95 pulps it exactly as pinned", () => {
    const { body, log } = strikeScript("left-hand", weapon("warhammer"), () => 0.95);

    expect(log).toEqual([
      "The warhammer strikes the left-hand: the skin is shredded!, the fat is pulped!, the muscle is pulped!, the bone is shattered!, the left-hand is crushed into a pulp!",
      "The warhammer strikes the left-hand: the blow jars the left-fingers",
      "The warhammer strikes the left-hand: the blow jars the left-fingers"
    ]);
    expect(layerIntegrities(body, "left-hand")).toEqual({ skin: 0, fat: 0, muscle: 0, bone: 0, nerve: 0 });
  });
});

describe("characterization: power propagation", () => {
  const powerSnapshot = (body: Body): Record<string, unknown> => {
    const snapshot: Record<string, unknown> = {};
    for (const [vesselId, vessel] of Object.entries(body.vessels)) {
      for (const element of vessel.contains ?? []) {
        const data = element.data as Record<string, unknown> | undefined;
        if (!data) continue;
        if (element.kind === "module") snapshot[`${vesselId}/module`] = data.powered;
        if (element.kind === "converter") snapshot[`${vesselId}/converter`] = data.active;
        if (element.kind === "cell") snapshot[`${vesselId}/cell`] = data.charge;
      }
    }
    return snapshot;
  };

  it("one pulse powers every module and pump and drains the cells exactly as pinned", () => {
    const { body } = propagatePower(mech());

    // the spare battery in the pool is its own island: it powers the pool
    // spotlight and drains for it, independent of the figure's core cell
    expect(powerSnapshot(body)).toEqual({
      "pool/cell": 59.8,
      "pool/module": true,
      "core/cell": 99,
      "sensor/module": true,
      "left-gun/module": true,
      "right-gun/module": true,
      "pump/converter": true,
      "left-leg/module": true,
      "right-leg/module": true
    });
  });

  it("browns out: the left gun reads unpowered on pulse 101", () => {
    let body = mech();
    const gunPowered = (current: Body) =>
      (current.vessels["left-gun"].contains!.find((element) => element.kind === "module")!.data as {
        powered: boolean;
      }).powered;

    let pulses = 0;
    for (let index = 0; index < 500; index += 1) {
      body = propagatePower(body).body;
      pulses += 1;
      if (index > 0 && !gunPowered(body)) break;
    }

    expect(pulses).toBe(101);
    expect(
      (body.vessels.core.contains!.find((element) => element.kind === "cell")!.data as { charge: number }).charge
    ).toBe(0);
  });
});

describe("characterization: derived conditions", () => {
  it("12 warhammer head strikes at rng 0.5 derive exactly the pinned conditions", () => {
    let body = combatant();
    for (let index = 0; index < 12; index += 1) {
      body = applyStrike(body, "head", weapon("warhammer"), () => 0.5).body;
    }

    expect(deriveCondition(body)).toEqual([
      "dead (brain destroyed)",
      "unconscious from pain",
      "bleeding heavily",
      "head useless",
      "neck useless"
    ]);
  });

  it("a sword torso wound at rng 0.95 bleeds out in exactly 33 ticks with pinned conditions", () => {
    let body = applyStrike(combatant(), "torso", weapon("sword"), () => 0.95).body;
    let ticks = 0;
    while (ticks < 400) {
      const result = advanceTick(body);
      if (!result.changed) break;
      body = result.body;
      ticks += 1;
    }

    expect(ticks).toBe(33);
    expect(deriveCondition(body)).toEqual([
      "dead (heart destroyed)",
      "dead (bled out)",
      "in great pain",
      "bleeding heavily"
    ]);
  });

  it("severing the head via the neck derives exactly the pinned conditions", () => {
    const { body, severed } = severDistalSubtree(combatant(), "neck");

    expect(severed).toContain("head");
    expect(deriveCondition(body)).toEqual(["dead (head severed)"]);
  });
});

describe("characterization: bleed rates", () => {
  it("a dagger surface cut on the left hand bleeds at exactly 1.2", () => {
    const cut = applyStrike(combatant(), "left-hand", weapon("dagger"), () => 0.95).body;
    expect(bleedRate(cut)).toBe(1.2);
  });

  it("a severed head stump bleeds at exactly 3", () => {
    const { body } = severDistalSubtree(combatant(), "neck");
    expect(bleedRate(body)).toBe(3);
  });
});

describe("characterization: structural pins", () => {
  const elementsOf = (body: Body): string[] => {
    const elements: string[] = [];
    const walk = (current: Body): void => {
      for (const vessel of Object.values(current.vessels)) {
        for (const element of vessel.contains ?? []) {
          elements.push(`${element.kind}/${element.id ?? ""}`);
          if (element.body) walk(element.body);
        }
      }
    };
    walk(body);
    return elements.sort();
  };
  const vesselsOf = (body: Body): string[] => Object.keys(body.vessels).sort();

  it("humanoid vessels and elements match the pinned inventory", () => {
    const body = preset("humanoid").document.body;
    expect(vesselsOf(body)).toEqual([
      "back", "body", "face", "feet", "floating", "hands-worn", "head", "left-arm",
      "left-hand", "missile-left", "missile-right", "pool", "right-arm", "right-hand", "thrown"
    ]);
    expect(elementsOf(body)).toEqual([
      "curio/weird-idol", "item/bandage-roll", "item/bedroll", "item/boarding-axe", "item/bolt-case",
      "item/charge-cell", "item/compass", "item/copper-charm", "item/field-kit", "item/folded-tarp",
      "item/goggles", "item/hard-biscuit", "item/iron-circlet", "item/lamp-oil", "item/leather-moccasins",
      "item/message-drone", "item/nested-backpack", "item/quiver", "item/salve-hood", "item/short-bow",
      "item/steel-dagger", "item/torch", "item/trail-rations", "item/twin-blades", "item/wet-recycling-suit"
    ]);
  });

  it("mech vessels and elements match the pinned inventory", () => {
    const body = preset("mech").document.body;
    expect(vesselsOf(body)).toEqual([
      "cockpit", "core", "hips", "left-cannon", "left-leg", "left-shoulder",
      "right-claw", "right-leg", "right-shoulder", "sensors", "stabilizer"
    ]);
    expect(elementsOf(body)).toEqual([
      "item/compact-cell", "item/gyro-foot", "item/hydraulic-strider", "item/hydraulic-strider",
      "item/manipulator", "item/operator-cradle", "item/rail-lance", "item/rangefinder"
    ]);
  });

  it("vehicle vessels and elements match the pinned inventory", () => {
    const body = preset("vehicle").document.body;
    expect(vesselsOf(body)).toEqual([
      "battery", "cabin", "chassis", "front-axle", "rear-axle", "roof", "tow-hitch"
    ]);
    expect(elementsOf(body)).toEqual([
      "item/battery-tray", "item/driver-bench", "item/front-axle", "item/rear-axle",
      "item/roof-rack", "item/tow-hook", "item/utility-chassis"
    ]);
  });

  it("satellite vessels and elements match the pinned inventory", () => {
    const body = preset("satellite").document.body;
    expect(vesselsOf(body)).toEqual(["antenna", "bus", "left-panel", "probe", "right-panel", "thruster"]);
    expect(elementsOf(body)).toEqual([
      "item/dust-sampler", "item/high-gain-dish", "item/instrument-bus",
      "item/ion-thruster", "item/port-array", "item/starboard-array"
    ]);
  });

  it("hand vessels and elements match the pinned inventory", () => {
    const body = preset("hand").document.body;
    expect(vesselsOf(body)).toEqual([
      "index-base", "index-tip", "middle-base", "middle-tip", "palm", "pinky-base", "pinky-tip",
      "pool", "ring-base", "ring-tip", "thumb-base", "thumb-tip", "wrist"
    ]);
    expect(elementsOf(body)).toEqual([
      "item/brass-ring", "item/copper-bangle", "item/cursed-ring", "item/engraved-band", "item/gold-ring",
      "item/iron-band", "item/opal-ring", "item/pinky-signet", "item/ruby-ring", "item/silk-glove", "item/silver-band"
    ]);
  });

  it("combatant vessels and elements match the pinned inventory", () => {
    const body = preset("combatant").document.body;
    expect(vesselsOf(body)).toEqual([
      "head", "hips", "left-fingers", "left-foot", "left-hand", "left-leg", "lower-left-arm",
      "lower-right-arm", "neck", "pool", "right-fingers", "right-foot", "right-hand", "right-leg",
      "torso", "upper-left-arm", "upper-right-arm"
    ]);
    expect(elementsOf(body)).toEqual([
      "fluid/blood",
      "item/iron-gauntlets", "item/iron-helm", "item/leather-boots", "item/leather-cap",
      "item/leather-jerkin", "item/mail-shirt",
      "organ/brain", "organ/guts", "organ/heart", "organ/left-lung", "organ/right-lung",
      "tissue/bone", "tissue/bone", "tissue/bone", "tissue/bone", "tissue/bone", "tissue/bone",
      "tissue/bone", "tissue/bone", "tissue/bone", "tissue/bone", "tissue/bone", "tissue/bone",
      "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat",
      "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat", "tissue/fat",
      "tissue/fat",
      "tissue/muscle", "tissue/muscle", "tissue/muscle", "tissue/muscle", "tissue/muscle", "tissue/muscle",
      "tissue/muscle", "tissue/muscle", "tissue/muscle", "tissue/muscle", "tissue/muscle", "tissue/muscle",
      "tissue/muscle", "tissue/muscle", "tissue/muscle", "tissue/muscle",
      "tissue/nerve", "tissue/nerve", "tissue/nerve", "tissue/nerve", "tissue/nerve", "tissue/nerve",
      "tissue/nerve", "tissue/nerve",
      "tissue/pelvis", "tissue/ribs",
      "tissue/skin", "tissue/skin", "tissue/skin", "tissue/skin", "tissue/skin", "tissue/skin",
      "tissue/skin", "tissue/skin", "tissue/skin", "tissue/skin", "tissue/skin", "tissue/skin",
      "tissue/skin", "tissue/skin", "tissue/skin", "tissue/skin",
      "tissue/skull", "tissue/spinal-cord", "tissue/spine"
    ]);
  });

  it("powered-mech vessels and elements match the pinned inventory", () => {
    const body = preset("powered-mech").document.body;
    expect(vesselsOf(body)).toEqual([
      "core", "hips", "left-gun", "left-leg", "pool", "pump", "right-gun", "right-leg", "sensor", "spine"
    ]);
    expect(elementsOf(body)).toEqual([
      "cell/battery", "cell/spare-battery",
      "conduit/core-wire", "conduit/hips-pipe", "conduit/pump-pipe", "conduit/pump-wire",
      "conduit/spare-pipe", "conduit/spare-wire", "conduit/spine-wire",
      "converter/pump",
      "module/left-gun", "module/left-leg", "module/right-gun", "module/right-leg",
      "module/sensor", "module/spotlight"
    ]);
  });
});

describe("characterization: editor round-trip", () => {
  it("format then parse round-trips every preset losslessly", () => {
    for (const current of PAPER_DOLL_PRESETS) {
      const source = formatConstructionSource(current.document, current.presentation, {
        node: DEFAULT_NODE_SIZE,
        connector: DEFAULT_CONNECTOR_LENGTH,
        padding: DEFAULT_CANVAS_PADDING
      });
      const parsed = parseConstructionSource(source);

      expect(parsed.document).toEqual(current.document);
      expect(parsed.presentation).toEqual(current.presentation);
      expect(parsed.view).toEqual({ node: 33, connector: 55, padding: 0 });
    }
  });
});
