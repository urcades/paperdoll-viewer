// Behavioral tests for the paperfold-backed history layer: the History store
// itself, and the funnel sequence App.svelte performs on every commit
// (lift nested edit → diffBodies → applyPatch, undo via invertPatch).

import { describe, expect, it } from "vitest";
import {
  connect,
  deleteVessel,
  disconnect,
  insertElement,
  insertVessel,
  moveElement,
  parseDocument,
  type Body
} from "paperdoll";
import { applyPatch, canonicalizeBody, diffBodies, invertPatch, type PaperfoldDocument } from "paperfold";
import { applyStrike, WEAPONS } from "./combat";
import { DEFAULT_DOCUMENT, PAPER_DOLL_PRESETS } from "./sample-document";
import { replaceBodyAtAddress, replaceElementData, ROOT_ADDRESS } from "./workbench";
import { History } from "./history.svelte";

function assertOk<T>(result: { ok: true; value: T } | { ok: false; errors: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

/** The funnel sequence from App.svelte, minus Svelte state (one body, "main"). */
function commitThrough(history: History, prevRoot: Body, address: string, nextBody: Body, label: string): Body {
  const nextRoot = replaceBodyAtAddress(prevRoot, address, nextBody);
  const patch = assertOk(diffBodies(prevRoot, nextRoot));
  const applied = assertOk(applyPatch(prevRoot, patch));
  history.push({
    steps: [{ bodyName: "main", patch, inverse: invertPatch(patch) }],
    label,
    tag: "construct",
    runId: null
  });
  return applied;
}

function undoOnto(history: History, body: Body): Body {
  const result = history.undo();
  if (!result) throw new Error("nothing to undo");
  return result.steps.reduce((current, step) => assertOk(applyPatch(current, step.patch)), body);
}

function redoOnto(history: History, body: Body): Body {
  const result = history.redo();
  if (!result) throw new Error("nothing to redo");
  return result.steps.reduce((current, step) => assertOk(applyPatch(current, step.patch)), body);
}

function clone(body: Body): Body {
  return structuredClone(body);
}

describe("history store", () => {
  const emptyPatch: PaperfoldDocument = { protocol: "paperfold/v1", patch: [] };
  const entry = (label: string) => ({
    steps: [{ bodyName: "main", patch: emptyPatch, inverse: emptyPatch }],
    label,
    tag: "construct" as const,
    runId: null
  });

  it("push clears the redo stack", () => {
    const history = new History();
    history.push(entry("a"));
    history.push(entry("b"));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.push(entry("c"));
    expect(history.canRedo).toBe(false);
    expect(history.past.map((item) => item.label)).toEqual(["a", "c"]);
  });

  it("undo and redo move entries between stacks without loss", () => {
    const history = new History();
    history.push(entry("a"));
    history.push(entry("b"));

    expect(history.undo()?.label).toBe("b");
    expect(history.undo()?.label).toBe("a");
    expect(history.undo()).toBeNull();
    expect(history.redo()?.label).toBe("a");
    expect(history.redo()?.label).toBe("b");
    expect(history.redo()).toBeNull();
  });

  it("clear is a history barrier", () => {
    const history = new History();
    history.push(entry("a"));
    history.undo();
    history.clear();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

describe("patch-based commit funnel", () => {
  it("round-trips every mutation kind through diff, apply, and invert", () => {
    const base = canonicalizeBody(clone(DEFAULT_DOCUMENT.body));
    const mutations: Array<{ label: string; mutate: (body: Body) => Body }> = [
      { label: "insertVessel", mutate: (body) => insertVessel(body, {}, { id: "spare-zone" }).body },
      { label: "deleteVessel", mutate: (body) => deleteVessel(body, "left-hand").body },
      {
        label: "connect free vessel",
        mutate: (body) => connect(body, { vessel: "left-hand", side: "bottom" }, { vessel: "thrown", side: "top" }).body
      },
      {
        label: "insertElement",
        mutate: (body) => insertElement(body, "pool", { kind: "item", type: "hat", id: "hat" })
      },
      {
        label: "moveElement",
        mutate: (body) => moveElement(body, "pool", 2, "left-hand")
      },
      {
        label: "replaceElementData",
        mutate: (body) => replaceElementData(body, "back", 0, { charge: 5 })
      }
    ];

    for (const { label, mutate } of mutations) {
      const history = new History();
      const next = commitThrough(history, base, ROOT_ADDRESS, mutate(clone(base)), label);
      expect(next, label).not.toEqual(base);
      expect(parseDocument({ ...DEFAULT_DOCUMENT, body: next }).ok, label).toBe(true);

      const undone = undoOnto(history, next);
      expect(undone, label).toEqual(base);
      const redone = redoOnto(history, undone);
      expect(redone, label).toEqual(next);
    }
  });

  it("undo of deleteVessel restores contents and connections via destruction records", () => {
    const base = canonicalizeBody(clone(DEFAULT_DOCUMENT.body));
    const history = new History();
    const next = commitThrough(
      history,
      base,
      ROOT_ADDRESS,
      deleteVessel(clone(base), "back", { collapseOppositeNeighbors: true }).body,
      "delete back"
    );

    expect(next.vessels.back).toBeUndefined();
    const undone = undoOnto(history, next);
    expect(undone).toEqual(base);
    expect(undone.vessels.back.contains?.some((element) => element.id === "nested-backpack")).toBe(true);
  });

  it("lifts nested drawer edits to invertible root-level patches", () => {
    const base = canonicalizeBody(clone(DEFAULT_DOCUMENT.body));
    const address = "back/nested-backpack";
    const nested = clone(base.vessels.back.contains!.find((element) => element.id === "nested-backpack")!.body!);
    const edited = insertElement(nested, "top-pocket", { kind: "item", type: "tool", id: "flint" });

    const history = new History();
    const next = commitThrough(history, base, address, edited, "nested insert");
    const pocket = next.vessels.back.contains!.find((element) => element.id === "nested-backpack")!.body!.vessels["top-pocket"];
    expect(pocket.contains?.some((element) => element.id === "flint")).toBe(true);

    const undone = undoOnto(history, next);
    expect(undone).toEqual(base);
  });

  it("walks an entire session back to the initial preset with undo x N", () => {
    const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === "combatant")!;
    const base = canonicalizeBody(clone(preset.document.body));
    const history = new History();

    let current = base;
    current = commitThrough(history, current, ROOT_ADDRESS, insertVessel(clone(current), {}, { id: "arena-floor" }).body, "zone");
    current = commitThrough(
      history,
      current,
      ROOT_ADDRESS,
      applyStrike(clone(current), "head", WEAPONS[0], () => 0.5).body,
      "strike"
    );
    current = commitThrough(history, current, ROOT_ADDRESS, deleteVessel(clone(current), "arena-floor").body, "unzone");

    expect(history.past).toHaveLength(3);
    while (history.canUndo) current = undoOnto(history, current);
    expect(current).toEqual(base);

    while (history.canRedo) current = redoOnto(history, current);
    expect(parseDocument({ ...preset.document, body: current }).ok).toBe(true);
  });

  it("scrubs the timeline back and forward through composed patches", () => {
    const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === "combatant")!;
    const base = canonicalizeBody(clone(preset.document.body));
    const history = new History();

    let current = base;
    const checkpoints = [base];
    for (const target of ["head", "torso", "head"]) {
      current = commitThrough(history, current, ROOT_ADDRESS, applyStrike(clone(current), target, WEAPONS[1], () => 0.5).body, `strike ${target}`);
      checkpoints.push(current);
    }
    const end = current;

    const applySeek = (body: Body, seek: ReturnType<History["seekTo"]>): Body =>
      seek!.steps.reduce((acc, step) => assertOk(applyPatch(acc, step.patch)), body);

    // Scrub to 0 restores the pre-strike body exactly.
    const back = history.seekTo(0);
    expect(back).not.toBeNull();
    current = applySeek(current, back);
    expect(current).toEqual(base);
    expect(history.cursor).toBe(0);

    // Scrub to the middle matches the recorded checkpoint.
    current = applySeek(current, history.seekTo(2));
    expect(current).toEqual(checkpoints[2]);

    // Replay to the end reaches the identical final state.
    current = applySeek(current, history.seekTo(3));
    expect(current).toEqual(end);

    // Seeking to the current cursor is a no-op.
    expect(history.seekTo(3)).toBeNull();
  });

  it("truncates the future when a new commit lands mid-scrub", () => {
    const base = canonicalizeBody(clone(DEFAULT_DOCUMENT.body));
    const history = new History();
    let current = commitThrough(history, base, ROOT_ADDRESS, insertVessel(clone(base), {}, { id: "zone-a" }).body, "a");
    current = commitThrough(history, current, ROOT_ADDRESS, insertVessel(clone(current), {}, { id: "zone-b" }).body, "b");

    current = history.seekTo(1)!.steps.reduce((acc, step) => assertOk(applyPatch(acc, step.patch)), current);
    expect(history.entries).toHaveLength(2);

    commitThrough(history, current, ROOT_ADDRESS, insertVessel(clone(current), {}, { id: "zone-c" }).body, "c");
    expect(history.entries.map((entry) => entry.label)).toEqual(["a", "c"]);
    expect(history.canRedo).toBe(false);
  });

  it("derives identical sim patches from identical body and rng", () => {
    const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === "combatant")!;
    const base = canonicalizeBody(clone(preset.document.body));

    const patches = [0, 1].map(() => {
      const struck = applyStrike(clone(base), "head", WEAPONS[0], () => 0.5).body;
      return assertOk(diffBodies(base, struck));
    });
    expect(patches[0]).toStrictEqual(patches[1]);
  });

  it("inverts a severing strike cleanly through destruction records", () => {
    const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === "combatant")!;
    const base = canonicalizeBody(clone(preset.document.body));

    // High-momentum edged strikes on the neck eventually sever; drive until
    // the topology changes so the patch contains disconnect entries.
    let current = clone(base);
    let severed = false;
    for (let i = 0; i < 40 && !severed; i += 1) {
      current = applyStrike(current, "neck", WEAPONS.find((weapon) => weapon.id === "sword") ?? WEAPONS[1], () => 0.95).body;
      severed = Object.values(current.vessels.head?.ports ?? {}).length === 0;
    }
    expect(severed).toBe(true);

    const patch = assertOk(diffBodies(base, current));
    const after = assertOk(applyPatch(base, patch));
    const restored = assertOk(applyPatch(after, invertPatch(patch)));
    expect(restored).toEqual(base);
  });

  it("produces no patch entries for a no-op commit", () => {
    const base = canonicalizeBody(clone(DEFAULT_DOCUMENT.body));
    const patch = assertOk(diffBodies(base, clone(base)));
    expect(patch.patch).toHaveLength(0);
  });
});
