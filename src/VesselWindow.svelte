<script lang="ts">
  import { type AcceptToken, type Body, type ContainedElement } from "paperdoll";
  import BodyCanvas from "./BodyCanvas.svelte";
  import {
    describeElement,
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

  type ElementListView = {
    elements: readonly ContainedElement[];
    accepts: readonly AcceptToken[] | undefined;
  };

  type Props = {
    title: string;
    // list view (window opened on a vessel) — null when showing a body canvas
    list: ElementListView | null;
    // canvas view (window opened into an embedded body)
    body: Body | null;
    // element drawer for a vessel double-clicked inside the canvas view
    drawer: (ElementListView & { title: string }) | null;
    viewControls: ViewControls;
    selection: SelectionTarget | null;
    dropTargets: ReadonlySet<string> | null;
    rejectVesselId: string | null;
    onOpenBodyElement: (index: number) => void;
    onDrawerOpenBodyElement: (index: number) => void;
    onBack: (() => void) | null;
    onClose: () => void;
    onDrawerClose: () => void;
    onSelect: (target: SelectionTarget) => void;
    onOpenVessel: (vesselId: string) => void;
    onMutate: (nextBody: Body, meta: MutationMeta) => void;
    onMutationError: (error: unknown) => void;
    onListPointerDown: (event: PointerEvent, index: number) => void;
    onDrawerPointerDown: (event: PointerEvent, index: number) => void;
    onElementPointerMove: (event: PointerEvent) => void;
    onElementPointerUp: (event: PointerEvent) => void;
  };

  let {
    title,
    list,
    body,
    drawer,
    viewControls,
    selection,
    dropTargets,
    rejectVesselId,
    onOpenBodyElement,
    onDrawerOpenBodyElement,
    onBack,
    onClose,
    onDrawerClose,
    onSelect,
    onOpenVessel,
    onMutate,
    onMutationError,
    onListPointerDown,
    onDrawerPointerDown,
    onElementPointerMove,
    onElementPointerUp
  }: Props = $props();

  let pan: Pan = $state({ x: 0, y: 0 });
  let presentation: Record<string, VesselPresentation> = $derived(body ? generatePresentation(body) : {});

  function tokenLabel(token: AcceptToken): string {
    return token.type ? `${token.kind}/${token.type}` : token.kind;
  }

  function acceptsLabel(accepts: readonly AcceptToken[] | undefined): string {
    if (accepts === undefined) return "accepts anything";
    if (accepts.length === 0) return "sealed — accepts nothing";
    return `accepts ${accepts.map(tokenLabel).join(", ")}`;
  }
</script>

{#snippet elementRows(
  view: ElementListView,
  onRowPointerDown: (event: PointerEvent, index: number) => void,
  onOpenBody: (index: number) => void
)}
  <ul class="element-list">
    {#each view.elements as element, index (index)}
      <li
        class="element-row"
        onpointerdown={(event) => onRowPointerDown(event, index)}
        onpointermove={onElementPointerMove}
        onpointerup={onElementPointerUp}
        onpointercancel={onElementPointerUp}
      >
        <div class="element-row-head">
          <span class="element-row-name">{describeElement(element)}</span>
          <span class="element-row-type">{element.type ? `${element.kind}/${element.type}` : element.kind}</span>
          {#if element.body}
            <button
              type="button"
              class="element-open"
              onpointerdown={(event) => event.stopPropagation()}
              onclick={() => onOpenBody(index)}
            >
              open body
            </button>
          {/if}
        </div>
        {#if element.data !== undefined}
          <pre class="element-data">{JSON.stringify(element.data, null, 2)}</pre>
        {/if}
      </li>
    {:else}
      <li class="element-empty">Empty — {acceptsLabel(view.accepts)}</li>
    {/each}
  </ul>
{/snippet}

<div class="embedded-body-window" role="dialog" aria-label={title} data-view={body ? "canvas" : "list"}>
  <header>
    <span class="window-title">
      {#if onBack}
        <button type="button" onclick={onBack}>back</button>
      {/if}
      {title}
    </span>
    <button type="button" onclick={onClose}>close</button>
  </header>
  {#if body}
    <div class="embedded-body-surface">
      <BodyCanvas
        {body}
        {presentation}
        {viewControls}
        {selection}
        {dropTargets}
        {rejectVesselId}
        {pan}
        onPanChange={(nextPan) => (pan = nextPan)}
        {onSelect}
        {onOpenVessel}
        {onMutate}
        {onMutationError}
      />
    </div>
    {#if drawer}
      <div class="element-drawer">
        <header>
          <span>{drawer.title}</span>
          <button type="button" onclick={onDrawerClose}>close</button>
        </header>
        {@render elementRows(drawer, onDrawerPointerDown, onDrawerOpenBodyElement)}
      </div>
    {/if}
  {:else if list}
    {@render elementRows(list, onListPointerDown, onOpenBodyElement)}
  {/if}
</div>
