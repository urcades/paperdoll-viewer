import {
  type DerivedLayout,
  type DerivedPosition,
  type PaperDollDocument
} from "paperdoll";
import type { VesselPresentation } from "./sample-document";

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
  presentation: Record<string, VesselPresentation>
): RenderNode[] {
  const figureNodes = Object.entries(layout.figure).map(([id, position]) =>
    toRenderNode(document, presentation, id, position, "figure")
  );
  const figureBottom = Math.max(0, ...figureNodes.map((node) => node.y));
  const freeNodes = layout.free.map((id, index) =>
    toRenderNode(document, presentation, id, { x: index, y: figureBottom + 2 }, "free")
  );
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
