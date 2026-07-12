// papermold conformance layer. Profiles judge structure only — they can never
// read element `data`. Anything the simulation knows that judgment needs
// (death, most notably) must be reified as a structural element first: the
// sim counts, paperfold records the patch, papermold judges the shape.
//
// One papermold/v2 document carries both namespaces: body profiles (judged
// per figure) and scene profiles (judged over the whole paperchain scene —
// relations included, so "armed" and "engaged" are conformance questions).

import {
  conformsBody,
  judgeBody,
  judgeScene,
  validateSceneProfiles,
  type PapermoldSceneDocument,
  type Scene
} from "papermold";
import type { Body, ProtocolError } from "paperdoll";

/** The reified death marker. Inserted into a body's root vessel by the sim. */
export const DEAD_STATUS = { kind: "status", type: "dead", id: "status-dead" } as const;

export type ProfileVerdict = {
  profileId: string;
  conforms: boolean;
  errors: ProtocolError[];
};

/** Profile document for the app (single papermold/v2 document). */
export const APP_PROFILES: PapermoldSceneDocument = {
  protocol: "papermold/v2",
  profiles: {
    // The combatant preset counted as alive: head present and attached through
    // the neck (the preset's actual geometry: head.bottom <-> neck.top,
    // neck.bottom <-> torso.top), flesh in the torso, no reified death marker,
    // and at least both organ-bearing vessels (head: brain; torso: heart,
    // lungs, guts) still carrying an organ.
    "living-combatant": {
      vessels: {
        head: {
          exists: true,
          ports: { bottom: { vessel: "neck", side: "top" } }
        },
        neck: {
          ports: {
            top: { vessel: "head", side: "bottom" },
            bottom: { vessel: "torso", side: "top" }
          }
        },
        torso: {
          exists: true,
          containsAtLeast: [{ kind: "tissue" }],
          forbids: [{ kind: "status", type: "dead" }]
        }
      },
      atLeast: {
        n: 2,
        of: [
          { vessel: "head", check: { containsAtLeast: [{ kind: "organ" }] } },
          { vessel: "torso", check: { containsAtLeast: [{ kind: "organ" }] } }
        ]
      }
    },
    // Armored means armor actually worn: an item layered on the torso. The
    // pristine combatant starts bare (its armor waits in the scene's pool
    // body), so equipping via drag flips this badge live.
    armored: {
      vessels: {
        torso: { containsAtLeast: [{ kind: "item" }] }
      }
    },
    // The powered-mech preset: the core vessel carries at least one power cell
    // (element kinds per src/power.ts: cell / conduit / module / converter).
    "powered-rig": {
      vessels: {
        core: {
          exists: true,
          containsAtLeast: [{ kind: "cell" }]
        }
      }
    }
  },
  sceneProfiles: {
    // A fighter is armed while any relation of kind `wields` touches it —
    // subtree anchoring means a weapon held anywhere in the body counts, and
    // severing the wielding arm (which prunes the relation in the same
    // commit) disarms.
    "armed-red": {
      relations: [{ at: "red", kind: "wields", atLeast: 1 }]
    },
    "armed-blue": {
      relations: [{ at: "blue", kind: "wields", atLeast: 1 }]
    },
    // Engaged: red grapples blue (symmetric — stored orientation irrelevant).
    engaged: {
      relations: [{ at: "red", kind: "grapples", atLeast: 1, otherEndpoint: { prefix: "blue" } }]
    },
    // A legal duel: every figure (the pool spectates) is a living combatant,
    // and the wields kind carries its one-weapon-per-hand budget — universal
    // multiplicity delegated to the declaration paperchain already enforces.
    "legal-duel": {
      forAllBodies: [{ excluding: ["pool"], check: { conformsTo: "living-combatant" } }],
      kinds: { wields: { declaration: { fromMax: 1 } } }
    }
  }
};

/** Which body profiles apply per preset id. */
export const PRESET_PROFILES: Record<string, string[]> = {
  combatant: ["living-combatant", "armored"],
  "powered-mech": ["powered-rig"],
  humanoid: []
};

/** Which scene profiles apply per preset id. */
export const PRESET_SCENE_PROFILES: Record<string, string[]> = {
  "versus-arena": ["armed-red", "armed-blue", "engaged", "legal-duel"]
};

/** Judge a body against every applicable body profile. */
export function judgeAll(body: Body, profileIds: string[]): ProfileVerdict[] {
  return profileIds.map((profileId) => {
    const errors = judgeBody(body, APP_PROFILES, profileId);
    return { profileId, conforms: errors.length === 0, errors };
  });
}

/** Judge the whole scene against every applicable scene profile. */
export function judgeSceneAll(scene: Scene, sceneProfileIds: string[]): ProfileVerdict[] {
  return sceneProfileIds.map((profileId) => {
    const errors = judgeScene(scene, APP_PROFILES, profileId);
    return { profileId, conforms: errors.length === 0, errors };
  });
}

export { conformsBody as conforms, judgeBody as judge, validateSceneProfiles };
