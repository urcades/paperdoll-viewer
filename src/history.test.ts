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

/** The funnel sequence from App.svelte, minus Svelte state. */
function commitThrough(history: History, prevRoot: Body, address: string, nextBody: Body, label: string): Body {
  const nextRoot = replaceBodyAtAddress(prevRoot, address, nextBody);
  const patch = assertOk(diffBodies(prevRoot, nextRoot));
  const applied = assertOk(applyPatch(prevRoot, patch));
  history.push({ patch, inverse: invertPatch(patch), label, tag: "construct", runId: null });
  return applied;
}

function undoOnto(history: History, body: Body): Body {
  const entry = history.undo();
  if (!entry) throw new Error("nothing to undo");
  return assertOk(applyPatch(body, entry.inverse));
}

function redoOnto(history: History, body: Body): Body {
  const entry = history.redo();
  if (!entry) throw new Error("nothing to redo");
  return assertOk(applyPatch(body, entry.patch));
}

function clone(body: Body): Body {
  return structuredClone(body);
}

describe("history store", () => {
  const emptyPatch: PaperfoldDocument = { protocol: "paperfold/v1", patch: [] };
  const entry = (label: string) => ({ patch: emptyPatch, inverse: emptyPatch, label, tag: "construct" as const, runId: null });

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

  it("produces no patch entries for a no-op commit", () => {
    const base = canonicalizeBody(clone(DEFAULT_DOCUMENT.body));
    const patch = assertOk(diffBodies(base, clone(base)));
    expect(patch.patch).toHaveLength(0);
  });
});
