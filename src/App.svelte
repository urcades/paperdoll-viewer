<script lang="ts">
  import {
    connect,
    deleteVessel,
    deriveLayout,
    insertVessel,
    OPPOSITE_SIDES,
    parseDocument,
    type Body,
    type ContainedElement,
    type DerivedLayout,
    type PaperDollDocument,
    type Side
  } from "paperdoll";
  import PaperDollCanvas from "./PaperDollCanvas.svelte";
  import SourcePanel from "./SourcePanel.svelte";
  import {
    DEFAULT_CANVAS_PADDING,
    DEFAULT_CONNECTOR_LENGTH,
    DEFAULT_DOCUMENT,
    DEFAULT_NODE_SIZE,
    DEFAULT_PRESET,
    PAPER_DOLL_PRESETS,
    VESSEL_PRESENTATION,
    type PaperDollPreset,
    type VesselPresentation
  } from "./sample-document";
  import {
    formatConstructionSource,
    getConstructionNodeRanges,
    parseConstructionSource
  } from "./construction-source";
  import { type ViewControls } from "./workbench";

  type Pan = {
    x: number;
    y: number;
  };

  type EmbeddedBodyView = {
    vesselId: string;
    title: string;
    body: Body;
  };

  const INITIAL_VIEW_CONTROLS: ViewControls = {
    node: DEFAULT_NODE_SIZE,
    connector: DEFAULT_CONNECTOR_LENGTH,
    padding: DEFAULT_CANVAS_PADDING
  };

  let document: PaperDollDocument = $state(structuredClone(DEFAULT_DOCUMENT));
  let presentation: Record<string, VesselPresentation> = $state(structuredClone(VESSEL_PRESENTATION));
  let layout: DerivedLayout = $state(deriveLayout(DEFAULT_DOCUMENT.body));
  let selectedId = $state("body");
  let selectedPresetId = $state(DEFAULT_PRESET.id);
  let status = $state("Selected body");
  let sourceStatus: string | null = $state(null);
  let pan: Pan = $state({ x: 0, y: 0 });
  let viewControls: ViewControls = $state(structuredClone(INITIAL_VIEW_CONTROLS));
  let embeddedBodyView: EmbeddedBodyView | null = $state(null);

  let canDelete = $derived(selectedId !== document.body.root && hasNode(selectedId));
  let constructionSource = $state(
    formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, INITIAL_VIEW_CONTROLS)
  );
  let nodeRanges = $derived(getConstructionNodeRanges(constructionSource));

  function selectNode(id: string): void {
    selectedId = id;
    status = `Selected ${id}`;
  }

  function openEmbeddedBody(vesselId: string): void {
    const element = findEmbeddedBodyElement(vesselId);
    if (!element?.body) return;

    embeddedBodyView = {
      vesselId,
      title: `${presentation[vesselId]?.label?.replace(/\s+/g, " ") ?? vesselId}: ${element.id ?? element.type ?? element.kind}`,
      body: element.body
    };
  }

  function addVessel(vesselId: string, side: Side): void {
    try {
      const neighborId = findAdjacentVessel(vesselId, side);
      if (neighborId && !document.body.vessels[vesselId].ports?.[side]) {
        const body = connect(
          document.body,
          { vessel: vesselId, side },
          { vessel: neighborId, side: OPPOSITE_SIDES[side] }
        );
        commitConstruction(
          { ...document, body },
          presentation,
          viewControls,
          vesselId,
          `Connected ${vesselId} to ${neighborId}`,
          true
        );
        return;
      }

      const result = insertVessel(document.body, {}, { at: { vessel: vesselId, side } });
      commitConstruction(
        { ...document, body: result.body },
        presentation,
        viewControls,
        result.vesselId,
        `Added ${result.vesselId}`,
        true
      );
    } catch (error) {
      setErrorStatus(error);
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

  function addZone(): void {
    try {
      const result = insertVessel(document.body);
      commitConstruction(
        { ...document, body: result.body },
        presentation,
        viewControls,
        result.vesselId,
        `Added free ${result.vesselId}`,
        true
      );
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function deleteSelected(): void {
    try {
      if (selectedId === document.body.root) {
        throw new Error(`Cannot delete root ${selectedId}`);
      }

      const body = deleteVessel(document.body, selectedId, { collapseOppositeNeighbors: true });
      commitConstruction({ ...document, body }, presentation, viewControls, document.body.root, "Deleted node", true);
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function handlePresetChange(presetId: string): void {
    const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;

    selectedPresetId = preset.id;
    pan = { x: 0, y: 0 };
    commitConstruction(
      structuredClone(preset.document),
      structuredClone(preset.presentation),
      structuredClone(INITIAL_VIEW_CONTROLS),
      preset.document.body.root,
      `Selected ${preset.name}`,
      true
    );
  }

  function handleViewControlsChange(nextControls: ViewControls): void {
    commitConstruction(document, presentation, nextControls, selectedId, status, true);
  }

  function handleConstructionSourceChange(nextSource: string): void {
    constructionSource = nextSource;
    try {
      const construction = parseConstructionSource(nextSource);
      commitConstruction(
        construction.document,
        construction.presentation,
        construction.view,
        selectedId,
        `Rendered ${Object.keys(construction.document.body.vessels).length} vessels`,
        false
      );
      selectedPresetId = getMatchingPresetId(construction.document, construction.presentation) ?? "custom";
      sourceStatus = null;
    } catch (error) {
      sourceStatus = formatSourceError(error);
    }
  }

  function commitConstruction(
    nextDocument: PaperDollDocument,
    nextPresentation: Record<string, VesselPresentation>,
    nextViewControls: ViewControls,
    nextSelection: string,
    nextStatus: string,
    rewriteSource: boolean
  ): void {
    const parsedDocument = parseDocument(nextDocument);
    if (!parsedDocument.ok) {
      status = parsedDocument.errors.map((error) => error.message).join("\n");
      return;
    }

    document = parsedDocument.value;
    presentation = nextPresentation;
    viewControls = nextViewControls;
    layout = deriveLayout(document.body);
    selectedId = hasNode(nextSelection) ? nextSelection : document.body.root;
    if (embeddedBodyView && !findEmbeddedBodyElement(embeddedBodyView.vesselId)?.body) {
      embeddedBodyView = null;
    }
    status = nextStatus;
    if (rewriteSource) {
      constructionSource = formatConstructionSource(document, presentation, viewControls);
      sourceStatus = null;
    }
  }

  function hasNode(id: string): boolean {
    return Boolean(document.body.vessels[id]);
  }

  function findEmbeddedBodyElement(vesselId: string): ContainedElement | undefined {
    return document.body.vessels[vesselId]?.contains?.find((element) => element.body);
  }

  function setErrorStatus(error: unknown): void {
    status = error instanceof Error ? error.message : String(error);
  }

  function formatSourceError(error: unknown): string {
    if (error instanceof SyntaxError) return "Keep editing to redraw";
    if (error instanceof Error && error.message.startsWith("Expected `const paperDoll")) {
      return "Keep editing to redraw";
    }

    return error instanceof Error ? error.message : String(error);
  }

  function getMatchingPresetId(
    nextDocument: PaperDollDocument,
    nextPresentation: Record<string, VesselPresentation>
  ): string | null {
    const documentText = JSON.stringify(nextDocument);
    const presentationText = JSON.stringify(nextPresentation);
    const matchingPreset: PaperDollPreset | undefined = PAPER_DOLL_PRESETS.find(
      (preset) => JSON.stringify(preset.document) === documentText && JSON.stringify(preset.presentation) === presentationText
    );

    return matchingPreset?.id ?? null;
  }

</script>

<div class="paper-doll-editor">
  <PaperDollCanvas
    {document}
    {layout}
    {presentation}
    {selectedId}
    {status}
    {canDelete}
    {embeddedBodyView}
    presets={PAPER_DOLL_PRESETS}
    {selectedPresetId}
    {pan}
    viewControls={viewControls}
    onPresetChange={handlePresetChange}
    onViewControlsChange={handleViewControlsChange}
    onPanChange={(nextPan) => (pan = nextPan)}
    onSelectNode={selectNode}
    onOpenEmbeddedBody={openEmbeddedBody}
    onCloseEmbeddedBody={() => (embeddedBodyView = null)}
    onAddVessel={addVessel}
    onAddZone={addZone}
    onDeleteSelected={deleteSelected}
  />
  <SourcePanel
    source={constructionSource}
    status={sourceStatus}
    selectedId={selectedId}
    nodeRanges={nodeRanges}
    onSourceChange={handleConstructionSourceChange}
    onSelectNode={selectNode}
  />
</div>
