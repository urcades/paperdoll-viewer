<script lang="ts">
  import type { HistoryEntry } from "./history.svelte";

  type Props = {
    entries: readonly HistoryEntry[];
    cursor: number;
    onSeek: (index: number) => void;
  };

  let { entries, cursor, onSeek }: Props = $props();

  let playing = $state(false);
  let playTimer: ReturnType<typeof setInterval> | undefined;

  function stopPlayback(): void {
    playing = false;
    clearInterval(playTimer);
    playTimer = undefined;
  }

  function togglePlayback(): void {
    if (playing) {
      stopPlayback();
      return;
    }
    if (entries.length === 0) return;
    if (cursor >= entries.length) onSeek(0);
    playing = true;
    playTimer = setInterval(() => {
      if (cursor >= entries.length) {
        stopPlayback();
        return;
      }
      onSeek(cursor + 1);
    }, 600);
  }

  function scrub(event: Event): void {
    stopPlayback();
    onSeek(Number((event.currentTarget as HTMLInputElement).value));
  }

  $effect(() => () => clearInterval(playTimer));
</script>

{#if entries.length > 0}
  <div class="timeline" aria-label="Edit timeline">
    <button type="button" class="timeline-play" onclick={togglePlayback}>
      {playing ? "pause" : cursor >= entries.length ? "replay" : "play"}
    </button>
    <input
      type="range"
      class="timeline-scrubber"
      min="0"
      max={entries.length}
      step="1"
      value={cursor}
      oninput={scrub}
      aria-label="Timeline position"
    />
    <span class="timeline-label" title={entries[cursor - 1]?.label ?? "initial state"}>
      {cursor}/{entries.length}
      {#if cursor > 0}
        <em data-tag={entries[cursor - 1].tag}>{entries[cursor - 1].label}</em>
      {:else}
        <em>initial state</em>
      {/if}
    </span>
  </div>
{/if}
