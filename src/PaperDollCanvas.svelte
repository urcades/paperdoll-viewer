<script lang="ts">
  import { SIDES, type Body, type DerivedLayout, type PaperDollDocument, type Side } from "paperdoll";
  import EmbeddedBodyWindow from "./EmbeddedBodyWindow.svelte";
  import {
    getBounds,
    getRenderNodes,
    getView,
    toCanvasPoint,
    type Bounds,
    type CanvasPoint,
    type RenderNode,
    type RenderView,
    type ViewControls
  } from "./workbench";
  import type { PaperDollPreset, VesselPresentation } from "./sample-document";

  type Pan = {
    x: number;
    y: number;
  };

  type ActivePan = {
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  };

  type PortPoint = CanvasPoint & {
    side: Side;
  };

  type EmbeddedBodyView = {
    title: string;
    body: Body;
  };

  type Props = {
    document: PaperDollDocument;
    layout: DerivedLayout;
    presentation: Record<string, VesselPresentation>;
    selectedId: string;
    status: string;
    canDelete: boolean;
    embeddedBodyView: EmbeddedBodyView | null;
    presets: readonly PaperDollPreset[];
    selectedPresetId: string;
    pan: Pan;
    viewControls: ViewControls;
    onPresetChange: (presetId: string) => void;
    onViewControlsChange: (controls: ViewControls) => void;
    onPanChange: (pan: Pan) => void;
    onSelectNode: (id: string) => void;
    onOpenEmbeddedBody: (id: string) => void;
    onCloseEmbeddedBody: () => void;
    onAddVessel: (vesselId: string, side: Side) => void;
    onAddZone: () => void;
    onDeleteSelected: () => void;
  };

  let {
    document,
    layout,
    presentation,
    selectedId,
    status,
    canDelete,
    embeddedBodyView,
    presets,
    selectedPresetId,
    pan,
    viewControls,
    onPresetChange,
    onViewControlsChange,
    onPanChange,
    onSelectNode,
    onOpenEmbeddedBody,
    onCloseEmbeddedBody,
    onAddVessel,
    onAddZone,
    onDeleteSelected
  }: Props = $props();

  let canvasEl: HTMLElement;
  let activePan: ActivePan | null = $state(null);
  let view: RenderView = $derived(getView(viewControls));
  let nodes: RenderNode[] = $derived(getRenderNodes(document, layout, presentation));
  let bounds: Bounds = $derived(getBounds(nodes, view));
  let nodeById: Map<string, RenderNode> = $derived(new Map(nodes.map((node) => [node.id, node])));
  let edges = $derived(
    layout.connections
      .map((edge) => {
        const fromNode = nodeById.get(edge.from.vessel);
        const toNode = nodeById.get(edge.to.vessel);
        if (!fromNode || !toNode) return null;
        return {
          key: `${edge.from.vessel}:${edge.from.side}-${edge.to.vessel}:${edge.to.side}`,
          path: getEdgePath(getPort(fromNode, edge.from.side), getPort(toNode, edge.to.side))
        };
      })
      .filter((edge): edge is { key: string; path: string } => Boolean(edge))
  );

  function beginCanvasPan(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as Element).closest(".slot")) return;

    event.preventDefault();
    activePan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y
    };
    canvasEl.setPointerCapture(event.pointerId);
  }

  function updateCanvasPan(event: PointerEvent): void {
    if (!activePan || event.pointerId !== activePan.pointerId) return;

    onPanChange({
      x: activePan.panX + event.clientX - activePan.x,
      y: activePan.panY + event.clientY - activePan.y
    });
  }

  function endCanvasPan(event: PointerEvent): void {
    if (!activePan || event.pointerId !== activePan.pointerId) return;

    activePan = null;
    if (canvasEl.hasPointerCapture(event.pointerId)) {
      canvasEl.releasePointerCapture(event.pointerId);
    }
  }

  function getPort(node: RenderNode, side: Side): PortPoint {
    const point = toCanvasPoint(node, view, bounds);
    const half = view.node / 2;
    const offsets: Record<Side, CanvasPoint> = {
      top: { x: 0, y: -half },
      right: { x: half, y: 0 },
      bottom: { x: 0, y: half },
      left: { x: -half, y: 0 }
    };

    return {
      x: point.x + offsets[side].x,
      y: point.y + offsets[side].y,
      side
    };
  }

  function getEdgePath(from: PortPoint, to: PortPoint): string {
    if (from.x === to.x || from.y === to.y) {
      return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }

    const horizontalFirst = from.side === "left" || from.side === "right";
    const corner = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    return `M ${from.x} ${from.y} L ${corner.x} ${corner.y} L ${to.x} ${to.y}`;
  }

  function describeNode(node: RenderNode): string {
    const item = node.item || "empty";
    const accepts = node.accepts?.join(", ") || "anything";
    return `${node.label}: ${item}. Accepts ${accepts}.`;
  }

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

  function hasEmbeddedBody(id: string): boolean {
    return Boolean(document.body.vessels[id]?.contains?.some((element) => element.body));
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
</script>

<section class="surface" aria-label="Paper doll preview">
  <header>
    <div class="status" role="status">{status}</div>
    <div class="canvas-controls" aria-label="Canvas sizing controls">
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
  <div
    class="canvas"
    role="application"
    aria-label="Paper doll canvas"
    bind:this={canvasEl}
    data-panning={activePan ? "true" : undefined}
    ondblclick={(event) => {
      if ((event.target as Element).closest(".slot")) return;
      event.preventDefault();
      onAddZone();
    }}
    onpointerdown={beginCanvasPan}
    onpointermove={updateCanvasPan}
    onpointerup={endCanvasPan}
    onpointercancel={endCanvasPan}
  >
    <div
      class="doll"
      style:--doll-width={`${bounds.width}px`}
      style:--doll-height={`${bounds.height}px`}
      style:--node={`${view.node}px`}
      style:--pan-x={`${pan.x}px`}
      style:--pan-y={`${pan.y}px`}
    >
      <svg class="edges" viewBox={`0 0 ${bounds.width} ${bounds.height}`} aria-hidden="true">
        {#each edges as edge (edge.key)}
          <path class="edge" d={edge.path}></path>
        {/each}
      </svg>

      {#each nodes as node (node.id)}
        {@const point = toCanvasPoint(node, view, bounds)}
        <div
          class="slot"
          data-node-id={node.id}
          data-kind={node.kind}
          style:left={`${point.x}px`}
          style:top={`${point.y}px`}
          role="button"
          tabindex="0"
          aria-pressed={node.id === selectedId}
          title={describeNode(node)}
          onclick={() => onSelectNode(node.id)}
          ondblclick={(event) => {
            if (!hasEmbeddedBody(node.id)) return;
            event.preventDefault();
            event.stopPropagation();
            onOpenEmbeddedBody(node.id);
          }}
          onkeydown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onSelectNode(node.id);
          }}
        >
          <span class="box">
            <span class="icon" aria-hidden="true">{node.icon || ""}</span>
          </span>

          {#if node.kind === "figure"}
            {#each SIDES as side (side)}
              <button
                class="node-handle"
                type="button"
                data-side={side}
                aria-label={`Add node ${side} of ${node.label}`}
                title={`Add node ${side}`}
                onclick={(event) => {
                  event.stopPropagation();
                  onAddVessel(node.id, side);
                }}
              ></button>
            {/each}
          {/if}
        </div>
        <span
          class="slot-label"
          data-selected={node.id === selectedId}
          style:left={`${point.x}px`}
          style:top={`${point.y + view.node / 2 + 7}px`}
        >
          {node.label}
        </span>
      {/each}
    </div>
  </div>
  {#if embeddedBodyView}
    <EmbeddedBodyWindow
      body={embeddedBodyView.body}
      title={embeddedBodyView.title}
      {viewControls}
      onClose={onCloseEmbeddedBody}
    />
  {/if}
</section>
