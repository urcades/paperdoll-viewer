import { describe, expect, it } from "vitest";
import { connect, deleteVessel, deriveLayout, insertVessel, parseDocument } from "paperdoll";
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
  legalConnectTargets,
  getBodyAtPath,
  getBounds,
  getRenderNodes,
  getView,
  replaceBodyAtPath
} from "./workbench";

describe("paperdoll viewer construction flow", () => {
  it("uses a valid v2 protocol document as the body model", () => {
    const parsed = parseDocument(DEFAULT_DOCUMENT);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.protocol).toBe("paper-doll/v2");
    expect(parsed.value.body.root).toBe("body");
    expect(parsed.value.body.vessels["right-hand"]).toBeDefined();
  });

  it("ships valid selectable body presets", () => {
    expect(PAPER_DOLL_PRESETS.map((preset) => preset.id)).toEqual(["humanoid", "mech", "vehicle", "satellite"]);

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

    expect(backpack?.id).toBe("Nested backpack");
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
      item: "Torch"
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
    const deleted = deleteVessel(inserted.body, inserted.vesselId, { collapseOppositeNeighbors: true });
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

describe("body path helpers", () => {
  const BACKPACK_PATH = [{ vessel: "back", elementIndex: 0 }];

  it("resolves the root body for an empty path", () => {
    expect(getBodyAtPath(DEFAULT_DOCUMENT.body, [])).toBe(DEFAULT_DOCUMENT.body);
  });

  it("resolves a nested body through vessel/element segments", () => {
    const backpack = getBodyAtPath(DEFAULT_DOCUMENT.body, BACKPACK_PATH);

    expect(backpack?.root).toBe("pack-shell");
    expect(backpack?.vessels["top-pocket"]).toBeDefined();
  });

  it("returns null for paths that do not lead to a body", () => {
    expect(getBodyAtPath(DEFAULT_DOCUMENT.body, [{ vessel: "feet", elementIndex: 0 }])).toBeNull();
    expect(getBodyAtPath(DEFAULT_DOCUMENT.body, [{ vessel: "missing", elementIndex: 0 }])).toBeNull();
  });

  it("replaces a nested body immutably along the path", () => {
    const backpack = getBodyAtPath(DEFAULT_DOCUMENT.body, BACKPACK_PATH)!;
    const mutated = insertVessel(backpack, {}, { id: "side-loop" }).body;

    const nextRoot = replaceBodyAtPath(DEFAULT_DOCUMENT.body, BACKPACK_PATH, mutated);

    expect(getBodyAtPath(nextRoot, BACKPACK_PATH)?.vessels["side-loop"]).toBeDefined();
    expect(getBodyAtPath(DEFAULT_DOCUMENT.body, BACKPACK_PATH)?.vessels["side-loop"]).toBeUndefined();
    expect(nextRoot.vessels.feet).toBe(DEFAULT_DOCUMENT.body.vessels.feet);
    expect(parseDocument({ protocol: "paper-doll/v2", body: nextRoot }).ok).toBe(true);
  });

  it("replaces the root body for an empty path", () => {
    const next = insertVessel(DEFAULT_DOCUMENT.body, {}, { id: "extra" }).body;
    expect(replaceBodyAtPath(DEFAULT_DOCUMENT.body, [], next)).toBe(next);
  });

  it("throws when replacing along an invalid path", () => {
    expect(() =>
      replaceBodyAtPath(DEFAULT_DOCUMENT.body, [{ vessel: "feet", elementIndex: 0 }], DEFAULT_DOCUMENT.body)
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
    body = connect(body, { vessel: "ring-c", side: "top" }, { vessel: "feet", side: "bottom" });

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

  it("generates presentation for arbitrary bodies", () => {
    const backpack = getBodyAtPath(DEFAULT_DOCUMENT.body, BACKPACK_PATH)!;
    const presentation = generatePresentation(backpack);

    expect(presentation["pack-shell"].icon).toBe("@");
    expect(presentation["top-pocket"].label).toBe("Top\nPocket");
  });
});
