// papermold conformance layer. Profiles judge structure only — they can never
// read element `data`. Anything the simulation knows that judgment needs
// (death, most notably) must be reified as a structural element first: the
// sim counts, paperfold records the patch, papermold judges the shape.

import { conforms, judge, validateProfiles, type PapermoldDocument } from "papermold";
import type { Body, ProtocolError } from "paperdoll";

/** The reified death marker. Inserted into a body's root vessel by the sim. */
export const DEAD_STATUS = { kind: "status", type: "dead", id: "status-dead" } as const;

export type ProfileVerdict = {
  profileId: string;
  conforms: boolean;
  errors: ProtocolError[];
};

/** Profile documents for the app (single PapermoldDocument). */
export const APP_PROFILES: PapermoldDocument = {
  protocol: "papermold/v1",
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
  }
};

/** Which profiles apply per preset id. */
export const PRESET_PROFILES: Record<string, string[]> = {
  combatant: ["living-combatant", "armored"],
  "powered-mech": ["powered-rig"],
  humanoid: []
};

/** Judge a body against every applicable profile. */
export function judgeAll(body: Body, profileIds: string[]): ProfileVerdict[] {
  return profileIds.map((profileId) => {
    const errors = judge(body, APP_PROFILES, profileId);
    return { profileId, conforms: errors.length === 0, errors };
  });
}

export { conforms, judge, validateProfiles };
