// Unified edit history over paperfold patches. Construction edits and
// simulation ticks share one stack (separate stacks would make "undo a
// construction edit under a sim run" incoherent); entries are distinguished
// by tag. Undo/redo return the patch to apply — the App commit funnel applies
// it and refreshes derived state without pushing a new entry.

import type { PaperfoldDocument } from "paperfold";

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
}
