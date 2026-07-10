// Unified edit history over paperfold patches. Construction edits and
// simulation ticks share one stack (separate stacks would make "undo a
// construction edit under a sim run" incoherent); entries are distinguished
// by tag. Undo/redo return the patch to apply — the App commit funnel applies
// it and refreshes derived state without pushing a new entry.

import { composePatches, type PaperfoldDocument } from "paperfold";

export type HistoryTag = "construct" | "sim";

export type HistoryEntry = {
  patch: PaperfoldDocument;
  inverse: PaperfoldDocument;
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

  /** Pop the newest entry; apply its `inverse` to walk back. */
  undo(): HistoryEntry | null {
    const entry = this.past.pop() ?? null;
    if (entry) this.future.push(entry);
    // Snapshot on the way out: stored entries are $state proxies, which
    // paperfold's internals (structuredClone) reject.
    return entry ? ($state.snapshot(entry) as HistoryEntry) : null;
  }

  /** Pop the newest undone entry; apply its `patch` to walk forward. */
  redo(): HistoryEntry | null {
    const entry = this.future.pop() ?? null;
    if (entry) this.past.push(entry);
    return entry ? ($state.snapshot(entry) as HistoryEntry) : null;
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
   * Move the cursor to `index` (0 = before the first entry) and return the
   * single composed patch that carries the body there — inverses when
   * scrubbing back, forward patches when replaying. Null when already there.
   */
  seekTo(index: number): PaperfoldDocument | null {
    const steps: PaperfoldDocument[] = [];
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
    return steps.reduce((composed, step) => composePatches(composed, step));
  }
}
