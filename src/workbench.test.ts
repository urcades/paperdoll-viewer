import { describe, expect, it } from "vitest";
import { connect, deleteVessel, deriveLayout, disconnect, insertElement, insertVessel, parseDocument, type Body } from "paperdoll";
import { advanceTick, applyStrike, bleedRate, deriveCondition, getCombatData, healAll, WEAPONS } from "./combat";
import { derivePowerStatus, hasPower, propagatePower } from "./power";
import { reachableVessels, severDistalSubtree } from "./workbench";
import {
  DEFAULT_CANVAS_PADDING,
  DEFAULT_CONNECTOR_LENGTH,
  DEFAULT_DOCUMENT,
  DEFAULT_NODE_SIZE,
  PAPER_DOLL_PRESETS,
  VESSEL_PRESENTATION
} from "./sample-document";
import { formatConstructionSource, getConstructionNodeRanges, parseConstructionSource } from "./construction-source";
import {
  canDisconnect,
  generatePresentation,
  joinAddress,
  legalConnectTargets,
  legalDropVessels,
  replaceElementData,
  getBodyAtAddress,
  getBounds,
  getRenderNodes,
  getView,
  replaceBodyAtAddress,
  ROOT_ADDRESS
} from "./workbench";

describe("paperdoll viewer construction flow", () => {
  it("uses a valid v3 protocol document as the body model", () => {
    const parsed = parseDocument(DEFAULT_DOCUMENT);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.protocol).toBe("paper-doll/v3");
    expect(parsed.value.body.root).toBe("body");
    expect(parsed.value.body.vessels["right-hand"]).toBeDefined();
  });

  it("ships valid selectable body presets", () => {
    expect(PAPER_DOLL_PRESETS.map((preset) => preset.id)).toEqual(["humanoid", "mech", "vehicle", "satellite", "hand", "combatant", "powered-mech"]);

    for (const preset of PAPER_DOLL_PRESETS) {
      const parsed = parseDocument(preset.document);

      expect(parsed.ok).toBe(true);
      expect(preset.presentation[preset.document.body.root]).toBeDefined();
      expect(Object.keys(preset.document.body.vessels).length).toBeGreaterThan(1);
    }
  });

  it("models the humanoid backpack as a recursive contained body", () => {
    const backContents = DEFAULT_DOCUMENT.body.vessels.back.contains ?? [];
    const backpack = backContents.find((element) => element.body);

    expect(backpack?.id).toBe("nested-backpack");
    expect(backpack?.body?.root).toBe("pack-shell");
    expect(backpack?.body?.vessels["loose-ration"].ports).toBeUndefined();

    const parsed = parseDocument(DEFAULT_DOCUMENT);
    expect(parsed.ok).toBe(true);
  });

  it("joins protocol layout with app-owned presentation for rendering", () => {
    const layout = deriveLayout(DEFAULT_DOCUMENT.body);
    const nodes = getRenderNodes(DEFAULT_DOCUMENT, layout, VESSEL_PRESENTATION);
    const rightHand = nodes.find((node) => node.id === "right-hand");

    expect(rightHand).toMatchObject({
      label: "Right Hand",
      icon: "H",
      item: "torch"
    });
  });

  it("derives canvas geometry from viewer-owned size controls", () => {
    const layout = deriveLayout(DEFAULT_DOCUMENT.body);
    const nodes = getRenderNodes(DEFAULT_DOCUMENT, layout, VESSEL_PRESENTATION);
    const compact = getBounds(nodes, getView({ node: 32, connector: 24, padding: 40 }));
    const roomy = getBounds(nodes, getView({ node: 64, connector: 72, padding: 96 }));

    expect(roomy.width).toBeGreaterThan(compact.width);
    expect(roomy.height).toBeGreaterThan(compact.height);
  });

  it("includes vessel box size in canvas bounds", () => {
    const bounds = getBounds(
      [
        { id: "left", kind: "figure", x: 0, y: 0, label: "Left" },
        { id: "right", kind: "figure", x: 1, y: 0, label: "Right" }
      ],
      getView({ node: 33, connector: 55, padding: 0 })
    );

    expect(bounds.width).toBe(121);
    expect(bounds.height).toBe(33);
  });

  it("uses compact zero-padding view controls by default", () => {
    const source = formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, {
      node: DEFAULT_NODE_SIZE,
      connector: DEFAULT_CONNECTOR_LENGTH,
      padding: DEFAULT_CANVAS_PADDING
    });

    expect(source).toContain(`view: {\n    node: 33,\n    connector: 55,\n    padding: 0\n  }`);
    expect(parseConstructionSource(source).view).toEqual({
      node: 33,
      connector: 55,
      padding: 0
    });
  });

  it("maps vessel source ranges for editor and canvas selection sync", () => {
    const source = formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, {
      node: DEFAULT_NODE_SIZE,
      connector: DEFAULT_CONNECTOR_LENGTH,
      padding: DEFAULT_CANVAS_PADDING
    });

    const ranges = getConstructionNodeRanges(source);
    const bodyRanges = ranges.filter((range) => range.id === "body");
    const rightHandRanges = ranges.filter((range) => range.id === "right-hand");

    expect(bodyRanges.map((range) => range.section).sort()).toEqual(["document", "presentation"]);
    expect(rightHandRanges.map((range) => range.section).sort()).toEqual(["document", "presentation"]);
    expect(source.slice(rightHandRanges[0].from, rightHandRanges[0].to)).toContain("right-hand");
  });

  it("inserts connected vessels through the paperdoll package", () => {
    const result = insertVessel(DEFAULT_DOCUMENT.body, {}, { at: { vessel: "body", side: "right" } });
    const parsed = parseDocument({ ...DEFAULT_DOCUMENT, body: result.body });

    expect(parsed.ok).toBe(true);
    expect(result.body.vessels.body.ports?.right).toEqual({ vessel: result.vesselId, side: "left" });
  });

  it("inserts free vessels through the paperdoll package", () => {
    const result = insertVessel(DEFAULT_DOCUMENT.body);
    const parsed = parseDocument({ ...DEFAULT_DOCUMENT, body: result.body });

    expect(parsed.ok).toBe(true);
    expect(result.vesselId).toBe("vessel-1");
    expect(deriveLayout(result.body).free).toContain(result.vesselId);
  });

  it("collapses opposite neighbors through the paperdoll package", () => {
    const inserted = insertVessel(DEFAULT_DOCUMENT.body, {}, { at: { vessel: "body", side: "right" } });
    const { body: deleted } = deleteVessel(inserted.body, inserted.vesselId, { collapseOppositeNeighbors: true });
    const parsed = parseDocument({ ...DEFAULT_DOCUMENT, body: deleted });

    expect(parsed.ok).toBe(true);
    expect(deleted.vessels.body.ports?.right).toEqual({ vessel: "right-arm", side: "left" });
    expect(deleted.vessels["right-arm"].ports?.left).toEqual({ vessel: "body", side: "right" });
  });

  it("parses valid quoted-text edits immediately", () => {
    const source = formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, {
      node: 48,
      connector: 48,
      padding: 72
    }).replace('label: "Face"', 'label: "Face visor"');

    const parsed = parseConstructionSource(source);

    expect(parsed.presentation.face.label).toBe("Face visor");
  });

  it("does not confuse semicolons inside quoted text for source delimiters", () => {
    const source = formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, {
      node: 48,
      connector: 48,
      padding: 72
    }).replace('label: "Face"', 'label: "Face; visor"');

    const parsed = parseConstructionSource(source);

    expect(parsed.presentation.face.label).toBe("Face; visor");
  });

  it("treats in-progress quoted text as a syntax error", () => {
    const source = formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, {
      node: 48,
      connector: 48,
      padding: 72
    }).replace('label: "Face"', 'label: "Face');

    expect(() => parseConstructionSource(source)).toThrow(SyntaxError);
  });
});

describe("body address helpers", () => {
  const BACKPACK_ADDRESS = joinAddress(ROOT_ADDRESS, "back", "nested-backpack");

  it("resolves the root body for the root address", () => {
    expect(getBodyAtAddress(DEFAULT_DOCUMENT.body, ROOT_ADDRESS)).toBe(DEFAULT_DOCUMENT.body);
  });

  it("resolves a nested body through a protocol address", () => {
    expect(BACKPACK_ADDRESS).toBe("back/nested-backpack");
    const backpack = getBodyAtAddress(DEFAULT_DOCUMENT.body, BACKPACK_ADDRESS);

    expect(backpack?.root).toBe("pack-shell");
    expect(backpack?.vessels["top-pocket"]).toBeDefined();
  });

  it("returns null for addresses that do not lead to a body", () => {
    // element exists but has no embedded body
    expect(getBodyAtAddress(DEFAULT_DOCUMENT.body, "feet/leather-moccasins")).toBeNull();
    // vessel address (odd segment count) names a vessel, not an element
    expect(getBodyAtAddress(DEFAULT_DOCUMENT.body, "feet")).toBeNull();
    expect(getBodyAtAddress(DEFAULT_DOCUMENT.body, "missing/nothing")).toBeNull();
  });

  it("replaces a nested body immutably along the address", () => {
    const backpack = getBodyAtAddress(DEFAULT_DOCUMENT.body, BACKPACK_ADDRESS)!;
    const mutated = insertVessel(backpack, {}, { id: "side-loop" }).body;

    const nextRoot = replaceBodyAtAddress(DEFAULT_DOCUMENT.body, BACKPACK_ADDRESS, mutated);

    expect(getBodyAtAddress(nextRoot, BACKPACK_ADDRESS)?.vessels["side-loop"]).toBeDefined();
    expect(getBodyAtAddress(DEFAULT_DOCUMENT.body, BACKPACK_ADDRESS)?.vessels["side-loop"]).toBeUndefined();
    expect(nextRoot.vessels.feet).toBe(DEFAULT_DOCUMENT.body.vessels.feet);
    expect(parseDocument({ protocol: "paper-doll/v3", body: nextRoot }).ok).toBe(true);
  });

  it("addresses stay valid when contains order changes", () => {
    // an index-based path would break here; an id-based address does not
    const reordered = structuredClone(DEFAULT_DOCUMENT.body);
    reordered.vessels.back.contains = [
      { kind: "item", type: "back", id: "cloak" },
      ...(reordered.vessels.back.contains ?? [])
    ];

    expect(getBodyAtAddress(reordered, BACKPACK_ADDRESS)?.root).toBe("pack-shell");
  });

  it("replaces the root body for the root address", () => {
    const next = insertVessel(DEFAULT_DOCUMENT.body, {}, { id: "extra" }).body;
    expect(replaceBodyAtAddress(DEFAULT_DOCUMENT.body, ROOT_ADDRESS, next)).toBe(next);
  });

  it("throws when replacing along an invalid address", () => {
    expect(() =>
      replaceBodyAtAddress(DEFAULT_DOCUMENT.body, "feet/leather-moccasins", DEFAULT_DOCUMENT.body)
    ).toThrow(/No embedded body/);
  });

  it("allows disconnecting a leaf edge (leaf derives as free)", () => {
    // missile-right's only connection; severing leaves it port-less and free
    expect(canDisconnect(DEFAULT_DOCUMENT.body, { vessel: "missile-right", side: "left" })).toBe(true);
  });

  it("blocks disconnecting a mid-graph edge that would orphan a ported subtree", () => {
    // cutting body<->left-arm orphans left-arm, left-hand, hands-worn (all still ported)
    expect(canDisconnect(DEFAULT_DOCUMENT.body, { vessel: "body", side: "left" })).toBe(false);
  });

  it("allows disconnecting a ring edge (cycle stays reachable)", () => {
    let body = DEFAULT_DOCUMENT.body;
    body = insertVessel(body, {}, { at: { vessel: "feet", side: "left" }, id: "ring-a" }).body;
    body = insertVessel(body, {}, { at: { vessel: "ring-a", side: "bottom" }, id: "ring-b" }).body;
    body = insertVessel(body, {}, { at: { vessel: "ring-b", side: "right" }, id: "ring-c" }).body;
    body = connect(body, { vessel: "ring-c", side: "top" }, { vessel: "feet", side: "bottom" }).body;

    expect(canDisconnect(body, { vessel: "feet", side: "left" })).toBe(true);
    expect(canDisconnect(body, { vessel: "ring-b", side: "top" })).toBe(true);
  });

  it("offers ring-closing and free-vessel targets for a legal connect drag", () => {
    let body = DEFAULT_DOCUMENT.body;
    body = insertVessel(body, {}, { at: { vessel: "feet", side: "left" }, id: "ring-a" }).body;
    body = insertVessel(body, {}, { at: { vessel: "ring-a", side: "bottom" }, id: "ring-b" }).body;
    body = insertVessel(body, {}, { at: { vessel: "ring-b", side: "right" }, id: "ring-c" }).body;

    // ring-c.top points at feet's occupied cell: only the geometrically
    // consistent ring closure with feet itself is legal there
    expect(legalConnectTargets(body, { vessel: "ring-c", side: "top" })).toEqual([
      { vessel: "feet", side: "bottom" }
    ]);

    // an empty adjacent cell admits free vessels (they gain a position from the drop)
    const openTargets = legalConnectTargets(body, { vessel: "ring-b", side: "bottom" });
    expect(openTargets).toContainEqual({ vessel: "floating", side: "top" });
    expect(openTargets).toContainEqual({ vessel: "thrown", side: "top" });
    // figure vessels in non-adjacent cells are never offered
    expect(openTargets).not.toContainEqual({ vessel: "feet", side: "top" });
  });

  it("offers no targets from an occupied port", () => {
    expect(legalConnectTargets(DEFAULT_DOCUMENT.body, { vessel: "body", side: "left" })).toEqual([]);
  });

  it("lets a free vessel connect into the figure", () => {
    const targets = legalConnectTargets(DEFAULT_DOCUMENT.body, { vessel: "floating", side: "top" });

    // e.g. hanging below feet-row leaves: any vessel with a free bottom port and empty cell below
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((target) => target.side === "bottom")).toBe(true);
  });

  it("computes legal drop vessels via the compatibility judgment", () => {
    const circlet = { kind: "item", type: "head" };
    const idol = { kind: "curio", id: "Weird idol" };

    const headTargets = legalDropVessels(DEFAULT_DOCUMENT.body, circlet, "pool");
    // typed vessels admit matching elements; the open pool would too but is the source
    expect(headTargets).toContain("head");
    expect(headTargets).not.toContain("feet");

    // a kind no vessel accepts can go nowhere but back to the open pool
    expect(legalDropVessels(DEFAULT_DOCUMENT.body, idol, "head")).toEqual(["pool"]);

    // absent accepts = open, [] = sealed
    const modes: Body = {
      root: "open",
      vessels: { open: {}, sealed: { accepts: [] } }
    };
    expect(legalDropVessels(modes, idol, "none")).toEqual(["open"]);
  });

  it("rewrites element data as a remove + insert-at composition", () => {
    const combatant = PAPER_DOLL_PRESETS.find((preset) => preset.id === "combatant")!.document.body;
    const before = combatant.vessels.head.contains![0];
    const damaged = replaceElementData(combatant, "head", 0, { ...(before.data as object), integrity: 3 });

    expect(damaged.vessels.head.contains?.[0]).toMatchObject({
      kind: "tissue",
      id: "skin",
      data: { integrity: 3 }
    });
    // same position, untouched siblings (protocol ops deep-clone)
    expect(damaged.vessels.head.contains?.length).toBe(combatant.vessels.head.contains!.length);
    expect(damaged.vessels.torso).toStrictEqual(combatant.vessels.torso);
    expect(parseDocument({ protocol: "paper-doll/v3", body: damaged }).ok).toBe(true);
    // original untouched
    expect(combatant.vessels.head.contains?.[0].data).toMatchObject({ integrity: 15 });
  });

  it("generates presentation for arbitrary bodies", () => {
    const backpack = getBodyAtAddress(DEFAULT_DOCUMENT.body, BACKPACK_ADDRESS)!;
    const presentation = generatePresentation(backpack);

    expect(presentation["pack-shell"].icon).toBe("@");
    expect(presentation["top-pocket"].label).toBe("Top\nPocket");
  });
});


describe("combat model", () => {
  const combatant = () => structuredClone(PAPER_DOLL_PRESETS.find((preset) => preset.id === "combatant")!.document.body);
  const weapon = (id: string) => WEAPONS.find((candidate) => candidate.id === id)!;
  const layer = (body: Body, vessel: string, id: string) =>
    getCombatData(body.vessels[vessel].contains!.find((element) => element.id === id)!)!;
  const midRng = () => 0.5;

  it("an edged strike cuts soft tissue but the skull resists shear", () => {
    const { body, log } = applyStrike(combatant(), "head", weapon("dagger"), midRng);

    expect(layer(body, "head", "skin").integrity).toBeLessThan(15);
    expect(log).toContain("strikes the head");
    // skull shear yield far exceeds dagger momentum; at most blunt denting, never a cut tier beyond that
    expect(layer(body, "head", "brain").integrity).toBe(20);
  });

  it("a warhammer transmits impact through the skull to the brain", () => {
    const { body } = applyStrike(combatant(), "head", weapon("warhammer"), midRng);

    expect(layer(body, "head", "skull").integrity).toBeLessThan(40);
    expect(layer(body, "head", "brain").integrity).toBeLessThan(20);
  });

  it("an iron helm deflects a dagger entirely", () => {
    const body = combatant();
    const { body: armored } = { body: insertElement(body, "head", {
      kind: "item", type: "helm", id: "iron-helm",
      data: { integrity: 40, max: 40, material: { shearY: 145, shearF: 160, impactY: 70, impactF: 120, absorb: 0.15 } }
    }) };

    const { body: struck, log } = applyStrike(armored, "head", weapon("dagger"), midRng);

    expect(log).toContain("glances off the iron-helm");
    expect(layer(struck, "head", "skin").integrity).toBe(15);
    expect(layer(struck, "head", "brain").integrity).toBe(20);
  });

  it("repeated strikes destroy the brain and derive death", () => {
    let body = combatant();
    for (let index = 0; index < 12; index += 1) {
      body = applyStrike(body, "head", weapon("warhammer"), midRng).body;
    }

    expect(layer(body, "head", "brain").integrity).toBe(0);
    expect(deriveCondition(body)).toContainEqual(expect.stringContaining("dead (brain destroyed)"));
  });

  it("healAll restores every layer and clears conditions", () => {
    let body = combatant();
    body = applyStrike(body, "torso", weapon("sword"), midRng).body;
    body = healAll(body);

    expect(layer(body, "torso", "skin").integrity).toBe(25);
    expect(deriveCondition(body)).toEqual([]);
  });

  it("documents stay protocol-valid through strikes", () => {
    const { body } = applyStrike(combatant(), "left-hand", weapon("sword"), midRng);
    expect(parseDocument({ protocol: "paper-doll/v3", body }).ok).toBe(true);
  });
});

describe("severing", () => {
  const combatant = () => structuredClone(PAPER_DOLL_PRESETS.find((preset) => preset.id === "combatant")!.document.body);
  const weapon = (id: string) => WEAPONS.find((candidate) => candidate.id === id)!;
  const highRng = () => 0.95;

  it("severs a leaf part into a free vessel without breaking the document", () => {
    const before = combatant();
    const { body, severed } = severDistalSubtree(before, "left-hand");

    // left-hand's distal child (fingers) detaches; hand stays attached to the arm
    expect(severed).toContain("left-fingers");
    expect(reachableVessels(body).has("left-fingers")).toBe(false);
    expect(body.vessels["left-fingers"].ports).toBeUndefined();
    expect(deriveLayout(body).free).toContain("left-fingers");
    expect(parseDocument({ protocol: "paper-doll/v3", body }).ok).toBe(true);
  });

  it("cascades: cutting the upper arm scatters the whole distal chain", () => {
    const { body, severed } = severDistalSubtree(combatant(), "upper-left-arm");

    expect(new Set(severed)).toEqual(new Set(["lower-left-arm", "left-hand", "left-fingers"]));
    for (const id of severed) {
      expect(body.vessels[id].ports).toBeUndefined();
    }
    expect(parseDocument({ protocol: "paper-doll/v3", body }).ok).toBe(true);
  });

  it("decapitates when the neck structure is cut through", () => {
    let body = combatant();
    let severed: string[] = [];
    for (let index = 0; index < 15 && !severed.includes("head"); index += 1) {
      const result = applyStrike(body, "neck", weapon("sword"), highRng);
      body = result.body;
      const after = severDistalSubtree(body, "neck");
      severed = [...severed, ...after.severed];
    }
    // the strike itself severs when the spine breaks; head becomes free
    const struckToDeath = (() => {
      let b = combatant();
      for (let i = 0; i < 15; i += 1) {
        const r = applyStrike(b, "neck", weapon("sword"), highRng);
        b = r.body;
        if (!reachableVessels(b).has("head")) return b;
      }
      return b;
    })();
    expect(reachableVessels(struckToDeath).has("head")).toBe(false);
    // a severed head carries the brain out of the body: death
    expect(deriveCondition(struckToDeath)).toContainEqual(expect.stringContaining("head severed"));
  });

  it("severing the root is a no-op", () => {
    const before = combatant();
    const { body, severed } = severDistalSubtree(before, "torso");
    expect(severed).toEqual([]);
    expect(body).toBe(before);
  });
});

describe("pulping and bleeding", () => {
  const combatant = () => structuredClone(PAPER_DOLL_PRESETS.find((preset) => preset.id === "combatant")!.document.body);
  const weapon = (id: string) => WEAPONS.find((candidate) => candidate.id === id)!;
  const bloodVolume = (body: Body) => {
    const el = body.vessels.torso.contains!.find((element) => element.kind === "fluid")!;
    return (el.data as { volume: number }).volume;
  };

  it("a blunt structural break pulps the part in place (not severed)", () => {
    let body = combatant();
    for (let i = 0; i < 15; i += 1) body = applyStrike(body, "left-hand", weapon("warhammer"), () => 0.95).body;

    // pulped: still attached (reachable), every tissue layer destroyed
    expect(reachableVessels(body).has("left-hand")).toBe(true);
    for (const element of body.vessels["left-hand"].contains!) {
      if (getCombatData(element) && element.kind !== "item") {
        expect((element.data as { integrity: number }).integrity).toBe(0);
      }
    }
  });

  it("bleed rate rises with open wounds and advanceTick drains blood", () => {
    const healthy = combatant();
    expect(bleedRate(healthy)).toBe(0);

    const wounded = applyStrike(healthy, "torso", weapon("sword"), () => 0.95).body;
    expect(bleedRate(wounded)).toBeGreaterThan(0);

    const before = bloodVolume(wounded);
    const { body: ticked, changed } = advanceTick(wounded);
    expect(changed).toBe(true);
    expect(bloodVolume(ticked)).toBeLessThan(before);
    expect(parseDocument({ protocol: "paper-doll/v3", body: ticked }).ok).toBe(true);
  });

  it("draining all blood derives death", () => {
    let body = applyStrike(combatant(), "torso", weapon("sword"), () => 0.95).body;
    for (let i = 0; i < 400 && bloodVolume(body) > 0; i += 1) body = advanceTick(body).body;

    expect(bloodVolume(body)).toBe(0);
    expect(deriveCondition(body)).toContain("dead (bled out)");
  });

  it("a severed stump bleeds faster than a surface wound", () => {
    const cut = applyStrike(combatant(), "left-hand", weapon("dagger"), () => 0.95).body; // surface
    const { body: decap } = severDistalSubtree(combatant(), "neck");
    expect(bleedRate(decap)).toBeGreaterThan(bleedRate(cut));
  });

  it("heal refills blood and advanceTick then stops", () => {
    let body = applyStrike(combatant(), "torso", weapon("sword"), () => 0.95).body;
    body = advanceTick(body).body;
    body = healAll(body);
    expect(bloodVolume(body)).toBe(100);
    expect(advanceTick(body).changed).toBe(false);
  });
});


describe("power propagation", () => {
  const mech = () => structuredClone(PAPER_DOLL_PRESETS.find((preset) => preset.id === "powered-mech")!.document.body);
  const flag = (body: Body, vessel: string, kind: string, key: string) => {
    const el = body.vessels[vessel].contains!.find((element) => element.kind === kind)!;
    return (el.data as Record<string, unknown>)[key];
  };

  it("floods electric from the battery to loads and the pump", () => {
    const { body } = propagatePower(mech());
    expect(flag(body, "sensor", "module", "powered")).toBe(true);
    expect(flag(body, "left-gun", "module", "powered")).toBe(true);
    expect(flag(body, "pump", "converter", "active")).toBe(true);
  });

  it("cascades hydraulic: the pump drives both legs", () => {
    const { body } = propagatePower(mech());
    expect(flag(body, "left-leg", "module", "powered")).toBe(true);
    expect(flag(body, "right-leg", "module", "powered")).toBe(true);
  });

  it("cutting the pump feed kills the hydraulic legs but not the arms", () => {
    const cut = disconnect(mech(), { vessel: "spine", side: "bottom" }).body;
    const { body } = propagatePower(cut);
    // pump is now isolated from the battery
    expect(flag(body, "pump", "converter", "active")).toBe(false);
    expect(flag(body, "left-leg", "module", "powered")).toBe(false);
    expect(flag(body, "right-leg", "module", "powered")).toBe(false);
    // arms/sensor still fed directly from the core
    expect(flag(body, "left-gun", "module", "powered")).toBe(true);
    expect(flag(body, "sensor", "module", "powered")).toBe(true);
  });

  it("cutting one leg's pipe leaves the other running", () => {
    const cut = disconnect(mech(), { vessel: "hips", side: "left" }).body;
    const { body } = propagatePower(cut);
    expect(flag(body, "left-leg", "module", "powered")).toBe(false);
    expect(flag(body, "right-leg", "module", "powered")).toBe(true);
  });

  it("drains the battery each pulse and eventually browns out", () => {
    let body = mech();
    const start = flag(body, "core", "cell", "charge") as number;
    body = propagatePower(body).body;
    expect(flag(body, "core", "cell", "charge") as number).toBeLessThan(start);

    for (let i = 0; i < 200 && (flag(body, "core", "cell", "charge") as number) > 0; i += 1) {
      body = propagatePower(body).body;
    }
    expect(flag(body, "core", "cell", "charge")).toBe(0);
    const dead = propagatePower(body).body;
    expect(flag(dead, "left-gun", "module", "powered")).toBe(false);
    expect(flag(dead, "left-leg", "module", "powered")).toBe(false);
  });

  it("stays protocol-valid through propagation", () => {
    const { body } = propagatePower(mech());
    expect(parseDocument({ protocol: "paper-doll/v3", body }).ok).toBe(true);
  });

  it("derives a readable status line", () => {
    const { body } = propagatePower(mech());
    const status = derivePowerStatus(body);
    expect(status[0]).toMatch(/battery \d+%/);
    expect(status).toContainEqual(expect.stringContaining("pump online"));
  });
});