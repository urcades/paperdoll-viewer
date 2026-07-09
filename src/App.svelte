<script lang="ts">
  import {
    deleteVessel,
    disconnect,
    insertVessel,
    parseDocument,
    type Body,
    type ContainedElement,
    type PaperDollDocument
  } from "paperdoll";
  import PaperDollCanvas from "./PaperDollCanvas.svelte";
  import PoolPanel from "./PoolPanel.svelte";
  import VesselWindow from "./VesselWindow.svelte";
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
  import {
    canDisconnect,
    getBodyAtPath,
    pathsEqual,
    replaceBodyAtPath,
    type BodyPath,
    type SelectionTarget,
    type ViewControls
  } from "./workbench";

  type Pan = {
    x: number;
    y: number;
  };

  type Selection = {
    path: BodyPath;
    target: SelectionTarget;
  };

  type EmbeddedWindow = {
    path: BodyPath;
    title: string;
  };

  type MutationMeta = {
    select?: SelectionTarget;
    status: string;
  };

  const INITIAL_VIEW_CONTROLS: ViewControls = {
    node: DEFAULT_NODE_SIZE,
    connector: DEFAULT_CONNECTOR_LENGTH,
    padding: DEFAULT_CANVAS_PADDING
  };

  let document: PaperDollDocument = $state(structuredClone(DEFAULT_DOCUMENT));
  let presentation: Record<string, VesselPresentation> = $state(structuredClone(VESSEL_PRESENTATION));
  let selection = $state<Selection | null>({ path: [], target: { kind: "vessel", id: DEFAULT_DOCUMENT.body.root } });
  let selectedPresetId = $state(DEFAULT_PRESET.id);
  let status = $state(`Selected ${DEFAULT_DOCUMENT.body.root}`);
  let sourceStatus: string | null = $state(null);
  let pan: Pan = $state({ x: 0, y: 0 });
  let viewControls: ViewControls = $state(structuredClone(INITIAL_VIEW_CONTROLS));
  let embeddedWindow = $state<EmbeddedWindow | null>(null);
  let mode = $state<"construct" | "play">("construct");

  let windowBody: Body | null = $derived(embeddedWindow ? getBodyAtPath(document.body, embeddedWindow.path) : null);
  let rootSelection: SelectionTarget | null = $derived(
    selection && pathsEqual(selection.path, []) ? selection.target : null
  );
  let windowSelection: SelectionTarget | null = $derived(
    selection && embeddedWindow && pathsEqual(selection.path, embeddedWindow.path) ? selection.target : null
  );
  let selectedRootVesselId = $derived(rootSelection?.kind === "vessel" ? rootSelection.id : document.body.root);
  let canDelete = $derived(computeCanDelete(selection));
  let constructionSource = $state(
    formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, INITIAL_VIEW_CONTROLS)
  );
  let nodeRanges = $derived(getConstructionNodeRanges(constructionSource));
  let poolElements = $derived(document.body.vessels.pool?.contains ?? []);

  function setMode(nextMode: "construct" | "play"): void {
    mode = nextMode;
    if (nextMode === "play" && !document.body.vessels.pool) {
      const result = insertVessel($state.snapshot(document.body) as Body, {}, { id: "pool" });
      commitBodyAt([], result.body, { status: "Entered play mode with an empty pool" });
      return;
    }
    status = nextMode === "play" ? "Play mode: drag items between pool and vessels" : "Construct mode";
  }

  function computeCanDelete(current: Selection | null): boolean {
    if (!current) return false;
    const body = getBodyAtPath(document.body, current.path);
    if (!body) return false;
    if (current.target.kind === "vessel") {
      return current.target.id !== body.root && Boolean(body.vessels[current.target.id]);
    }
    return canDisconnect(body, current.target.from);
  }

  function selectAt(path: BodyPath, target: SelectionTarget): void {
    selection = { path, target };
    if (target.kind === "vessel") {
      status = `Selected ${target.id}`;
      return;
    }

    const label = `${target.from.vessel} ↔ ${target.to.vessel}`;
    const body = getBodyAtPath(document.body, path);
    status =
      body && canDisconnect(body, target.from)
        ? `Selected connection ${label}`
        : `Selected connection ${label} — cannot sever: would orphan ported vessels`;
  }

  function openVessel(vesselId: string): void {
    const element = findEmbeddedBodyElement(document.body, vesselId);
    if (!element?.body) return;

    embeddedWindow = {
      path: [{ vessel: vesselId, elementIndex: element.index }],
      title: `${presentation[vesselId]?.label?.replace(/\s+/g, " ") ?? vesselId}: ${element.id ?? element.type ?? element.kind}`
    };
  }

  function commitBodyAt(path: BodyPath, nextBody: Body, meta: MutationMeta): void {
    try {
      const rootBody = replaceBodyAtPath($state.snapshot(document.body) as Body, path, $state.snapshot(nextBody) as Body);
      commitConstruction(
        { ...document, body: rootBody },
        presentation,
        viewControls,
        meta.select ? { path, target: meta.select } : selection,
        meta.status,
        true
      );
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function deleteSelected(): void {
    try {
      if (!selection) return;
      const body = getBodyAtPath(document.body, selection.path);
      if (!body) return;

      if (selection.target.kind === "connection") {
        const { from, to } = selection.target;
        const nextBody = disconnect(body, from);
        commitBodyAt(selection.path, nextBody, {
          select: { kind: "vessel", id: from.vessel },
          status: `Severed ${from.vessel} ↔ ${to.vessel}`
        });
        return;
      }

      if (selection.target.id === body.root) {
        throw new Error(`Cannot delete root ${selection.target.id}`);
      }

      const nextBody = deleteVessel(body, selection.target.id, { collapseOppositeNeighbors: true });
      commitBodyAt(selection.path, nextBody, {
        select: { kind: "vessel", id: nextBody.root },
        status: "Deleted node"
      });
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function handlePresetChange(presetId: string): void {
    const preset = PAPER_DOLL_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;

    selectedPresetId = preset.id;
    pan = { x: 0, y: 0 };
    embeddedWindow = null;
    commitConstruction(
      structuredClone(preset.document),
      structuredClone(preset.presentation),
      structuredClone(INITIAL_VIEW_CONTROLS),
      { path: [], target: { kind: "vessel", id: preset.document.body.root } },
      `Selected ${preset.name}`,
      true
    );
  }

  function handleViewControlsChange(nextControls: ViewControls): void {
    commitConstruction(document, presentation, nextControls, selection, status, true);
  }

  function handleConstructionSourceChange(nextSource: string): void {
    constructionSource = nextSource;
    try {
      const construction = parseConstructionSource(nextSource);
      commitConstruction(
        construction.document,
        construction.presentation,
        construction.view,
        selection,
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
    nextSelection: Selection | null,
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
    if (embeddedWindow && !getBodyAtPath(document.body, embeddedWindow.path)) {
      embeddedWindow = null;
    }
    selection = reconcileSelection(nextSelection);
    status = nextStatus;
    if (rewriteSource) {
      constructionSource = formatConstructionSource(document, presentation, viewControls);
      sourceStatus = null;
    }
  }

  function reconcileSelection(candidate: Selection | null): Selection {
    const rootFallback: Selection = { path: [], target: { kind: "vessel", id: document.body.root } };
    if (!candidate) return rootFallback;

    const body = getBodyAtPath(document.body, candidate.path);
    if (!body) return rootFallback;
    if (candidate.target.kind === "vessel") {
      return body.vessels[candidate.target.id] ? candidate : { path: candidate.path, target: { kind: "vessel", id: body.root } };
    }

    const { from, to } = candidate.target;
    const stillConnected = body.vessels[from.vessel]?.ports?.[from.side]?.vessel === to.vessel;
    return stillConnected ? candidate : { path: candidate.path, target: { kind: "vessel", id: body.root } };
  }

  function findEmbeddedBodyElement(
    body: Body,
    vesselId: string
  ): (ContainedElement & { index: number }) | undefined {
    const contains = body.vessels[vesselId]?.contains;
    const index = contains?.findIndex((element) => element.body) ?? -1;
    if (index === -1 || !contains) return undefined;
    return { ...contains[index], index };
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
    body={document.body}
    {presentation}
    selection={rootSelection}
    excludeVessels={["pool"]}
    {mode}
    {status}
    {canDelete}
    presets={PAPER_DOLL_PRESETS}
    {selectedPresetId}
    {pan}
    viewControls={viewControls}
    onModeChange={setMode}
    onPresetChange={handlePresetChange}
    onViewControlsChange={handleViewControlsChange}
    onPanChange={(nextPan) => (pan = nextPan)}
    onSelect={(target) => selectAt([], target)}
    onOpenVessel={openVessel}
    onMutate={(nextBody, meta) => commitBodyAt([], nextBody, meta)}
    onMutationError={setErrorStatus}
    onDeleteSelected={deleteSelected}
  >
    {#snippet window()}
      {#if embeddedWindow && windowBody}
        <VesselWindow
          body={windowBody}
          title={embeddedWindow.title}
          {viewControls}
          selection={windowSelection}
          onSelect={(target) => selectAt(embeddedWindow!.path, target)}
          onOpenVessel={() => {}}
          onMutate={(nextBody, meta) => commitBodyAt(embeddedWindow!.path, nextBody, meta)}
          onMutationError={setErrorStatus}
          onClose={() => (embeddedWindow = null)}
        />
      {/if}
    {/snippet}
  </PaperDollCanvas>
  {#if mode === "construct"}
    <SourcePanel
      source={constructionSource}
      status={sourceStatus}
      selectedId={selectedRootVesselId}
      nodeRanges={nodeRanges}
      onSourceChange={handleConstructionSourceChange}
      onSelectNode={(id) => selectAt([], { kind: "vessel", id })}
    />
  {:else}
    <PoolPanel elements={poolElements} />
  {/if}
</div>
