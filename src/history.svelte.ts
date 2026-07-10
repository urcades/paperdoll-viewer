// Unified edit history over paperfold/v2 scene patches — one currency.
// Every entry is a single invertible ScenePatchDocument covering whatever the
// commit touched: vessels and elements in any body, cross-body transfers,
// and relation edits all travel in the same patch (paperchain's strict-
// dangling law makes the cleanup part of the transaction). Undo/redo and
// seekTo return proxy-free snapshots — paperfold's internals reject $state
// proxies.

import { composeScenePatches, type ScenePatchDocument } from "paperfold";

export type HistoryTag = "construct" | "sim";

export type HistoryEntry = {
  patch: ScenePatchDocument;
  inverse: ScenePatchDocument;
  label: string;
  tag: HistoryTag;
  runId: number | null;
};

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

  /** Pop the newest entry; apply the returned patch to walk back. */
  undo(): { label: string; patch: ScenePatchDocument } | null {
    const entry = this.past.pop() ?? null;
    if (!entry) return null;
    this.future.push(entry);
    const snapshot = $state.snapshot(entry) as HistoryEntry;
    return { label: snapshot.label, patch: snapshot.inverse };
  }

  /** Pop the newest undone entry; apply the returned patch to walk forward. */
  redo(): { label: string; patch: ScenePatchDocument } | null {
    const entry = this.future.pop() ?? null;
    if (!entry) return null;
    this.past.push(entry);
    const snapshot = $state.snapshot(entry) as HistoryEntry;
    return { label: snapshot.label, patch: snapshot.patch };
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
   * composed scene patch carrying the scene there — inverses when scrubbing
   * back, forward patches when replaying. Null when already there.
   */
  seekTo(index: number): ScenePatchDocument | null {
    const steps: ScenePatchDocument[] = [];
    const target = Math.max(0, Math.min(index, this.past.length + this.future.length));
    while (this.past.length > target) {
      const entry = this.past.pop()!;
      this.future.push(entry);
      steps.push(($state.snapshot(entry) as HistoryEntry).inverse);
    }
    while (this.past.length < target && this.future.length > 0) {
      const entry = this.future.pop()!;
      this.past.push(entry);
      steps.push(($state.snapshot(entry) as HistoryEntry).patch);
    }
    if (steps.length === 0) return null;
    return steps.reduce((composed, step) => composeScenePatches(composed, step));
  }
}
