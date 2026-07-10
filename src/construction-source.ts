import { parseDocument, type PaperDollDocument } from "paperdoll";
import { type VesselPresentation } from "./sample-document";
import { type ViewControls } from "./workbench";

export type PaperDollConstruction = {
  document: PaperDollDocument;
  presentation: Record<string, VesselPresentation>;
  view: ViewControls;
};

export type ConstructionNodeRange = {
  id: string;
  from: number;
  to: number;
  section: "document" | "presentation";
};

export function parseConstructionSource(source: string): PaperDollConstruction {
  const objectSource = extractPaperDollObjectLiteral(source);
  const value = Function(`"use strict"; return (${objectSource});`)() as Partial<PaperDollConstruction>;
  if (!value.document || !value.presentation || !value.view) {
    throw new Error("paperDoll must include document, presentation, and view");
  }

  const parsedDocument = parseDocument(value.document);
  if (!parsedDocument.ok) {
    throw new Error(parsedDocument.errors.map((error) => error.message).join("\n"));
  }

  return {
    document: parsedDocument.value,
    presentation: value.presentation,
    view: coerceViewControls(value.view)
  };
}

export function getConstructionNodeRanges(source: string): ConstructionNodeRange[] {
  return [
    ...getObjectMemberRanges(source, "vessels", "document"),
    ...getObjectMemberRanges(source, "presentation", "presentation")
  ];
}

export function formatConstructionSource(
  inputDocument: PaperDollDocument,
  inputPresentation: Record<string, VesselPresentation>,
  controls: ViewControls
): string {
  return `import { deriveLayout } from "paperdoll";

const paperDoll = ${formatObject({
    document: inputDocument,
    presentation: inputPresentation,
    view: controls
  })};

const layout = deriveLayout(paperDoll.document.body);
renderPaperDollCanvas({
  document: paperDoll.document,
  presentation: paperDoll.presentation,
  view: paperDoll.view,
  layout
});`;
}

function getObjectMemberRanges(
  source: string,
  objectName: string,
  section: ConstructionNodeRange["section"]
): ConstructionNodeRange[] {
  const objectStart = findNamedObjectStart(source, objectName);
  if (objectStart === -1) return [];

  let objectEnd: number;
  try {
    objectEnd = findBalancedObjectEnd(source, objectStart);
  } catch {
    return [];
  }

  const ranges: ConstructionNodeRange[] = [];
  let index = objectStart + 1;
  while (index < objectEnd) {
    const member = findNextObjectMember(source, index, objectEnd);
    if (!member) break;
    ranges.push({
      id: member.id,
      from: member.from,
      to: member.to,
      section
    });
    index = member.to + 1;
  }

  return ranges;
}

function findNamedObjectStart(source: string, objectName: string): number {
  const namePattern = new RegExp(`${escapeRegExp(objectName)}\\s*:\\s*\\{`, "g");
  const match = namePattern.exec(source);
  return match ? source.indexOf("{", match.index) : -1;
}

function findNextObjectMember(
  source: string,
  from: number,
  objectEnd: number
): { id: string; from: number; to: number } | null {
  const memberPattern = /(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*\{/g;
  memberPattern.lastIndex = from;

  while (true) {
    const match = memberPattern.exec(source);
    if (!match || match.index >= objectEnd) return null;

    const id = match[1] ?? match[2];
    const memberStart = source.lastIndexOf("\n", match.index) + 1;
    const memberObjectStart = source.indexOf("{", match.index);
    if (memberObjectStart === -1 || memberObjectStart >= objectEnd) return null;

    try {
      const memberObjectEnd = findBalancedObjectEnd(source, memberObjectStart);
      if (memberObjectEnd <= objectEnd) return { id, from: memberStart, to: memberObjectEnd + 1 };
    } catch {
      return null;
    }
  }
}

function extractPaperDollObjectLiteral(source: string): string {
  const declaration = source.match(/const\s+paperDoll\s*=/);
  if (!declaration) {
    throw new Error('Expected `const paperDoll = { ... }; renderPaperDollCanvas(paperDoll);`');
  }

  const objectStart = source.indexOf("{", declaration.index! + declaration[0].length);
  if (objectStart === -1) {
    throw new SyntaxError("Expected paperDoll object literal");
  }

  const objectEnd = findBalancedObjectEnd(source, objectStart);
  const renderCall = source.slice(objectEnd + 1).match(/^\s*;\s*const\s+layout\s*=|^\s*;\s*renderPaperDollCanvas\s*\(/);
  if (!renderCall) {
    throw new Error('Expected `const paperDoll = { ... }; renderPaperDollCanvas(paperDoll);`');
  }

  return source.slice(objectStart, objectEnd + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBalancedObjectEnd(source: string, objectStart: number): number {
  let depth = 0;
  let stringQuote: '"' | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      stringQuote = character;
      continue;
    }

    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new SyntaxError("Incomplete paperDoll object literal");
}

function coerceViewControls(value: ViewControls): ViewControls {
  return {
    node: coerceSize(value.node, 24, 96),
    connector: coerceSize(value.connector, 12, 120),
    padding: coerceSize(value.padding, 0, 180)
  };
}

function coerceSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new Error("View sizes must be finite numbers");
  return Math.min(max, Math.max(min, Math.round(value)));
}

function formatObject(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, "$1:");
}
