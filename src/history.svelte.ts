// Unified edit history over paperfold patches, scene-aware. A history entry
// carries one patch per touched body (a cross-body drag touches two), plus a
// tag distinguishing construction edits from simulation ticks. Undo/redo and
// seekTo return proxy-free snapshots — paperfold's internals reject $state
// proxies.

import { composePatches, type PaperfoldDocument } from "paperfold";
import type { Relation } from "paperchain";

export type HistoryTag = "construct" | "sim";

export type BodyStep = {
  bodyName: string;
  patch: PaperfoldDocument;
  inverse: PaperfoldDocument;
};

// Scene-level operations (relations) that paperfold cannot express — patches
// speak only of one body's vessels. Their inverse is the opposite op, so they
// invert without destruction records. This asymmetry is a protocol gap worth
// reading about in docs/postmortem.md.
export type SceneOp = { op: "addRelation" | "removeRelation"; relation: Relation };

export type HistoryEntry = {
  steps: BodyStep[];
  sceneOps?: SceneOp[];
  label: string;
  tag: HistoryTag;
  runId: number | null;
};

/** A directed step ready to apply: which body, and the patch to run. */
export type AppliedStep = { bodyName: string; patch: PaperfoldDocument };

function invertSceneOp(sceneOp: SceneOp): SceneOp {
  return {
    op: sceneOp.op === "addRelation" ? "removeRelation" : "addRelation",
    relation: sceneOp.relation
  };
}

export class History {
  past = $state<HistoryEntry[]>([]);
  future = $state<HistoryEntry[]>([]);

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  push(entry: HistoryEntry): void {
    this.past.push(entry);
    this.future = [];
  }

  /** Pop the newest entry; returns steps and scene ops to apply, all inverted. */
  undo(): { label: string; steps: AppliedStep[]; sceneOps: SceneOp[] } | null {
    const entry = this.past.pop() ?? null;
    if (!entry) return null;
    this.future.push(entry);
    const snapshot = $state.snapshot(entry) as HistoryEntry;
    return {
      label: snapshot.label,
      steps: snapshot.steps
        .slice()
        .reverse()
        .map((step) => ({ bodyName: step.bodyName, patch: step.inverse })),
      sceneOps: (snapshot.sceneOps ?? []).slice().reverse().map(invertSceneOp)
    };
  }

  /** Pop the newest undone entry; returns the forward steps and scene ops. */
  redo(): { label: string; steps: AppliedStep[]; sceneOps: SceneOp[] } | null {
    const entry = this.future.pop() ?? null;
    if (!entry) return null;
    this.past.push(entry);
    const snapshot = $state.snapshot(entry) as HistoryEntry;
    return {
      label: snapshot.label,
      steps: snapshot.steps.map((step) => ({ bodyName: step.bodyName, patch: step.patch })),
      sceneOps: snapshot.sceneOps ?? []
    };
  }

  /** History barrier: preset swaps and source-panel rewrites aren't diffable edits. */
  clear(): void {
    this.past = [];
    this.future = [];
  }

  /** All entries in chronological order; `cursor` marks how many have been applied. */
  get entries(): HistoryEntry[] {
    return [...this.past, ...this.future.slice().reverse()];
  }

  get cursor(): number {
    return this.past.length;
  }

  /**
   * Move the cursor to `index` (0 = before the first entry) and return one
   * composed patch per touched body carrying it there — inverses when
   * scrubbing back, forward patches when replaying. Null when already there.
   */
  seekTo(index: number): { steps: AppliedStep[]; sceneOps: SceneOp[] } | null {
    const steps: AppliedStep[] = [];
    const sceneOps: SceneOp[] = [];
    const target = Math.max(0, Math.min(index, this.past.length + this.future.length));
    while (this.past.length > target) {
      const entry = this.past.pop()!;
      this.future.push(entry);
      const snapshot = $state.snapshot(entry) as HistoryEntry;
      for (const step of snapshot.steps.slice().reverse()) {
        steps.push({ bodyName: step.bodyName, patch: step.inverse });
      }
      sceneOps.push(...(snapshot.sceneOps ?? []).slice().reverse().map(invertSceneOp));
    }
    while (this.past.length < target && this.future.length > 0) {
      const entry = this.future.pop()!;
      this.past.push(entry);
      const snapshot = $state.snapshot(entry) as HistoryEntry;
      for (const step of snapshot.steps) {
        steps.push({ bodyName: step.bodyName, patch: step.patch });
      }
      sceneOps.push(...(snapshot.sceneOps ?? []));
    }
    if (steps.length === 0 && sceneOps.length === 0) return null;

    // Compose per body, preserving each body's step order — patches for
    // different bodies are independent.
    const order: string[] = [];
    const composed = new Map<string, PaperfoldDocument>();
    for (const step of steps) {
      const existing = composed.get(step.bodyName);
      if (!existing) {
        order.push(step.bodyName);
        composed.set(step.bodyName, step.patch);
      } else {
        composed.set(step.bodyName, composePatches(existing, step.patch));
      }
    }
    return { steps: order.map((bodyName) => ({ bodyName, patch: composed.get(bodyName)! })), sceneOps };
  }
}
