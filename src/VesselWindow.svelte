<script lang="ts">
  import { type Body } from "paperdoll";
  import BodyCanvas from "./BodyCanvas.svelte";
  import {
    generatePresentation,
    type SelectionTarget,
    type ViewControls
  } from "./workbench";
  import type { VesselPresentation } from "./sample-document";

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
    title: string;
    viewControls: ViewControls;
    selection: SelectionTarget | null;
    onSelect: (target: SelectionTarget) => void;
    onOpenVessel: (vesselId: string) => void;
    onMutate: (nextBody: Body, meta: MutationMeta) => void;
    onMutationError: (error: unknown) => void;
    onClose: () => void;
  };

  let {
    body,
    title,
    viewControls,
    selection,
    onSelect,
    onOpenVessel,
    onMutate,
    onMutationError,
    onClose
  }: Props = $props();

  let pan: Pan = $state({ x: 0, y: 0 });
  let presentation: Record<string, VesselPresentation> = $derived(generatePresentation(body));
</script>

<div class="embedded-body-window" role="dialog" aria-label={title}>
  <header>
    <span>{title}</span>
    <button type="button" onclick={onClose}>close</button>
  </header>
  <div class="embedded-body-surface">
    <BodyCanvas
      {body}
      {presentation}
      {viewControls}
      {selection}
      {pan}
      onPanChange={(nextPan) => (pan = nextPan)}
      {onSelect}
      {onOpenVessel}
      {onMutate}
      {onMutationError}
    />
  </div>
</div>
