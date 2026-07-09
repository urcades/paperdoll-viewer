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
      contains: [item("tool", "Compass")],
      ports: { bottom: { vessel: "pack-shell", side: "top" } }
    },
    "left-pouch": {
      accepts: accepts("supply"),
      contains: [item("supply", "Bandage roll")],
      ports: { right: { vessel: "pack-shell", side: "left" } }
    },
    "pack-shell": {
      accepts: accepts("storage"),
      contains: [item("storage", "Folded tarp")],
      ports: {
        top: { vessel: "top-pocket", side: "bottom" },
        left: { vessel: "left-pouch", side: "right" },
        right: { vessel: "right-pouch", side: "left" },
        bottom: { vessel: "bedroll", side: "top" }
      }
    },
    "right-pouch": {
      accepts: accepts("supply"),
      contains: [item("supply", "Lamp oil")],
      ports: { left: { vessel: "pack-shell", side: "right" } }
    },
    bedroll: {
      accepts: accepts("camp"),
      contains: [item("camp", "Bedroll")],
      ports: { top: { vessel: "pack-shell", side: "bottom" } }
    },
    "loose-ration": {
      accepts: accepts("food"),
      contains: [item("food", "Hard biscuit")],
    },
    "loose-charm": {
      accepts: accepts("trinket"),
      contains: [item("trinket", "Copper charm")],
    }
  }
};

const DRONE_BODY: PaperDollDocument["body"] = {
  root: "drone-core",
  vessels: {
    rotor: {
      accepts: accepts("rotor"),
      contains: [item("rotor", "Twin blades")],
      ports: { bottom: { vessel: "drone-core", side: "top" } }
    },
    "drone-core": {
      accepts: accepts("battery"),
      contains: [item("battery", "Charge cell")],
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
  item("head", "Iron circlet"),
  item("missile", "Bolt case"),
  item("weapon", "Boarding axe"),
  item("food", "Trail rations"),
  { kind: "curio", id: "Weird idol" },
  {
    kind: "item",
    type: "tool",
    id: "Field kit",
    data: { weight: 3, notes: "Sealed against rain" }
  },
  bodyItem("body", "Message drone", DRONE_BODY)
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
        contains: [item("face", "Goggles")],
        ports: { bottom: { vessel: "head", side: "top" } }
      },
      head: {
        accepts: accepts("head"),
        contains: [item("head", "Salve hood")],
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
        contains: [item("weapon", "Steel dagger")],
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
        contains: [item("body", "Wet recycling suit")],
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
        contains: [item("tool", "Torch")],
        ports: { left: { vessel: "right-arm", side: "right" } }
      },
      back: {
        accepts: accepts("back", "body"),
        contains: [bodyItem("body", "Nested backpack", BACKPACK_BODY)],
        ports: {
          top: { vessel: "body", side: "bottom" },
          bottom: { vessel: "feet", side: "top" }
        }
      },
      feet: {
        accepts: accepts("feet"),
        contains: [item("feet", "Leather moccasins")],
        ports: {
          top: { vessel: "back", side: "bottom" },
          right: { vessel: "missile-left", side: "left" }
        }
      },
      "missile-left": {
        accepts: accepts("missile"),
        contains: [item("missile", "Short bow")],
        ports: {
          left: { vessel: "feet", side: "right" },
          right: { vessel: "missile-right", side: "left" }
        }
      },
      "missile-right": {
        accepts: accepts("missile"),
        contains: [item("missile", "Quiver")],
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
        contains: [item("sensor", "Rangefinder")],
        ports: { bottom: { vessel: "cockpit", side: "top" } }
      },
      cockpit: {
        accepts: accepts("pilot"),
        contains: [item("pilot", "Operator cradle")],
        ports: {
          top: { vessel: "sensors", side: "bottom" },
          bottom: { vessel: "core", side: "top" }
        }
      },
      core: {
        accepts: accepts("reactor"),
        contains: [item("reactor", "Compact cell")],
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
        contains: [item("weapon", "Rail lance")],
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
        contains: [item("tool", "Manipulator")],
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
        contains: [item("leg", "Hydraulic strider")],
        ports: { right: { vessel: "hips", side: "left" } }
      },
      "right-leg": {
        accepts: accepts("leg"),
        contains: [item("leg", "Hydraulic strider")],
        ports: { left: { vessel: "hips", side: "right" } }
      },
      stabilizer: {
        accepts: accepts("anchor"),
        contains: [item("anchor", "Gyro foot")],
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
        contains: [item("cargo", "Roof rack")],
        ports: { bottom: { vessel: "cabin", side: "top" } }
      },
      cabin: {
        accepts: accepts("crew"),
        contains: [item("crew", "Driver bench")],
        ports: {
          top: { vessel: "roof", side: "bottom" },
          bottom: { vessel: "chassis", side: "top" }
        }
      },
      "front-axle": {
        accepts: accepts("wheel"),
        contains: [item("wheel", "Front axle")],
        ports: { right: { vessel: "chassis", side: "left" } }
      },
      chassis: {
        accepts: accepts("frame"),
        contains: [item("frame", "Utility chassis")],
        ports: {
          top: { vessel: "cabin", side: "bottom" },
          left: { vessel: "front-axle", side: "right" },
          right: { vessel: "rear-axle", side: "left" },
          bottom: { vessel: "battery", side: "top" }
        }
      },
      "rear-axle": {
        accepts: accepts("wheel"),
        contains: [item("wheel", "Rear axle")],
        ports: {
          left: { vessel: "chassis", side: "right" },
          right: { vessel: "tow-hitch", side: "left" }
        }
      },
      "tow-hitch": {
        accepts: accepts("trailer"),
        contains: [item("trailer", "Tow hook")],
        ports: { left: { vessel: "rear-axle", side: "right" } }
      },
      battery: {
        accepts: accepts("power"),
        contains: [item("power", "Battery tray")],
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
        contains: [item("signal", "High-gain dish")],
        ports: { bottom: { vessel: "bus", side: "top" } }
      },
      "left-panel": {
        accepts: accepts("solar"),
        contains: [item("solar", "Port array")],
        ports: { right: { vessel: "bus", side: "left" } }
      },
      bus: {
        accepts: accepts("payload"),
        contains: [item("payload", "Instrument bus")],
        ports: {
          top: { vessel: "antenna", side: "bottom" },
          left: { vessel: "left-panel", side: "right" },
          right: { vessel: "right-panel", side: "left" },
          bottom: { vessel: "thruster", side: "top" }
        }
      },
      "right-panel": {
        accepts: accepts("solar"),
        contains: [item("solar", "Starboard array")],
        ports: { left: { vessel: "bus", side: "right" } }
      },
      thruster: {
        accepts: accepts("propulsion"),
        contains: [item("propulsion", "Ion thruster")],
        ports: {
          top: { vessel: "bus", side: "bottom" },
          bottom: { vessel: "probe", side: "top" }
        }
      },
      probe: {
        accepts: accepts("sensor"),
        contains: [item("sensor", "Dust sampler")],
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
  }
];

export const DEFAULT_PRESET = PAPER_DOLL_PRESETS[0];
export const DEFAULT_DOCUMENT = DEFAULT_PRESET.document;
export const VESSEL_PRESENTATION = DEFAULT_PRESET.presentation;
