<script lang="ts">
  import { type Body } from "paperdoll";
  import { WEAPONS } from "./combat";
  import type { Snippet } from "svelte";
  import BodyCanvas from "./BodyCanvas.svelte";
  import { type SelectionTarget, type ViewControls } from "./workbench";
  import type { PaperDollPreset, VesselPresentation } from "./sample-document";
  import type { ProfileVerdict } from "./profiles";

  type Pan = {
    x: number;
    y: number;
  };

  type MutationMeta = {
    select?: SelectionTarget;
    status: string;
  };

  type Props = {
    body: Body;
    presentation: Record<string, VesselPresentation>;
    selection: SelectionTarget | null;
    excludeVessels?: readonly string[];
    dropTargets?: ReadonlySet<string> | null;
    rejectVesselId?: string | null;
    status: string;
    canDelete: boolean;
    canUndo: boolean;
    canRedo: boolean;
    verdicts?: readonly ProfileVerdict[];
    onVerdictClick?: (verdict: ProfileVerdict) => void;
    canStrike: boolean;
    weaponId: string;
    bleeding: boolean;
    canRun: boolean;
    running: boolean;
    presets: readonly PaperDollPreset[];
    selectedPresetId: string;
    pan: Pan;
    viewControls: ViewControls;
    window?: Snippet;
    onPresetChange: (presetId: string) => void;
    onViewControlsChange: (controls: ViewControls) => void;
    onPanChange: (pan: Pan) => void;
    onSelect: (target: SelectionTarget) => void;
    onOpenVessel: (id: string) => void;
    onMutate: (nextBody: Body, meta: MutationMeta) => void;
    onMutationError: (error: unknown) => void;
    onDeleteSelected: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onWeaponChange: (weaponId: string) => void;
    onStrike: () => void;
    onToggleBleed: () => void;
    onHeal: () => void;
    onPulse: () => void;
    onToggleRun: () => void;
  };

  let {
    body,
    presentation,
    selection,
    excludeVessels = [],
    dropTargets = null,
    rejectVesselId = null,
    status,
    canDelete,
    canUndo,
    canRedo,
    verdicts = [],
    onVerdictClick,
    canStrike,
    weaponId,
    bleeding,
    canRun,
    running,
    presets,
    selectedPresetId,
    pan,
    viewControls,
    window,
    onPresetChange,
    onViewControlsChange,
    onPanChange,
    onSelect,
    onOpenVessel,
    onMutate,
    onMutationError,
    onDeleteSelected,
    onUndo,
    onRedo,
    onWeaponChange,
    onStrike,
    onToggleBleed,
    onHeal,
    onPulse,
    onToggleRun
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
    <label class="body-select">
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
    {#if verdicts.length > 0}
      <div class="profile-badges" aria-label="Profile conformance">
        {#each verdicts as verdict (verdict.profileId)}
          <button
            type="button"
            class="profile-badge"
            data-conforms={verdict.conforms}
            title={verdict.conforms ? `conforms to ${verdict.profileId}` : `fails ${verdict.profileId} — click for details`}
            onclick={() => onVerdictClick?.(verdict)}
          >
            {verdict.conforms ? "✓" : "✗"} {verdict.profileId}
          </button>
        {/each}
      </div>
    {/if}
    <div class="canvas-controls" aria-label="Canvas actions">
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
      {#if canStrike}
        <select
          class="weapon-select"
          value={weaponId}
          onchange={(event) => onWeaponChange((event.currentTarget as HTMLSelectElement).value)}
        >
          {#each WEAPONS as weapon (weapon.id)}
            <option value={weapon.id}>{weapon.name}</option>
          {/each}
        </select>
        <button class="damage-button" type="button" onclick={onStrike}>strike</button>
        <button class="heal-button" type="button" data-active={bleeding} onclick={onToggleBleed}>
          {bleeding ? "stop bleed" : "bleed"}
        </button>
        <button class="heal-button" type="button" onclick={onHeal}>heal</button>
      {/if}
      {#if canRun}
        <button class="damage-button" type="button" onclick={onPulse}>pulse</button>
        <button class="heal-button" type="button" data-active={running} onclick={onToggleRun}>
          {running ? "stop" : "run"}
        </button>
      {/if}
      <button class="heal-button" type="button" disabled={!canUndo} onclick={onUndo}>undo</button>
      <button class="heal-button" type="button" disabled={!canRedo} onclick={onRedo}>redo</button>
      <button class="delete-node" type="button" disabled={!canDelete} onclick={onDeleteSelected}>delete</button>
    </div>
  </header>
  <BodyCanvas
    {body}
    {presentation}
    {viewControls}
    {selection}
    {excludeVessels}
    {dropTargets}
    {rejectVesselId}
    {pan}
    {onPanChange}
    {onSelect}
    {onOpenVessel}
    {onMutate}
    {onMutationError}
  />
  {#if status}
    <div class="status-toast" role="status">{status}</div>
  {/if}
  {@render window?.()}
</section>
