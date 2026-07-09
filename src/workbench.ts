import {
  connect,
  disconnect,
  isAccepted,
  OPPOSITE_SIDES,
  PAPER_DOLL_PROTOCOL,
  validateDocument,
  type Body,
  type ContainedElement,
  type DerivedLayout,
  type DerivedPosition,
  type Endpoint,
  type PaperDollDocument,
  type VesselId
} from "paperdoll";
import type { VesselPresentation } from "./sample-document";

export type BodyPathSegment = {
  vessel: VesselId;
  elementIndex: number;
};

export type BodyPath = readonly BodyPathSegment[];

export type SelectionTarget =
  | { kind: "vessel"; id: VesselId }
  | { kind: "connection"; from: Endpoint; to: Endpoint };

export function pathsEqual(a: BodyPath, b: BodyPath): boolean {
  return a.length === b.length && a.every((segment, index) => segment.vessel === b[index].vessel && segment.elementIndex === b[index].elementIndex);
}

export type RenderView = {
  node: number;
  connector: number;
  padding: number;
  step: number;
};

export type ViewControls = {
  node: number;
  connector: number;
  padding: number;
};

export type Bounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

export type RenderNode = {
  id: string;
  kind: "figure" | "free";
  x: number;
  y: number;
  label: string;
  icon?: string;
  accepts?: readonly string[];
  item?: string;
};

export function getView(controls: ViewControls): RenderView {
  return {
    node: controls.node,
    connector: controls.connector,
    padding: controls.padding,
    step: controls.node + controls.connector
  };
}

export function getRenderNodes(
  document: PaperDollDocument,
  layout: DerivedLayout,
  presentation: Record<string, VesselPresentation>,
  excludeIds: readonly string[] = []
): RenderNode[] {
  const excluded = new Set(excludeIds);
  const figureNodes = Object.entries(layout.figure)
    .filter(([id]) => !excluded.has(id))
    .map(([id, position]) => toRenderNode(document, presentation, id, position, "figure"));
  const figureBottom = Math.max(0, ...figureNodes.map((node) => node.y));
  const freeNodes = layout.free
    .filter((id) => !excluded.has(id))
    .map((id, index) => toRenderNode(document, presentation, id, { x: index, y: figureBottom + 2 }, "free"));
  return [...figureNodes, ...freeNodes];
}

export function getBounds(nodes: readonly RenderNode[], view: RenderView): Bounds {
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  return {
    minX,
    minY,
    width: (maxX - minX) * view.step + view.node + view.padding * 2,
    height: (maxY - minY) * view.step + view.node + view.padding * 2
  };
}

export function toCanvasPoint(node: RenderNode, view: RenderView, bounds: Bounds): CanvasPoint {
  return {
    x: (node.x - bounds.minX) * view.step + view.padding,
    y: (node.y - bounds.minY) * view.step + view.padding
  };
}

function toRenderNode(
  document: PaperDollDocument,
  presentation: Record<string, VesselPresentation>,
  id: string,
  position: DerivedPosition,
  kind: RenderNode["kind"]
): RenderNode {
  const vessel = document.body.vessels[id];
  const vesselPresentation = presentation[id];
  return {
    id,
    kind,
    x: position.x,
    y: position.y,
    label: vesselPresentation?.label ?? id,
    icon: vesselPresentation?.icon,
    accepts: vessel?.accepts?.map((token) => (token.type ? `${token.kind}/${token.type}` : token.kind)),
    item: vessel?.contains?.map(formatElement).join(", ")
  };
}

function formatElement(element: { kind: string; type?: string; id?: string }): string {
  return element.id ?? (element.type ? `${element.kind}/${element.type}` : element.kind);
}

export function getBodyAtPath(root: Body, path: BodyPath): Body | null {
  let body = root;
  for (const segment of path) {
    const next = body.vessels[segment.vessel]?.contains?.[segment.elementIndex]?.body;
    if (!next) return null;
    body = next;
  }
  return body;
}

export function replaceBodyAtPath(root: Body, path: BodyPath, next: Body): Body {
  if (path.length === 0) return next;

  const [{ vessel, elementIndex }, ...rest] = path;
  const container = root.vessels[vessel];
  const element = container?.contains?.[elementIndex];
  if (!element?.body) {
    throw new Error(`No embedded body at ${vessel}[${elementIndex}]`);
  }

  const contains = container.contains!.map((candidate, index) =>
    index === elementIndex ? { ...candidate, body: replaceBodyAtPath(candidate.body!, rest, next) } : candidate
  );
  return {
    ...root,
    vessels: {
      ...root.vessels,
      [vessel]: { ...container, contains }
    }
  };
}

export function canDisconnect(body: Body, endpoint: Endpoint): boolean {
  try {
    const next = disconnect(body, endpoint);
    return validateDocument({ protocol: PAPER_DOLL_PROTOCOL, body: next }).length === 0;
  } catch {
    return false;
  }
}

export function legalConnectTargets(body: Body, from: Endpoint): Endpoint[] {
  if (body.vessels[from.vessel]?.ports?.[from.side]) return [];

  const side = OPPOSITE_SIDES[from.side];
  const targets: Endpoint[] = [];
  for (const vesselId of Object.keys(body.vessels)) {
    if (vesselId === from.vessel) continue;
    if (body.vessels[vesselId].ports?.[side]) continue;
    try {
      const next = connect(body, from, { vessel: vesselId, side });
      if (validateDocument({ protocol: PAPER_DOLL_PROTOCOL, body: next }).length === 0) {
        targets.push({ vessel: vesselId, side });
      }
    } catch {
      // illegal candidate — not offered
    }
  }
  return targets;
}

export function legalDropVessels(
  body: Body,
  element: ContainedElement,
  sourceVesselId: VesselId
): VesselId[] {
  return Object.keys(body.vessels).filter(
    (id) => id !== sourceVesselId && isAccepted(body.vessels[id], element)
  );
}

export function describeElement(element: ContainedElement): string {
  return element.id ?? (element.type ? `${element.kind}/${element.type}` : element.kind);
}

export function generatePresentation(body: Body): Record<string, VesselPresentation> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Object.fromEntries(
    Object.keys(body.vessels).map((id, index) => [
      id,
      {
        label: formatGeneratedLabel(id),
        icon: id === body.root ? "@" : alphabet[index % alphabet.length]
      }
    ])
  );
}

function formatGeneratedLabel(id: string): string {
  return id
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("\n");
}
