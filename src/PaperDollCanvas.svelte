<script lang="ts">
  import { type Body } from "paperdoll";
  import type { Snippet } from "svelte";
  import BodyCanvas from "./BodyCanvas.svelte";
  import { type SelectionTarget, type ViewControls } from "./workbench";
  import type { PaperDollPreset, VesselPresentation } from "./sample-document";

  type Pan = {
    x: number;
    y: number;
  };

  type MutationMeta = {
    select?: SelectionTarget;
    status: string;
  };

  type Mode = "construct" | "play";

  type Props = {
    body: Body;
    presentation: Record<string, VesselPresentation>;
    selection: SelectionTarget | null;
    excludeVessels?: readonly string[];
    mode: Mode;
    status: string;
    canDelete: boolean;
    presets: readonly PaperDollPreset[];
    selectedPresetId: string;
    pan: Pan;
    viewControls: ViewControls;
    window?: Snippet;
    onModeChange: (mode: Mode) => void;
    onPresetChange: (presetId: string) => void;
    onViewControlsChange: (controls: ViewControls) => void;
    onPanChange: (pan: Pan) => void;
    onSelect: (target: SelectionTarget) => void;
    onOpenVessel: (id: string) => void;
    onMutate: (nextBody: Body, meta: MutationMeta) => void;
    onMutationError: (error: unknown) => void;
    onDeleteSelected: () => void;
  };

  let {
    body,
    presentation,
    selection,
    excludeVessels = [],
    mode,
    status,
    canDelete,
    presets,
    selectedPresetId,
    pan,
    viewControls,
    window,
    onModeChange,
    onPresetChange,
    onViewControlsChange,
    onPanChange,
    onSelect,
    onOpenVessel,
    onMutate,
    onMutationError,
    onDeleteSelected
  }: Props = $props();

  function updateViewControl(key: keyof ViewControls, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    const nextValue = clamp(Math.round(value), Number(input.min), Number(input.max));
    onViewControlsChange({ ...viewControls, [key]: nextValue });
  }

  function changePreset(event: Event): void {
    onPresetChange((event.currentTarget as HTMLSelectElement).value);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
</script>

<section class="surface" aria-label="Paper doll preview">
  <header>
    <div class="status" role="status">{status}</div>
    <div class="canvas-controls" aria-label="Canvas sizing controls">
      <div class="mode-toggle" role="group" aria-label="Editor mode">
        <button type="button" data-active={mode === "construct"} onclick={() => onModeChange("construct")}>construct</button>
        <button type="button" data-active={mode === "play"} onclick={() => onModeChange("play")}>play</button>
      </div>
      <label>
        <span>body</span>
        <select value={selectedPresetId} onchange={changePreset}>
          {#if selectedPresetId === "custom"}
            <option value="custom">Custom</option>
          {/if}
          {#each presets as preset (preset.id)}
            <option value={preset.id}>{preset.name}</option>
          {/each}
        </select>
      </label>
      <!-- Sizing controls hidden for now; re-enable to adjust canvas element sizes.
      <label>
        <span>vessel</span>
        <input
          type="number"
          min="24"
          max="96"
          step="2"
          value={viewControls.node}
          oninput={(event) => updateViewControl("node", event)}
        />
      </label>
      <label>
        <span>connector</span>
        <input
          type="number"
          min="12"
          max="120"
          step="2"
          value={viewControls.connector}
          oninput={(event) => updateViewControl("connector", event)}
        />
      </label>
      <label>
        <span>pad</span>
        <input
          type="number"
          min="0"
          max="180"
          step="4"
          value={viewControls.padding}
          oninput={(event) => updateViewControl("padding", event)}
        />
      </label>
      -->
      <button class="delete-node" type="button" disabled={!canDelete} onclick={onDeleteSelected}>delete</button>
    </div>
  </header>
  <BodyCanvas
    {body}
    {presentation}
    {viewControls}
    {selection}
    {excludeVessels}
    {pan}
    {onPanChange}
    {onSelect}
    {onOpenVessel}
    {onMutate}
    {onMutationError}
  />
  {@render window?.()}
</section>
