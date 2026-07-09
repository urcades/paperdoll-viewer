<script lang="ts">
  import {
    deriveLayout,
    PAPER_DOLL_PROTOCOL,
    type Body,
    type DerivedLayout,
    type PaperDollDocument,
    type Side
  } from "paperdoll";
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
  import type { VesselPresentation } from "./sample-document";

  type Pan = {
    x: number;
    y: number;
  };

  type PortPoint = CanvasPoint & {
    side: Side;
  };

  type ActivePan = {
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  };

  type Props = {
    body: Body;
    title: string;
    viewControls: ViewControls;
    onClose: () => void;
  };

  let { body, title, viewControls, onClose }: Props = $props();

  let viewportEl: HTMLElement;
  let pan: Pan = $state({ x: 0, y: 0 });
  let activePan: ActivePan | null = $state(null);
  let view: RenderView = $derived(getView(viewControls));
  let document: PaperDollDocument = $derived({ protocol: PAPER_DOLL_PROTOCOL, body });
  let layout: DerivedLayout = $derived(deriveLayout(body));
  let presentation: Record<string, VesselPresentation> = $derived(getPresentation(body));
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

  function getPresentation(nextBody: Body): Record<string, VesselPresentation> {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return Object.fromEntries(
      Object.keys(nextBody.vessels).map((id, index) => [
        id,
        {
          label: formatLabel(id),
          icon: id === nextBody.root ? "@" : alphabet[index % alphabet.length]
        }
      ])
    );
  }

  function formatLabel(id: string): string {
    return id
      .split("-")
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join("\n");
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

  function beginPan(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as Element).closest(".slot")) return;

    event.preventDefault();
    activePan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y
    };
    viewportEl.setPointerCapture(event.pointerId);
  }

  function updatePan(event: PointerEvent): void {
    if (!activePan || event.pointerId !== activePan.pointerId) return;

    pan = {
      x: activePan.panX + event.clientX - activePan.x,
      y: activePan.panY + event.clientY - activePan.y
    };
  }

  function endPan(event: PointerEvent): void {
    if (!activePan || event.pointerId !== activePan.pointerId) return;

    activePan = null;
    if (viewportEl.hasPointerCapture(event.pointerId)) {
      viewportEl.releasePointerCapture(event.pointerId);
    }
  }
</script>

<div class="embedded-body-window" role="dialog" aria-label={title}>
  <header>
    <span>{title}</span>
    <button type="button" onclick={onClose}>close</button>
  </header>
  <div
    class="embedded-body-viewport"
    role="application"
    aria-label={`${title} canvas`}
    bind:this={viewportEl}
    data-panning={activePan ? "true" : undefined}
    onpointerdown={beginPan}
    onpointermove={updatePan}
    onpointerup={endPan}
    onpointercancel={endPan}
  >
    <div
      class="embedded-body-canvas"
      style:--embedded-width={`${bounds.width}px`}
      style:--embedded-height={`${bounds.height}px`}
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
          class="slot embedded-slot"
          data-kind={node.kind}
          style:left={`${point.x}px`}
          style:top={`${point.y}px`}
          title={node.item ? `${node.label}: ${node.item}` : node.label}
        >
          <span class="box">
            <span class="icon" aria-hidden="true">{node.icon || ""}</span>
          </span>
        </div>
        <span
          class="slot-label embedded-slot-label"
          style:left={`${point.x}px`}
          style:top={`${point.y + view.node / 2 + 7}px`}
        >
          {node.label}
        </span>
      {/each}
    </div>
  </div>
</div>
