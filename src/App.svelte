<script lang="ts">
  import {
    deleteVessel,
    disconnect,
    insertVessel,
    moveElement,
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
    describeElement,
    getBodyAtPath,
    legalDropVessels,
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

  type VesselWindowState = {
    vesselPath: BodyPath;
    vessel: string;
    bodyElementIndex: number | null;
    drawerVessel: string | null;
  };

  type MutationMeta = {
    select?: SelectionTarget;
    status: string;
  };

  type ElementDrag = {
    pointerId: number;
    path: BodyPath;
    vessel: string;
    index: number;
    element: ContainedElement;
    targets: Set<string>;
    active: boolean;
    originX: number;
    originY: number;
    x: number;
    y: number;
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
  let vesselWindow = $state<VesselWindowState | null>(null);
  let mode = $state<"construct" | "play">("construct");
  let elementDrag = $state<ElementDrag | null>(null);
  let rejectFlash = $state<{ path: BodyPath; vessel: string } | null>(null);
  let rejectTimer: ReturnType<typeof setTimeout> | undefined;

  let windowSurfaceBody: Body | null = $derived(
    vesselWindow ? getBodyAtPath(document.body, vesselWindow.vesselPath) : null
  );
  let windowVessel = $derived(
    vesselWindow && windowSurfaceBody ? (windowSurfaceBody.vessels[vesselWindow.vessel] ?? null) : null
  );
  let windowCanvasPath: BodyPath | null = $derived(
    vesselWindow && vesselWindow.bodyElementIndex !== null
      ? [...vesselWindow.vesselPath, { vessel: vesselWindow.vessel, elementIndex: vesselWindow.bodyElementIndex }]
      : null
  );
  let windowBody: Body | null = $derived(windowCanvasPath ? getBodyAtPath(document.body, windowCanvasPath) : null);
  let windowDrawerVessel = $derived(
    vesselWindow?.drawerVessel && windowBody ? (windowBody.vessels[vesselWindow.drawerVessel] ?? null) : null
  );
  let windowTitle = $derived(getWindowTitle(vesselWindow));
  let rootSelection: SelectionTarget | null = $derived(
    selection && pathsEqual(selection.path, []) ? selection.target : null
  );
  let windowSelection: SelectionTarget | null = $derived(
    selection && windowCanvasPath && pathsEqual(selection.path, windowCanvasPath) ? selection.target : null
  );
  let selectedRootVesselId = $derived(rootSelection?.kind === "vessel" ? rootSelection.id : document.body.root);
  let canDelete = $derived(computeCanDelete(selection));
  let constructionSource = $state(
    formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, INITIAL_VIEW_CONTROLS)
  );
  let nodeRanges = $derived(getConstructionNodeRanges(constructionSource));
  let poolElements = $derived(document.body.vessels.pool?.contains ?? []);
  let rootDropTargets = $derived(
    elementDrag?.active && pathsEqual(elementDrag.path, []) ? elementDrag.targets : null
  );
  let rootRejectVesselId = $derived(
    rejectFlash && pathsEqual(rejectFlash.path, []) ? rejectFlash.vessel : null
  );
  let windowDropTargets = $derived(
    elementDrag?.active && windowCanvasPath && pathsEqual(elementDrag.path, windowCanvasPath)
      ? elementDrag.targets
      : null
  );
  let windowRejectVesselId = $derived(
    rejectFlash && windowCanvasPath && pathsEqual(rejectFlash.path, windowCanvasPath) ? rejectFlash.vessel : null
  );

  function beginElementDrag(event: PointerEvent, path: BodyPath, vesselId: string, index: number): void {
    if (event.button !== 0) return;
    const body = getBodyAtPath(document.body, path);
    const element = body?.vessels[vesselId]?.contains?.[index];
    if (!body || !element) return;

    event.preventDefault();
    elementDrag = {
      pointerId: event.pointerId,
      path,
      vessel: vesselId,
      index,
      element,
      targets: new Set(legalDropVessels(body, element, vesselId)),
      active: false,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  function updateElementDrag(event: PointerEvent): void {
    if (!elementDrag || event.pointerId !== elementDrag.pointerId) return;
    const active =
      elementDrag.active ||
      Math.hypot(event.clientX - elementDrag.originX, event.clientY - elementDrag.originY) >= 4;
    elementDrag = { ...elementDrag, active, x: event.clientX, y: event.clientY };
  }

  function endElementDrag(event: PointerEvent): void {
    if (!elementDrag || event.pointerId !== elementDrag.pointerId) return;
    const drag = elementDrag;
    elementDrag = null;
    if (!drag.active) return;

    const dropped = window.document.elementFromPoint(event.clientX, event.clientY);
    const targetVessel = resolveDropVessel(drag, dropped);
    if (!targetVessel || targetVessel === drag.vessel) return;

    const body = getBodyAtPath(document.body, drag.path);
    if (!body) return;

    if (!drag.targets.has(targetVessel)) {
      const accepts = body.vessels[targetVessel]?.accepts;
      const acceptsLabel = accepts === undefined
        ? "anything"
        : accepts.length === 0
          ? "nothing (sealed)"
          : accepts.map((token) => (token.type ? `${token.kind}/${token.type}` : token.kind)).join(", ");
      status = `${targetVessel} does not accept ${drag.element.type ? `${drag.element.kind}/${drag.element.type}` : drag.element.kind} — accepts ${acceptsLabel}`;
      rejectFlash = { path: drag.path, vessel: targetVessel };
      clearTimeout(rejectTimer);
      rejectTimer = setTimeout(() => (rejectFlash = null), 450);
      return;
    }

    try {
      const nextBody = moveElement(body, drag.vessel, drag.index, targetVessel);
      commitBodyAt(drag.path, nextBody, {
        select: { kind: "vessel", id: targetVessel },
        status: `Moved ${describeElement(drag.element)} to ${targetVessel}`
      });
    } catch (error) {
      setErrorStatus(error);
    }
  }

  // Same-surface rule: a drag that started in a body may only drop on vessels
  // of that same body — moveElement never crosses body boundaries.
  function resolveDropVessel(drag: ElementDrag, dropped: Element | null): string | null {
    if (!dropped) return null;
    if (dropped.closest(".pool-panel")) {
      return pathsEqual(drag.path, []) ? "pool" : null;
    }

    const slot = dropped.closest(".slot");
    if (!slot) return null;
    const inWindow = Boolean(dropped.closest(".embedded-body-window"));
    const sameSurface = inWindow
      ? Boolean(windowCanvasPath && pathsEqual(drag.path, windowCanvasPath))
      : pathsEqual(drag.path, []);
    return sameSurface ? ((slot as HTMLElement).dataset.nodeId ?? null) : null;
  }

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
    vesselWindow = { vesselPath: [], vessel: vesselId, bodyElementIndex: null, drawerVessel: null };
  }

  function getWindowTitle(state: VesselWindowState | null): string {
    if (!state) return "";
    const label =
      state.vesselPath.length === 0
        ? (presentation[state.vessel]?.label?.replace(/\s+/g, " ") ?? state.vessel)
        : state.vessel;
    if (state.bodyElementIndex === null) return label;
    const element = windowSurfaceBody?.vessels[state.vessel]?.contains?.[state.bodyElementIndex];
    return `${label}: ${element ? describeElement(element) : "embedded body"}`;
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
    vesselWindow = null;
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
    if (vesselWindow) {
      const surface = getBodyAtPath(document.body, vesselWindow.vesselPath);
      const vessel = surface?.vessels[vesselWindow.vessel];
      if (!vessel) {
        vesselWindow = null;
      } else if (
        vesselWindow.bodyElementIndex !== null &&
        !vessel.contains?.[vesselWindow.bodyElementIndex]?.body
      ) {
        vesselWindow = { ...vesselWindow, bodyElementIndex: null, drawerVessel: null };
      }
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
    dropTargets={rootDropTargets}
    rejectVesselId={rootRejectVesselId}
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
      {#if vesselWindow && windowVessel}
        <VesselWindow
          title={windowTitle}
          list={vesselWindow.bodyElementIndex === null
            ? { elements: windowVessel.contains ?? [], accepts: windowVessel.accepts }
            : null}
          body={windowBody}
          drawer={windowDrawerVessel && vesselWindow.drawerVessel
            ? {
                title: vesselWindow.drawerVessel,
                elements: windowDrawerVessel.contains ?? [],
                accepts: windowDrawerVessel.accepts
              }
            : null}
          {viewControls}
          selection={windowSelection}
          dropTargets={windowDropTargets}
          rejectVesselId={windowRejectVesselId}
          onOpenBodyElement={(index) =>
            (vesselWindow = { ...vesselWindow!, bodyElementIndex: index, drawerVessel: null })}
          onDrawerOpenBodyElement={(index) =>
            (vesselWindow = {
              vesselPath: windowCanvasPath!,
              vessel: vesselWindow!.drawerVessel!,
              bodyElementIndex: index,
              drawerVessel: null
            })}
          onBack={vesselWindow.bodyElementIndex !== null
            ? () => (vesselWindow = { ...vesselWindow!, bodyElementIndex: null, drawerVessel: null })
            : null}
          onClose={() => (vesselWindow = null)}
          onDrawerClose={() => (vesselWindow = { ...vesselWindow!, drawerVessel: null })}
          onSelect={(target) => windowCanvasPath && selectAt(windowCanvasPath, target)}
          onOpenVessel={(id) => (vesselWindow = { ...vesselWindow!, drawerVessel: id })}
          onMutate={(nextBody, meta) => windowCanvasPath && commitBodyAt(windowCanvasPath, nextBody, meta)}
          onMutationError={setErrorStatus}
          onListPointerDown={(event, index) =>
            beginElementDrag(event, vesselWindow!.vesselPath, vesselWindow!.vessel, index)}
          onDrawerPointerDown={(event, index) =>
            windowCanvasPath && beginElementDrag(event, windowCanvasPath, vesselWindow!.drawerVessel!, index)}
          onElementPointerMove={updateElementDrag}
          onElementPointerUp={endElementDrag}
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
    <PoolPanel
      elements={poolElements}
      onElementPointerDown={(event, index) => beginElementDrag(event, [], "pool", index)}
      onElementPointerMove={updateElementDrag}
      onElementPointerUp={endElementDrag}
    />
  {/if}
  {#if elementDrag?.active}
    <div class="drag-ghost" style:left={`${elementDrag.x + 12}px`} style:top={`${elementDrag.y + 12}px`}>
      {describeElement(elementDrag.element)}
    </div>
  {/if}
</div>
