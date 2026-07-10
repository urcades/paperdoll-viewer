import { PAPER_DOLL_PROTOCOL, type PaperDollDocument } from "paperdoll";

export const DEFAULT_NODE_SIZE = 33;
export const DEFAULT_CONNECTOR_LENGTH = 55;
export const DEFAULT_CANVAS_PADDING = 0;

export type VesselPresentation = {
  label: string;
  icon?: string;
};

export type PaperDollPreset = {
  id: string;
  name: string;
  document: PaperDollDocument;
  presentation: Record<string, VesselPresentation>;
};

const HUMANOID_PRESENTATION: Record<string, VesselPresentation> = {
  face: { label: "Face", icon: "A" },
  head: { label: "Head", icon: "B" },
  "hands-worn": { label: "Worn on\nHands", icon: "C" },
  "left-hand": { label: "*Left Hand", icon: "D" },
  "left-arm": { label: "Left Arm", icon: "E" },
  body: { label: "Body", icon: "@" },
  "right-arm": { label: "Right Arm", icon: "G" },
  "right-hand": { label: "Right Hand", icon: "H" },
  back: { label: "Worn on\nBack", icon: "I" },
  feet: { label: "Feet", icon: "J" },
  "missile-left": { label: "Left\nMissile\nWeapon", icon: "K" },
  "missile-right": { label: "Right\nMissile\nWeapon", icon: "L" },
  floating: { label: "Floating\nNearby", icon: "M" },
  thrown: { label: "Thrown\nWeapon", icon: "N" }
};

const item = (type: string, id: string) => ({ kind: "item", type, id });
const bodyItem = (type: string, id: string, body: PaperDollDocument["body"]) => ({ kind: "item", type, id, body });
const accepts = (...types: string[]) => types.map((type) => ({ kind: "item", type }));

const BACKPACK_BODY: PaperDollDocument["body"] = {
  root: "pack-shell",
  vessels: {
    "top-pocket": {
      accepts: accepts("tool"),
      contains: [item("tool", "compass")],
      ports: { bottom: { vessel: "pack-shell", side: "top" } }
    },
    "left-pouch": {
      accepts: accepts("supply"),
      contains: [item("supply", "bandage-roll")],
      ports: { right: { vessel: "pack-shell", side: "left" } }
    },
    "pack-shell": {
      accepts: accepts("storage"),
      contains: [item("storage", "folded-tarp")],
      ports: {
        top: { vessel: "top-pocket", side: "bottom" },
        left: { vessel: "left-pouch", side: "right" },
        right: { vessel: "right-pouch", side: "left" },
        bottom: { vessel: "bedroll", side: "top" }
      }
    },
    "right-pouch": {
      accepts: accepts("supply"),
      contains: [item("supply", "lamp-oil")],
      ports: { left: { vessel: "pack-shell", side: "right" } }
    },
    bedroll: {
      accepts: accepts("camp"),
      contains: [item("camp", "bedroll")],
      ports: { top: { vessel: "pack-shell", side: "bottom" } }
    },
    "loose-ration": {
      accepts: accepts("food"),
      contains: [item("food", "hard-biscuit")],
    },
    "loose-charm": {
      accepts: accepts("trinket"),
      contains: [item("trinket", "copper-charm")],
    }
  }
};

const DRONE_BODY: PaperDollDocument["body"] = {
  root: "drone-core",
  vessels: {
    rotor: {
      accepts: accepts("rotor"),
      contains: [item("rotor", "twin-blades")],
      ports: { bottom: { vessel: "drone-core", side: "top" } }
    },
    "drone-core": {
      accepts: accepts("battery"),
      contains: [item("battery", "charge-cell")],
      ports: {
        top: { vessel: "rotor", side: "bottom" },
        bottom: { vessel: "sling", side: "top" }
      }
    },
    sling: {
      accepts: accepts("parcel"),
      ports: { top: { vessel: "drone-core", side: "bottom" } }
    }
  }
};

// The item pool: a free vessel with open `accepts`, rendered as the play-mode
// panel instead of a canvas node. Everything in it moves via moveElement.
const HUMANOID_POOL = [
  item("head", "iron-circlet"),
  item("missile", "bolt-case"),
  item("weapon", "boarding-axe"),
  item("food", "trail-rations"),
  { kind: "curio", id: "weird-idol" },
  {
    kind: "item",
    type: "tool",
    id: "field-kit",
    data: { weight: 3, notes: "Sealed against rain" }
  },
  bodyItem("body", "message-drone", DRONE_BODY)
];

const HUMANOID_DOCUMENT: PaperDollDocument = {
  protocol: PAPER_DOLL_PROTOCOL,
  body: {
    root: "body",
    vessels: {
      pool: {
        contains: HUMANOID_POOL
      },
      face: {
        accepts: accepts("face"),
        contains: [item("face", "goggles")],
        ports: { bottom: { vessel: "head", side: "top" } }
      },
      head: {
        accepts: accepts("head"),
        contains: [item("head", "salve-hood")],
        ports: {
          top: { vessel: "face", side: "bottom" },
          bottom: { vessel: "body", side: "top" }
        }
      },
      "hands-worn": {
        accepts: accepts("hands"),
        ports: { right: { vessel: "left-hand", side: "left" } }
      },
      "left-hand": {
        accepts: accepts("weapon", "tool"),
        contains: [item("weapon", "steel-dagger")],
        ports: {
          left: { vessel: "hands-worn", side: "right" },
          right: { vessel: "left-arm", side: "left" }
        }
      },
      "left-arm": {
        accepts: accepts("arm"),
        ports: {
          left: { vessel: "left-hand", side: "right" },
          right: { vessel: "body", side: "left" }
        }
      },
      body: {
        accepts: accepts("body"),
        contains: [item("body", "wet-recycling-suit")],
        ports: {
          top: { vessel: "head", side: "bottom" },
          left: { vessel: "left-arm", side: "right" },
          right: { vessel: "right-arm", side: "left" },
          bottom: { vessel: "back", side: "top" }
        }
      },
      "right-arm": {
        accepts: accepts("arm"),
        ports: {
          left: { vessel: "body", side: "right" },
          right: { vessel: "right-hand", side: "left" }
        }
      },
      "right-hand": {
        accepts: accepts("weapon", "tool"),
        contains: [item("tool", "torch")],
        ports: { left: { vessel: "right-arm", side: "right" } }
      },
      back: {
        accepts: accepts("back", "body"),
        contains: [bodyItem("body", "nested-backpack", BACKPACK_BODY)],
        ports: {
          top: { vessel: "body", side: "bottom" },
          bottom: { vessel: "feet", side: "top" }
        }
      },
      feet: {
        accepts: accepts("feet"),
        contains: [item("feet", "leather-moccasins")],
        ports: {
          top: { vessel: "back", side: "bottom" },
          right: { vessel: "missile-left", side: "left" }
        }
      },
      "missile-left": {
        accepts: accepts("missile"),
        contains: [item("missile", "short-bow")],
        ports: {
          left: { vessel: "feet", side: "right" },
          right: { vessel: "missile-right", side: "left" }
        }
      },
      "missile-right": {
        accepts: accepts("missile"),
        contains: [item("missile", "quiver")],
        ports: { left: { vessel: "missile-left", side: "right" } }
      },
      floating: {
        accepts: accepts("floating")
      },
      thrown: {
        accepts: accepts("thrown")
      }
    }
  }
};

const MECH_DOCUMENT: PaperDollDocument = {
  protocol: PAPER_DOLL_PROTOCOL,
  body: {
    root: "core",
    vessels: {
      sensors: {
        accepts: accepts("sensor"),
        contains: [item("sensor", "rangefinder")],
        ports: { bottom: { vessel: "cockpit", side: "top" } }
      },
      cockpit: {
        accepts: accepts("pilot"),
        contains: [item("pilot", "operator-cradle")],
        ports: {
          top: { vessel: "sensors", side: "bottom" },
          bottom: { vessel: "core", side: "top" }
        }
      },
      core: {
        accepts: accepts("reactor"),
        contains: [item("reactor", "compact-cell")],
        ports: {
          top: { vessel: "cockpit", side: "bottom" },
          left: { vessel: "left-shoulder", side: "right" },
          right: { vessel: "right-shoulder", side: "left" },
          bottom: { vessel: "hips", side: "top" }
        }
      },
      "left-shoulder": {
        accepts: accepts("mount"),
        ports: {
          left: { vessel: "left-cannon", side: "right" },
          right: { vessel: "core", side: "left" }
        }
      },
      "left-cannon": {
        accepts: accepts("weapon"),
        contains: [item("weapon", "rail-lance")],
        ports: { right: { vessel: "left-shoulder", side: "left" } }
      },
      "right-shoulder": {
        accepts: accepts("mount"),
        ports: {
          left: { vessel: "core", side: "right" },
          right: { vessel: "right-claw", side: "left" }
        }
      },
      "right-claw": {
        accepts: accepts("tool"),
        contains: [item("tool", "manipulator")],
        ports: { left: { vessel: "right-shoulder", side: "right" } }
      },
      hips: {
        accepts: accepts("drive"),
        ports: {
          top: { vessel: "core", side: "bottom" },
          left: { vessel: "left-leg", side: "right" },
          right: { vessel: "right-leg", side: "left" },
          bottom: { vessel: "stabilizer", side: "top" }
        }
      },
      "left-leg": {
        accepts: accepts("leg"),
        contains: [item("leg", "hydraulic-strider")],
        ports: { right: { vessel: "hips", side: "left" } }
      },
      "right-leg": {
        accepts: accepts("leg"),
        contains: [item("leg", "hydraulic-strider")],
        ports: { left: { vessel: "hips", side: "right" } }
      },
      stabilizer: {
        accepts: accepts("anchor"),
        contains: [item("anchor", "gyro-foot")],
        ports: { top: { vessel: "hips", side: "bottom" } }
      }
    }
  }
};

const MECH_PRESENTATION: Record<string, VesselPresentation> = {
  sensors: { label: "Sensor\nMast", icon: "A" },
  cockpit: { label: "Cockpit", icon: "B" },
  core: { label: "Core", icon: "@" },
  "left-shoulder": { label: "Left\nShoulder", icon: "C" },
  "left-cannon": { label: "Rail\nLance", icon: "D" },
  "right-shoulder": { label: "Right\nShoulder", icon: "E" },
  "right-claw": { label: "Claw", icon: "F" },
  hips: { label: "Hip\nDrive", icon: "G" },
  "left-leg": { label: "Left\nLeg", icon: "H" },
  "right-leg": { label: "Right\nLeg", icon: "I" },
  stabilizer: { label: "Gyro\nFoot", icon: "J" }
};

const VEHICLE_DOCUMENT: PaperDollDocument = {
  protocol: PAPER_DOLL_PROTOCOL,
  body: {
    root: "chassis",
    vessels: {
      roof: {
        accepts: accepts("cargo"),
        contains: [item("cargo", "roof-rack")],
        ports: { bottom: { vessel: "cabin", side: "top" } }
      },
      cabin: {
        accepts: accepts("crew"),
        contains: [item("crew", "driver-bench")],
        ports: {
          top: { vessel: "roof", side: "bottom" },
          bottom: { vessel: "chassis", side: "top" }
        }
      },
      "front-axle": {
        accepts: accepts("wheel"),
        contains: [item("wheel", "front-axle")],
        ports: { right: { vessel: "chassis", side: "left" } }
      },
      chassis: {
        accepts: accepts("frame"),
        contains: [item("frame", "utility-chassis")],
        ports: {
          top: { vessel: "cabin", side: "bottom" },
          left: { vessel: "front-axle", side: "right" },
          right: { vessel: "rear-axle", side: "left" },
          bottom: { vessel: "battery", side: "top" }
        }
      },
      "rear-axle": {
        accepts: accepts("wheel"),
        contains: [item("wheel", "rear-axle")],
        ports: {
          left: { vessel: "chassis", side: "right" },
          right: { vessel: "tow-hitch", side: "left" }
        }
      },
      "tow-hitch": {
        accepts: accepts("trailer"),
        contains: [item("trailer", "tow-hook")],
        ports: { left: { vessel: "rear-axle", side: "right" } }
      },
      battery: {
        accepts: accepts("power"),
        contains: [item("power", "battery-tray")],
        ports: { top: { vessel: "chassis", side: "bottom" } }
      }
    }
  }
};

const VEHICLE_PRESENTATION: Record<string, VesselPresentation> = {
  roof: { label: "Roof\nRack", icon: "A" },
  cabin: { label: "Cabin", icon: "B" },
  "front-axle": { label: "Front\nAxle", icon: "C" },
  chassis: { label: "Chassis", icon: "@" },
  "rear-axle": { label: "Rear\nAxle", icon: "D" },
  "tow-hitch": { label: "Tow\nHitch", icon: "E" },
  battery: { label: "Battery", icon: "F" }
};

const SATELLITE_DOCUMENT: PaperDollDocument = {
  protocol: PAPER_DOLL_PROTOCOL,
  body: {
    root: "bus",
    vessels: {
      antenna: {
        accepts: accepts("signal"),
        contains: [item("signal", "high-gain-dish")],
        ports: { bottom: { vessel: "bus", side: "top" } }
      },
      "left-panel": {
        accepts: accepts("solar"),
        contains: [item("solar", "port-array")],
        ports: { right: { vessel: "bus", side: "left" } }
      },
      bus: {
        accepts: accepts("payload"),
        contains: [item("payload", "instrument-bus")],
        ports: {
          top: { vessel: "antenna", side: "bottom" },
          left: { vessel: "left-panel", side: "right" },
          right: { vessel: "right-panel", side: "left" },
          bottom: { vessel: "thruster", side: "top" }
        }
      },
      "right-panel": {
        accepts: accepts("solar"),
        contains: [item("solar", "starboard-array")],
        ports: { left: { vessel: "bus", side: "right" } }
      },
      thruster: {
        accepts: accepts("propulsion"),
        contains: [item("propulsion", "ion-thruster")],
        ports: {
          top: { vessel: "bus", side: "bottom" },
          bottom: { vessel: "probe", side: "top" }
        }
      },
      probe: {
        accepts: accepts("sensor"),
        contains: [item("sensor", "dust-sampler")],
        ports: { top: { vessel: "thruster", side: "bottom" } }
      }
    }
  }
};

const SATELLITE_PRESENTATION: Record<string, VesselPresentation> = {
  antenna: { label: "Antenna", icon: "A" },
  "left-panel": { label: "Port\nPanel", icon: "B" },
  bus: { label: "Bus", icon: "@" },
  "right-panel": { label: "Starboard\nPanel", icon: "C" },
  thruster: { label: "Thruster", icon: "D" },
  probe: { label: "Probe", icon: "E" }
};

// A hand as a paper doll: the palm is the root, the four finger bases form a
// horizontal knuckle row, tips stack above, the thumb hangs off the palm's
// side. Every segment accepts item/ring, and `contains` being a list means a
// single knuckle can stack several rings.
const ring = (id: string) => item("ring", id);

const HAND_DOCUMENT: PaperDollDocument = {
  protocol: PAPER_DOLL_PROTOCOL,
  body: {
    root: "palm",
    vessels: {
      pool: {
        contains: [
          ring("ruby-ring"),
          ring("opal-ring"),
          ring("iron-band"),
          ring("brass-ring"),
          ring("cursed-ring"),
          item("glove", "silk-glove"),
          item("bracelet", "copper-bangle")
        ]
      },
      palm: {
        accepts: accepts("glove"),
        ports: {
          top: { vessel: "middle-base", side: "bottom" },
          left: { vessel: "thumb-base", side: "right" },
          bottom: { vessel: "wrist", side: "top" }
        }
      },
      wrist: {
        accepts: accepts("bracelet"),
        ports: { top: { vessel: "palm", side: "bottom" } }
      },
      "thumb-base": {
        accepts: accepts("ring"),
        ports: {
          right: { vessel: "palm", side: "left" },
          left: { vessel: "thumb-tip", side: "right" }
        }
      },
      "thumb-tip": {
        accepts: accepts("ring"),
        ports: { right: { vessel: "thumb-base", side: "left" } }
      },
      "index-base": {
        accepts: accepts("ring"),
        ports: {
          right: { vessel: "middle-base", side: "left" },
          top: { vessel: "index-tip", side: "bottom" }
        }
      },
      "index-tip": {
        accepts: accepts("ring"),
        ports: { bottom: { vessel: "index-base", side: "top" } }
      },
      "middle-base": {
        accepts: accepts("ring"),
        contains: [ring("silver-band")],
        ports: {
          bottom: { vessel: "palm", side: "top" },
          left: { vessel: "index-base", side: "right" },
          right: { vessel: "ring-base", side: "left" },
          top: { vessel: "middle-tip", side: "bottom" }
        }
      },
      "middle-tip": {
        accepts: accepts("ring"),
        ports: { bottom: { vessel: "middle-base", side: "top" } }
      },
      "ring-base": {
        accepts: accepts("ring"),
        contains: [ring("gold-ring"), ring("engraved-band")],
        ports: {
          left: { vessel: "middle-base", side: "right" },
          right: { vessel: "pinky-base", side: "left" },
          top: { vessel: "ring-tip", side: "bottom" }
        }
      },
      "ring-tip": {
        accepts: accepts("ring"),
        ports: { bottom: { vessel: "ring-base", side: "top" } }
      },
      "pinky-base": {
        accepts: accepts("ring"),
        ports: {
          left: { vessel: "ring-base", side: "right" },
          top: { vessel: "pinky-tip", side: "bottom" }
        }
      },
      "pinky-tip": {
        accepts: accepts("ring"),
        contains: [ring("pinky-signet")],
        ports: { bottom: { vessel: "pinky-base", side: "top" } }
      }
    }
  }
};

const HAND_PRESENTATION: Record<string, VesselPresentation> = {
  palm: { label: "Palm", icon: "@" },
  wrist: { label: "Wrist", icon: "W" },
  "thumb-base": { label: "Thumb\nBase", icon: "A" },
  "thumb-tip": { label: "Thumb\nTip", icon: "B" },
  "index-base": { label: "Index\nBase", icon: "C" },
  "index-tip": { label: "Index\nTip", icon: "D" },
  "middle-base": { label: "Middle\nBase", icon: "E" },
  "middle-tip": { label: "Middle\nTip", icon: "F" },
  "ring-base": { label: "Ring\nBase", icon: "G" },
  "ring-tip": { label: "Ring\nTip", icon: "H" },
  "pinky-base": { label: "Pinky\nBase", icon: "I" },
  "pinky-tip": { label: "Pinky\nTip", icon: "J" }
};

// The combatant: a simplified Dwarf Fortress health model. Each part vessel
// contains an ordered stack of tissue/organ elements (list order = penetration
// order) whose data carries material properties and integrity; armor is worn
// as typed items walked before the tissue. See docs/superpowers/specs/
// 2026-07-10-combatant-demo-design.md and src/combat.ts.
type MaterialSpec = { shearY: number; shearF: number; impactY: number; impactF: number; absorb: number };

const TISSUE_MATERIALS: Record<string, MaterialSpec> = {
  skin: { shearY: 20, shearF: 40, impactY: 15, impactF: 50, absorb: 0.1 },
  fat: { shearY: 25, shearF: 45, impactY: 20, impactF: 60, absorb: 0.35 },
  muscle: { shearY: 35, shearF: 60, impactY: 30, impactF: 70, absorb: 0.25 },
  bone: { shearY: 115, shearF: 130, impactY: 40, impactF: 80, absorb: 0.2 },
  organ: { shearY: 15, shearF: 30, impactY: 20, impactF: 60, absorb: 0.15 },
  nerve: { shearY: 30, shearF: 30, impactY: 45, impactF: 40, absorb: 0.05 }
};

const ARMOR_MATERIALS: Record<string, MaterialSpec> = {
  iron: { shearY: 145, shearF: 160, impactY: 70, impactF: 120, absorb: 0.15 },
  leather: { shearY: 45, shearF: 60, impactY: 25, impactF: 70, absorb: 0.5 }
};

const tissue = (type: keyof typeof TISSUE_MATERIALS, id: string, max: number) => ({
  kind: "tissue",
  type: type as string,
  id,
  data: { integrity: max, max, material: TISSUE_MATERIALS[type] }
});

const organ = (id: string, max: number, vital = false) => ({
  kind: "organ",
  type: "organ",
  id,
  data: { integrity: max, max, material: TISSUE_MATERIALS.organ, ...(vital ? { vital: true } : {}) }
});

const armorItem = (type: string, id: string, metal: keyof typeof ARMOR_MATERIALS, max: number) => ({
  kind: "item",
  type,
  id,
  data: { integrity: max, max, material: ARMOR_MATERIALS[metal] }
});

const fleshLayers = (scale: number, withNerve: boolean) => [
  tissue("skin", "skin", Math.round(20 * scale)),
  tissue("fat", "fat", Math.round(15 * scale)),
  tissue("muscle", "muscle", Math.round(30 * scale)),
  tissue("bone", "bone", Math.round(35 * scale)),
  ...(withNerve ? [tissue("nerve", "nerve", 10)] : [])
];

const partAccepts = (...armorTypes: string[]) => [
  { kind: "tissue" },
  { kind: "organ" },
  ...armorTypes.map((type) => ({ kind: "item", type }))
];

const COMBATANT_DOCUMENT: PaperDollDocument = {
  protocol: PAPER_DOLL_PROTOCOL,
  body: {
    root: "torso",
    vessels: {
      pool: {
        contains: [
          armorItem("helm", "iron-helm", "iron", 40),
          armorItem("helm", "leather-cap", "leather", 25),
          armorItem("mail", "mail-shirt", "iron", 60),
          armorItem("mail", "leather-jerkin", "leather", 35),
          armorItem("gauntlet", "iron-gauntlets", "iron", 30),
          armorItem("boot", "leather-boots", "leather", 25)
        ]
      },
      head: {
        accepts: partAccepts("helm"),
        contains: [
          tissue("skin", "skin", 15),
          tissue("fat", "fat", 10),
          tissue("muscle", "muscle", 15),
          tissue("bone", "skull", 40),
          organ("brain", 20, true)
        ],
        ports: { bottom: { vessel: "neck", side: "top" } }
      },
      neck: {
        accepts: partAccepts(),
        contains: [
          tissue("skin", "skin", 12),
          tissue("muscle", "muscle", 18),
          tissue("bone", "spine", 30),
          tissue("nerve", "spinal-cord", 10)
        ],
        ports: {
          top: { vessel: "head", side: "bottom" },
          bottom: { vessel: "torso", side: "top" }
        }
      },
      "upper-left-arm": {
        accepts: partAccepts(),
        contains: fleshLayers(1, true),
        ports: {
          right: { vessel: "torso", side: "left" },
          left: { vessel: "lower-left-arm", side: "right" }
        }
      },
      "lower-left-arm": {
        accepts: partAccepts(),
        contains: fleshLayers(0.7, true),
        ports: {
          right: { vessel: "upper-left-arm", side: "left" },
          left: { vessel: "left-hand", side: "right" }
        }
      },
      "left-hand": {
        accepts: partAccepts("gauntlet"),
        contains: fleshLayers(0.5, true),
        ports: {
          right: { vessel: "lower-left-arm", side: "left" },
          left: { vessel: "left-fingers", side: "right" }
        }
      },
      "left-fingers": {
        accepts: partAccepts(),
        contains: fleshLayers(0.3, false),
        ports: { right: { vessel: "left-hand", side: "left" } }
      },
      torso: {
        accepts: [{ kind: "tissue" }, { kind: "organ" }, { kind: "fluid" }, { kind: "item", type: "mail" }],
        contains: [
          { kind: "fluid", id: "blood", data: { volume: 100, max: 100 } },
          tissue("skin", "skin", 25),
          tissue("fat", "fat", 20),
          tissue("muscle", "muscle", 40),
          tissue("bone", "ribs", 45),
          organ("heart", 15, true),
          organ("left-lung", 15),
          organ("right-lung", 15),
          organ("guts", 25)
        ],
        ports: {
          top: { vessel: "neck", side: "bottom" },
          left: { vessel: "upper-left-arm", side: "right" },
          right: { vessel: "upper-right-arm", side: "left" },
          bottom: { vessel: "hips", side: "top" }
        }
      },
      "upper-right-arm": {
        accepts: partAccepts(),
        contains: fleshLayers(1, true),
        ports: {
          left: { vessel: "torso", side: "right" },
          right: { vessel: "lower-right-arm", side: "left" }
        }
      },
      "lower-right-arm": {
        accepts: partAccepts(),
        contains: fleshLayers(0.7, true),
        ports: {
          left: { vessel: "upper-right-arm", side: "right" },
          right: { vessel: "right-hand", side: "left" }
        }
      },
      "right-hand": {
        accepts: partAccepts("gauntlet"),
        contains: fleshLayers(0.5, true),
        ports: {
          left: { vessel: "lower-right-arm", side: "right" },
          right: { vessel: "right-fingers", side: "left" }
        }
      },
      "right-fingers": {
        accepts: partAccepts(),
        contains: fleshLayers(0.3, false),
        ports: { left: { vessel: "right-hand", side: "right" } }
      },
      hips: {
        accepts: partAccepts(),
        contains: [
          tissue("skin", "skin", 18),
          tissue("fat", "fat", 15),
          tissue("muscle", "muscle", 30),
          tissue("bone", "pelvis", 40)
        ],
        ports: {
          top: { vessel: "torso", side: "bottom" },
          left: { vessel: "left-leg", side: "right" },
          right: { vessel: "right-leg", side: "left" }
        }
      },
      "left-leg": {
        accepts: partAccepts(),
        contains: fleshLayers(1.2, true),
        ports: {
          right: { vessel: "hips", side: "left" },
          bottom: { vessel: "left-foot", side: "top" }
        }
      },
      "right-leg": {
        accepts: partAccepts(),
        contains: fleshLayers(1.2, true),
        ports: {
          left: { vessel: "hips", side: "right" },
          bottom: { vessel: "right-foot", side: "top" }
        }
      },
      "left-foot": {
        accepts: partAccepts("boot"),
        contains: fleshLayers(0.5, false),
        ports: { top: { vessel: "left-leg", side: "bottom" } }
      },
      "right-foot": {
        accepts: partAccepts("boot"),
        contains: fleshLayers(0.5, false),
        ports: { top: { vessel: "right-leg", side: "bottom" } }
      }
    }
  }
};

const COMBATANT_PRESENTATION: Record<string, VesselPresentation> = {
  head: { label: "Head", icon: "A" },
  neck: { label: "Neck", icon: "N" },
  "upper-left-arm": { label: "Upper\nL Arm", icon: "C" },
  "lower-left-arm": { label: "Lower\nL Arm", icon: "c" },
  "left-hand": { label: "Left\nHand", icon: "B" },
  "left-fingers": { label: "L\nFingers", icon: "b" },
  torso: { label: "Torso", icon: "@" },
  "upper-right-arm": { label: "Upper\nR Arm", icon: "D" },
  "lower-right-arm": { label: "Lower\nR Arm", icon: "d" },
  "right-hand": { label: "Right\nHand", icon: "E" },
  "right-fingers": { label: "R\nFingers", icon: "e" },
  hips: { label: "Hips", icon: "F" },
  "left-leg": { label: "Left\nLeg", icon: "G" },
  "right-leg": { label: "Right\nLeg", icon: "H" },
  "left-foot": { label: "Left\nFoot", icon: "I" },
  "right-foot": { label: "Right\nFoot", icon: "J" }
};

// The powered mech: a two-medium power network layered over topology. Power
// floods from the battery (electric) through wire-conducting vessels to loads
// and the pump; the pump converts electric -> hydraulic and drives the legs.
// A vessel conducts a medium if it contains an element referencing it, so the
// live network is derived from containment + ports together (see power.ts).
// Ids are unique per element (law 8) and, since conduits are fungible and get
// dragged between vessels in play mode, unique across the whole mech too.
const cell = (id: string, charge: number) => ({ kind: "cell", id, data: { charge, max: charge, medium: "electric" } });
const wire = (id: string) => ({ kind: "conduit", id, data: { medium: "electric" } });
const pipe = (id: string) => ({ kind: "conduit", id, data: { medium: "hydraulic" } });
const load = (id: string, medium: string, draw: number) => ({
  kind: "module",
  id,
  data: { draw, medium, powered: false }
});
const converter = () => ({
  kind: "converter",
  id: "pump",
  data: { inMedium: "electric", inDraw: 8, outMedium: "hydraulic", active: false }
});
const powerAccepts = [{ kind: "cell" }, { kind: "conduit" }, { kind: "module" }, { kind: "converter" }];

const POWERED_MECH_DOCUMENT: PaperDollDocument = {
  protocol: PAPER_DOLL_PROTOCOL,
  body: {
    root: "core",
    vessels: {
      pool: {
        contains: [cell("spare-battery", 60), load("spotlight", "electric", 3), pipe("spare-pipe"), wire("spare-wire")]
      },
      core: {
        accepts: powerAccepts,
        contains: [cell("battery", 100), wire("core-wire")],
        ports: {
          top: { vessel: "sensor", side: "bottom" },
          left: { vessel: "left-gun", side: "right" },
          right: { vessel: "right-gun", side: "left" },
          bottom: { vessel: "spine", side: "top" }
        }
      },
      sensor: {
        accepts: powerAccepts,
        contains: [load("sensor", "electric", 2)],
        ports: { bottom: { vessel: "core", side: "top" } }
      },
      "left-gun": {
        accepts: powerAccepts,
        contains: [load("left-gun", "electric", 5)],
        ports: { right: { vessel: "core", side: "left" } }
      },
      "right-gun": {
        accepts: powerAccepts,
        contains: [load("right-gun", "electric", 5)],
        ports: { left: { vessel: "core", side: "right" } }
      },
      spine: {
        accepts: powerAccepts,
        contains: [wire("spine-wire")],
        ports: {
          top: { vessel: "core", side: "bottom" },
          bottom: { vessel: "pump", side: "top" }
        }
      },
      pump: {
        accepts: powerAccepts,
        contains: [converter(), wire("pump-wire"), pipe("pump-pipe")],
        ports: {
          top: { vessel: "spine", side: "bottom" },
          bottom: { vessel: "hips", side: "top" }
        }
      },
      hips: {
        accepts: powerAccepts,
        contains: [pipe("hips-pipe")],
        ports: {
          top: { vessel: "pump", side: "bottom" },
          left: { vessel: "left-leg", side: "right" },
          right: { vessel: "right-leg", side: "left" }
        }
      },
      "left-leg": {
        accepts: powerAccepts,
        contains: [load("left-leg", "hydraulic", 4)],
        ports: { right: { vessel: "hips", side: "left" } }
      },
      "right-leg": {
        accepts: powerAccepts,
        contains: [load("right-leg", "hydraulic", 4)],
        ports: { left: { vessel: "hips", side: "right" } }
      }
    }
  }
};

const POWERED_MECH_PRESENTATION: Record<string, VesselPresentation> = {
  sensor: { label: "Sensor", icon: "S" },
  "left-gun": { label: "Left\nGun", icon: "L" },
  core: { label: "Core", icon: "@" },
  "right-gun": { label: "Right\nGun", icon: "R" },
  spine: { label: "Spine", icon: "|" },
  pump: { label: "Pump", icon: "P" },
  hips: { label: "Hips", icon: "H" },
  "left-leg": { label: "Left\nLeg", icon: "G" },
  "right-leg": { label: "Right\nLeg", icon: "K" }
};

export const PAPER_DOLL_PRESETS: readonly PaperDollPreset[] = [
  {
    id: "humanoid",
    name: "Humanoid",
    document: HUMANOID_DOCUMENT,
    presentation: HUMANOID_PRESENTATION
  },
  {
    id: "mech",
    name: "Mech",
    document: MECH_DOCUMENT,
    presentation: MECH_PRESENTATION
  },
  {
    id: "vehicle",
    name: "Vehicle",
    document: VEHICLE_DOCUMENT,
    presentation: VEHICLE_PRESENTATION
  },
  {
    id: "satellite",
    name: "Satellite",
    document: SATELLITE_DOCUMENT,
    presentation: SATELLITE_PRESENTATION
  },
  {
    id: "hand",
    name: "Human Hand",
    document: HAND_DOCUMENT,
    presentation: HAND_PRESENTATION
  },
  {
    id: "combatant",
    name: "Combatant",
    document: COMBATANT_DOCUMENT,
    presentation: COMBATANT_PRESENTATION
  },
  {
    id: "powered-mech",
    name: "Powered Mech",
    document: POWERED_MECH_DOCUMENT,
    presentation: POWERED_MECH_PRESENTATION
  }
];

export const DEFAULT_PRESET = PAPER_DOLL_PRESETS[0];
export const DEFAULT_DOCUMENT = DEFAULT_PRESET.document;
export const VESSEL_PRESENTATION = DEFAULT_PRESET.presentation;
