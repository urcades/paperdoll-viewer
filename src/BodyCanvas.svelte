<script lang="ts">
  import {
    connect,
    insertVessel,
    OPPOSITE_SIDES,
    PAPER_DOLL_PROTOCOL,
    SIDES,
    deriveLayout,
    type Body,
    type DerivedLayout,
    type Endpoint,
    type PaperDollDocument,
    type Side
  } from "paperdoll";
  import {
    getBounds,
    legalConnectTargets,
    getRenderNodes,
    getView,
    toCanvasPoint,
    type Bounds,
    type CanvasPoint,
    type RenderNode,
    type RenderView,
    type SelectionTarget,
    type ViewControls
  } from "./workbench";
  import type { VesselPresentation } from "./sample-document";

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

  type MutationMeta = {
    select?: SelectionTarget;
    status: string;
  };

  type Props = {
    body: Body;
    presentation: Record<string, VesselPresentation>;
    viewControls: ViewControls;
    selection: SelectionTarget | null;
    excludeVessels?: readonly string[];
    dropTargets?: ReadonlySet<string> | null;
    rejectVesselId?: string | null;
    pan: Pan;
    onPanChange: (pan: Pan) => void;
    onSelect: (target: SelectionTarget) => void;
    onOpenVessel: (vesselId: string) => void;
    onMutate: (nextBody: Body, meta: MutationMeta) => void;
    onMutationError: (error: unknown) => void;
  };

  let {
    body,
    presentation,
    viewControls,
    selection,
    excludeVessels = [],
    dropTargets = null,
    rejectVesselId = null,
    pan,
    onPanChange,
    onSelect,
    onOpenVessel,
    onMutate,
    onMutationError
  }: Props = $props();

  type ConnectDrag = {
    pointerId: number;
    from: Endpoint;
    originX: number;
    originY: number;
    active: boolean;
    targets: Set<string>;
  };

  let canvasEl: HTMLElement;
  let activePan: ActivePan | null = $state(null);
  let connectDrag = $state<ConnectDrag | null>(null);
  let suppressHandleClick = false;
  let view: RenderView = $derived(getView(viewControls));
  let document: PaperDollDocument = $derived({ protocol: PAPER_DOLL_PROTOCOL, body });
  let layout: DerivedLayout = $derived(deriveLayout(body));
  let nodes: RenderNode[] = $derived(getRenderNodes(document, layout, presentation, excludeVessels));
  let bounds: Bounds = $derived(getBounds(nodes, view));
  let nodeById: Map<string, RenderNode> = $derived(new Map(nodes.map((node) => [node.id, node])));
  let selectedVesselId = $derived(selection?.kind === "vessel" ? selection.id : null);
  let edges = $derived(
    layout.connections
      .map((edge) => {
        const fromNode = nodeById.get(edge.from.vessel);
        const toNode = nodeById.get(edge.to.vessel);
        if (!fromNode || !toNode) return null;
        return {
          key: `${edge.from.vessel}:${edge.from.side}-${edge.to.vessel}:${edge.to.side}`,
          from: edge.from,
          to: edge.to,
          selected: isConnectionSelected(edge.from, edge.to),
          path: getEdgePath(getPort(fromNode, edge.from.side), getPort(toNode, edge.to.side))
        };
      })
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
  );

  function isConnectionSelected(from: Endpoint, to: Endpoint): boolean {
    if (selection?.kind !== "connection") return false;
    const matches = (a: Endpoint, b: Endpoint) => a.vessel === b.vessel && a.side === b.side;
    return (
      (matches(selection.from, from) && matches(selection.to, to)) ||
      (matches(selection.from, to) && matches(selection.to, from))
    );
  }

  function endpointKey(endpoint: Endpoint): string {
    return `${endpoint.vessel}:${endpoint.side}`;
  }

  function beginConnectDrag(event: PointerEvent, vesselId: string, side: Side): void {
    if (event.button !== 0) return;
    connectDrag = {
      pointerId: event.pointerId,
      from: { vessel: vesselId, side },
      originX: event.clientX,
      originY: event.clientY,
      active: false,
      targets: new Set()
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  function updateConnectDrag(event: PointerEvent): void {
    if (!connectDrag || event.pointerId !== connectDrag.pointerId) return;
    if (!connectDrag.active) {
      const distance = Math.hypot(event.clientX - connectDrag.originX, event.clientY - connectDrag.originY);
      if (distance < 4) return;
      connectDrag = {
        ...connectDrag,
        active: true,
        targets: new Set(legalConnectTargets(body, connectDrag.from).map(endpointKey))
      };
    }
  }

  function endConnectDrag(event: PointerEvent): void {
    if (!connectDrag || event.pointerId !== connectDrag.pointerId) return;
    const drag = connectDrag;
    connectDrag = null;
    if (!drag.active) return;

    suppressHandleClick = true;
    const dropHandle = window.document.elementFromPoint(event.clientX, event.clientY)?.closest(".node-handle");
    const dropSlot = dropHandle?.closest(".slot");
    if (!dropHandle || !dropSlot) return;

    const target: Endpoint = {
      vessel: (dropSlot as HTMLElement).dataset.nodeId!,
      side: (dropHandle as HTMLElement).dataset.side as Side
    };
    if (!drag.targets.has(endpointKey(target))) return;

    try {
      const { body: nextBody } = connect(body, drag.from, target);
      onMutate(nextBody, {
        select: { kind: "vessel", id: drag.from.vessel },
        status: `Connected ${drag.from.vessel} to ${target.vessel}`
      });
    } catch (error) {
      onMutationError(error);
    }
  }

  function handleClicked(vesselId: string, side: Side): void {
    if (suppressHandleClick) {
      suppressHandleClick = false;
      return;
    }
    if (!layout.figure[vesselId]) {
      onMutationError(new Error(`Drag from a face to connect ${vesselId} into the figure`));
      return;
    }
    addVessel(vesselId, side);
  }

  function addVessel(vesselId: string, side: Side): void {
    try {
      const neighborId = findAdjacentVessel(vesselId, side);
      if (neighborId && !body.vessels[vesselId].ports?.[side]) {
        const { body: nextBody } = connect(
          body,
          { vessel: vesselId, side },
          { vessel: neighborId, side: OPPOSITE_SIDES[side] }
        );
        onMutate(nextBody, {
          select: { kind: "vessel", id: vesselId },
          status: `Connected ${vesselId} to ${neighborId}`
        });
        return;
      }

      const result = insertVessel(body, {}, { at: { vessel: vesselId, side } });
      onMutate(result.body, {
        select: { kind: "vessel", id: result.vesselId },
        status: `Added ${result.vesselId}`
      });
    } catch (error) {
      onMutationError(error);
    }
  }

  function addZone(): void {
    try {
      const result = insertVessel(body);
      onMutate(result.body, {
        select: { kind: "vessel", id: result.vesselId },
        status: `Added free ${result.vesselId}`
      });
    } catch (error) {
      onMutationError(error);
    }
  }

  function findAdjacentVessel(vesselId: string, side: Side): string | null {
    const position = layout.figure[vesselId];
    if (!position) return null;

    const vectors: Record<Side, { x: number; y: number }> = {
      top: { x: 0, y: -1 },
      right: { x: 1, y: 0 },
      bottom: { x: 0, y: 1 },
      left: { x: -1, y: 0 }
    };
    const target = { x: position.x + vectors[side].x, y: position.y + vectors[side].y };
    const neighbor = Object.entries(layout.figure).find(
      ([, candidate]) => candidate.x === target.x && candidate.y === target.y
    );
    return neighbor?.[0] ?? null;
  }

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
</script>

<div
  class="canvas"
  role="application"
  aria-label="Paper doll canvas"
  bind:this={canvasEl}
  data-panning={activePan ? "true" : undefined}
  ondblclick={(event) => {
    if ((event.target as Element).closest(".slot")) return;
    event.preventDefault();
    addZone();
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
    <svg class="edges" viewBox={`0 0 ${bounds.width} ${bounds.height}`}>
      {#each edges as edge (edge.key)}
        <path class="edge" data-selected={edge.selected} d={edge.path}></path>
        <path
          class="edge-hit"
          d={edge.path}
          role="button"
          tabindex="-1"
          aria-label={`Connection ${edge.from.vessel} to ${edge.to.vessel}`}
          onclick={(event) => {
            event.stopPropagation();
            onSelect({ kind: "connection", from: edge.from, to: edge.to });
          }}
          onkeydown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onSelect({ kind: "connection", from: edge.from, to: edge.to });
          }}
        ></path>
      {/each}
    </svg>

    {#each nodes as node (node.id)}
      {@const point = toCanvasPoint(node, view, bounds)}
      <div
        class="slot"
        data-node-id={node.id}
        data-kind={node.kind}
        data-drop={dropTargets ? (dropTargets.has(node.id) ? "legal" : "illegal") : undefined}
        data-reject={node.id === rejectVesselId ? "true" : undefined}
        data-dead={node.hp?.current === 0 ? "true" : undefined}
        style:left={`${point.x}px`}
        style:top={`${point.y}px`}
        role="button"
        tabindex="0"
        aria-pressed={node.id === selectedVesselId}
        title={describeNode(node)}
        onclick={() => onSelect({ kind: "vessel", id: node.id })}
        ondblclick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenVessel(node.id);
        }}
        onkeydown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect({ kind: "vessel", id: node.id });
        }}
      >
        <span class="box">
          <span class="icon" aria-hidden="true">{node.icon || ""}</span>
        </span>

        {#each SIDES as side (side)}
          <button
            class="node-handle"
            type="button"
            data-side={side}
            data-target={connectDrag?.active
              ? connectDrag.targets.has(`${node.id}:${side}`)
                ? "legal"
                : "illegal"
              : undefined}
            aria-label={`Add node ${side} of ${node.label}`}
            title={`Add node ${side}`}
            onclick={(event) => {
              event.stopPropagation();
              handleClicked(node.id, side);
            }}
            onpointerdown={(event) => beginConnectDrag(event, node.id, side)}
            onpointermove={updateConnectDrag}
            onpointerup={endConnectDrag}
            onpointercancel={() => (connectDrag = null)}
          ></button>
        {/each}
      </div>
      <span
        class="slot-label"
        data-selected={node.id === selectedVesselId}
        style:left={`${point.x}px`}
        style:top={`${point.y + view.node / 2 + 7}px`}
      >
        {node.hp ? `${node.label}\n${node.hp.current}/${node.hp.max}` : node.label}
      </span>
    {/each}
  </div>
</div>
