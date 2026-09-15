import { describe, expect, it } from "vitest";

import {
  DEFAULT_CANVAS_PADDING,
  DEFAULT_CONNECTOR_LENGTH,
  DEFAULT_DOCUMENT,
  DEFAULT_NODE_SIZE,
  SCENE_PRESETS,
  VESSEL_PRESENTATION
} from "./sample-document";
import {
  formatConstructionSource,
  formatSceneSource,
  parseConstructionSource,
  parseSceneSource
} from "./construction-source";

const VIEW = {
  node: DEFAULT_NODE_SIZE,
  connector: DEFAULT_CONNECTOR_LENGTH,
  padding: DEFAULT_CANVAS_PADDING
};

describe("portable numeric source boundary", () => {
  it("refuses an unsafe integer in legacy document data before it can be rewritten", () => {
    const source = formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, VIEW);
    expect(source).toContain("weight: 3");

    const unsafe = source.replace("weight: 3", "weight: 9007199254740993");
    expect(() => parseConstructionSource(unsafe)).toThrow(/paper-json-portable\/v1/);
  });

  it("refuses an unsafe scene budget after JavaScript evaluation rounds the token", () => {
    const preset = SCENE_PRESETS.find((candidate) => candidate.id === "versus-arena")!;
    const source = formatSceneSource(preset.scene, preset.presentation, VIEW);
    expect(source).toContain("fromMax: 1");

    const unsafe = source.replace("fromMax: 1", "fromMax: 9007199254740993");
    expect(() => parseSceneSource(unsafe)).toThrow(/\$\.kinds\..*\.fromMax.*paper-json-portable\/v1/);
  });
});
