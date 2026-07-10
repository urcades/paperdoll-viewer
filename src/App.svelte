<script lang="ts">
  import {
    deleteVessel,
    disconnect,
    insertElement,
    insertVessel,
    moveElement,
    parseDocument,
    type Body,
    type ContainedElement,
    type PaperDollDocument
  } from "paperdoll";
  import { DEAD_STATUS, judgeAll, PRESET_PROFILES, type ProfileVerdict } from "./profiles";
  import PaperDollCanvas from "./PaperDollCanvas.svelte";
  import TimelinePanel from "./TimelinePanel.svelte";
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
  import { applyPatch, canonicalizeBody, diffBodies, invertPatch, type PaperfoldDocument } from "paperfold";
  import { History, type HistoryTag } from "./history.svelte";
  import { assertApplied, snapshotBody } from "./protocol.svelte";
  import { advanceTick, applyStrike, bleedRate, deriveCondition, hasCombatLayers, healAll, WEAPONS } from "./combat";
  import { derivePowerStatus, hasPower, propagatePower } from "./power";
  import {
    canDisconnect,
    describeElement,
    getBodyAtAddress,
    joinAddress,
    legalDropVessels,
    replaceBodyAtAddress,
    ROOT_ADDRESS,
    type SelectionTarget,
    type ViewControls
  } from "./workbench";

  type Pan = {
    x: number;
    y: number;
  };

  type Selection = {
    address: string;
    target: SelectionTarget;
  };

  type VesselWindowState = {
    surface: string;
    vessel: string;
    bodyElementId: string | null;
    drawerVessel: string | null;
  };

  type MutationMeta = {
    select?: SelectionTarget;
    status: string;
    tag?: HistoryTag;
    runId?: number | null;
  };

  type ElementDrag = {
    pointerId: number;
    address: string;
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
  let selection = $state<Selection | null>({
    address: ROOT_ADDRESS,
    target: { kind: "vessel", id: DEFAULT_DOCUMENT.body.root }
  });
  let selectedPresetId = $state(DEFAULT_PRESET.id);
  let status = $state(`Selected ${DEFAULT_DOCUMENT.body.root}`);
  let sourceStatus: string | null = $state(null);
  let pan: Pan = $state({ x: 0, y: 0 });
  let viewControls: ViewControls = $state(structuredClone(INITIAL_VIEW_CONTROLS));
  let vesselWindow = $state<VesselWindowState | null>(null);
  let mode = $state<"construct" | "play">("construct");
  let elementDrag = $state<ElementDrag | null>(null);
  let rejectFlash = $state<{ address: string; vessel: string } | null>(null);
  let rejectTimer: ReturnType<typeof setTimeout> | undefined;

  let windowSurfaceBody: Body | null = $derived(
    vesselWindow ? getBodyAtAddress(document.body, vesselWindow.surface) : null
  );
  let windowVessel = $derived(
    vesselWindow && windowSurfaceBody ? (windowSurfaceBody.vessels[vesselWindow.vessel] ?? null) : null
  );
  let windowCanvasAddress: string | null = $derived(
    vesselWindow && vesselWindow.bodyElementId !== null
      ? joinAddress(vesselWindow.surface, vesselWindow.vessel, vesselWindow.bodyElementId)
      : null
  );
  let windowBody: Body | null = $derived(
    windowCanvasAddress !== null ? getBodyAtAddress(document.body, windowCanvasAddress) : null
  );
  let windowDrawerVessel = $derived(
    vesselWindow?.drawerVessel && windowBody ? (windowBody.vessels[vesselWindow.drawerVessel] ?? null) : null
  );
  let windowTitle = $derived(getWindowTitle(vesselWindow));
  let rootSelection: SelectionTarget | null = $derived(
    selection && selection.address === ROOT_ADDRESS ? selection.target : null
  );
  let windowSelection: SelectionTarget | null = $derived(
    selection && selection.address === windowCanvasAddress ? selection.target : null
  );
  let selectedRootVesselId = $derived(rootSelection?.kind === "vessel" ? rootSelection.id : document.body.root);
  let canDelete = $derived(computeCanDelete(selection));
  let constructionSource = $state(
    formatConstructionSource(DEFAULT_DOCUMENT, VESSEL_PRESENTATION, INITIAL_VIEW_CONTROLS)
  );
  let nodeRanges = $derived(getConstructionNodeRanges(constructionSource));
  let poolElements = $derived(document.body.vessels.pool?.contains ?? []);
  let weaponId = $state(WEAPONS[1].id);
  let combatVessels = $derived(
    Object.keys(document.body.vessels).filter((id) => hasCombatLayers(document.body, id))
  );
  let canStrike = $derived(combatVessels.length > 0);
  let condition = $derived(deriveCondition(document.body));
  let profileVerdicts: ProfileVerdict[] = $derived.by(() => {
    const profileIds = PRESET_PROFILES[selectedPresetId] ?? [];
    if (profileIds.length === 0) return [];
    try {
      return judgeAll(snapshotBody(document.body), profileIds);
    } catch {
      return [];
    }
  });
  let bleeding = $state(false);
  let bleedTimer: ReturnType<typeof setInterval> | undefined;
  const history = new History();
  let canRun = $derived(hasPower(document.body));
  let running = $state(false);
  let powerTimer: ReturnType<typeof setInterval> | undefined;

  let simRunId = $state(0);

  function pulsePower(): void {
    const result = propagatePower($state.snapshot(document.body) as Body);
    const status = derivePowerStatus(result.body).join(" · ");
    commitBodyAt(ROOT_ADDRESS, result.body, { status: status || "no power network", tag: "sim", runId: simRunId });
  }

  function toggleRun(): void {
    if (running) {
      stopRun();
      return;
    }
    running = true;
    simRunId += 1;
    powerTimer = setInterval(pulsePower, 1000);
    pulsePower();
  }

  function stopRun(): void {
    running = false;
    clearInterval(powerTimer);
    powerTimer = undefined;
  }

  $effect(() => () => clearInterval(powerTimer));

  function toggleBleed(): void {
    if (bleeding) {
      stopBleed();
      return;
    }
    bleeding = true;
    simRunId += 1;
    bleedTimer = setInterval(tickBleed, 1000);
    tickBleed();
  }

  function stopBleed(): void {
    bleeding = false;
    clearInterval(bleedTimer);
    bleedTimer = undefined;
  }

  // The reify relay: papermold judges structure only, so death observed by
  // the sim must become a structural fact. Inserting the marker before the
  // commit keeps the killing tick one atomic, undoable patch.
  function reifyDeath(body: Body, conditions: string[]): Body {
    if (!conditions.some((line) => line.startsWith("dead"))) return body;
    const hasMarker = Object.values(body.vessels).some((vessel) =>
      vessel.contains?.some((element) => element.kind === DEAD_STATUS.kind && element.type === DEAD_STATUS.type)
    );
    return hasMarker ? body : insertElement(body, body.root, { ...DEAD_STATUS });
  }

  function tickBleed(): void {
    const result = advanceTick($state.snapshot(document.body) as Body);
    if (!result.changed) {
      stopBleed();
      return;
    }
    const conditions = deriveCondition(result.body);
    result.body = reifyDeath(result.body, conditions);
    commitBodyAt(ROOT_ADDRESS, result.body, {
      status: `Bleeding (−${bleedRate(document.body)}/s)${conditions.length > 0 ? ` — ${conditions.join(", ")}` : ""}`,
      tag: "sim",
      runId: simRunId
    });
    if (conditions.some((line) => line.startsWith("dead"))) stopBleed();
  }

  $effect(() => () => clearInterval(bleedTimer));
  let rootDropTargets = $derived(
    elementDrag?.active && elementDrag.address === ROOT_ADDRESS ? elementDrag.targets : null
  );
  let rootRejectVesselId = $derived(rejectFlash?.address === ROOT_ADDRESS ? rejectFlash.vessel : null);
  let windowDropTargets = $derived(
    elementDrag?.active && windowCanvasAddress !== null && elementDrag.address === windowCanvasAddress
      ? elementDrag.targets
      : null
  );
  let windowRejectVesselId = $derived(
    rejectFlash && windowCanvasAddress !== null && rejectFlash.address === windowCanvasAddress
      ? rejectFlash.vessel
      : null
  );

  function beginElementDrag(event: PointerEvent, address: string, vesselId: string, index: number): void {
    if (event.button !== 0) return;
    const body = getBodyAtAddress(document.body, address);
    const element = body?.vessels[vesselId]?.contains?.[index];
    if (!body || !element) return;

    event.preventDefault();
    elementDrag = {
      pointerId: event.pointerId,
      address,
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

    const body = getBodyAtAddress(document.body, drag.address);
    if (!body) return;

    if (!drag.targets.has(targetVessel)) {
      const accepts = body.vessels[targetVessel]?.accepts;
      const acceptsLabel = accepts === undefined
        ? "anything"
        : accepts.length === 0
          ? "nothing (sealed)"
          : accepts.map((token) => (token.type ? `${token.kind}/${token.type}` : token.kind)).join(", ");
      status = `${targetVessel} does not accept ${drag.element.type ? `${drag.element.kind}/${drag.element.type}` : drag.element.kind} — accepts ${acceptsLabel}`;
      rejectFlash = { address: drag.address, vessel: targetVessel };
      clearTimeout(rejectTimer);
      rejectTimer = setTimeout(() => (rejectFlash = null), 450);
      return;
    }

    try {
      const nextBody = moveElement(body, drag.vessel, drag.index, targetVessel);
      commitBodyAt(drag.address, nextBody, {
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
      return drag.address === ROOT_ADDRESS ? "pool" : null;
    }

    const slot = dropped.closest(".slot");
    if (!slot) return null;
    const inWindow = Boolean(dropped.closest(".embedded-body-window"));
    const sameSurface = inWindow
      ? windowCanvasAddress !== null && drag.address === windowCanvasAddress
      : drag.address === ROOT_ADDRESS;
    return sameSurface ? ((slot as HTMLElement).dataset.nodeId ?? null) : null;
  }

  function strike(): void {
    try {
      const body = $state.snapshot(document.body) as Body;
      const selected =
        selection?.address === ROOT_ADDRESS && selection.target.kind === "vessel" ? selection.target.id : null;
      const targetId =
        selected && hasCombatLayers(body, selected)
          ? selected
          : combatVessels[Math.floor(Math.random() * combatVessels.length)];
      const weapon = WEAPONS.find((candidate) => candidate.id === weaponId) ?? WEAPONS[0];

      const result = applyStrike(body, targetId, weapon);
      const conditions = deriveCondition(result.body);
      const nextBody = reifyDeath(result.body, conditions);
      commitBodyAt(ROOT_ADDRESS, nextBody, {
        select: { kind: "vessel", id: targetId },
        status: conditions.length > 0 ? `${result.log} — ${conditions.join(", ")}` : result.log,
        tag: "sim",
        runId: simRunId
      });
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function healCombatant(): void {
    try {
      stopBleed();
      commitBodyAt(ROOT_ADDRESS, healAll($state.snapshot(document.body) as Body), {
        status: "All wounds healed"
      });
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function setMode(nextMode: "construct" | "play"): void {
    mode = nextMode;
    if (nextMode === "play" && !document.body.vessels.pool) {
      const result = insertVessel($state.snapshot(document.body) as Body, {}, { id: "pool" });
      commitBodyAt(ROOT_ADDRESS, result.body, { status: "Entered play mode with an empty pool" });
      return;
    }
    status = nextMode === "play" ? "Play mode: drag items between pool and vessels" : "Construct mode";
  }

  function computeCanDelete(current: Selection | null): boolean {
    if (!current) return false;
    const body = getBodyAtAddress(document.body, current.address);
    if (!body) return false;
    if (current.target.kind === "vessel") {
      return current.target.id !== body.root && Boolean(body.vessels[current.target.id]);
    }
    return canDisconnect(body, current.target.from);
  }

  function selectAt(address: string, target: SelectionTarget): void {
    selection = { address, target };
    if (target.kind === "vessel") {
      status = `Selected ${target.id}`;
      return;
    }

    const label = `${target.from.vessel} ↔ ${target.to.vessel}`;
    const body = getBodyAtAddress(document.body, address);
    status =
      body && canDisconnect(body, target.from)
        ? `Selected connection ${label}`
        : `Selected connection ${label} — cannot sever: would orphan ported vessels`;
  }

  function openVessel(vesselId: string): void {
    vesselWindow = { surface: ROOT_ADDRESS, vessel: vesselId, bodyElementId: null, drawerVessel: null };
  }

  // Addresses are element-id based (law 8), so opening a body requires the
  // element to carry an id.
  function openBodyElement(index: number): void {
    if (!vesselWindow) return;
    const element = windowVessel?.contains?.[index];
    if (!element?.body) return;
    if (!element.id) {
      status = "Element needs an id to be addressed — give it one in the source panel";
      return;
    }
    vesselWindow = { ...vesselWindow, bodyElementId: element.id, drawerVessel: null };
  }

  function openDrawerBodyElement(index: number): void {
    if (!vesselWindow?.drawerVessel || windowCanvasAddress === null) return;
    const element = windowDrawerVessel?.contains?.[index];
    if (!element?.body) return;
    if (!element.id) {
      status = "Element needs an id to be addressed — give it one in the source panel";
      return;
    }
    vesselWindow = {
      surface: windowCanvasAddress,
      vessel: vesselWindow.drawerVessel,
      bodyElementId: element.id,
      drawerVessel: null
    };
  }

  function getWindowTitle(state: VesselWindowState | null): string {
    if (!state) return "";
    const label =
      state.surface === ROOT_ADDRESS
        ? (presentation[state.vessel]?.label?.replace(/\s+/g, " ") ?? state.vessel)
        : state.vessel;
    return state.bodyElementId === null ? label : `${label}: ${state.bodyElementId}`;
  }

  // The commit funnel. Callers hand over a candidate next body (possibly for
  // a nested drawer address); the funnel lifts it to the root, diffs against
  // the current root, and commits paperfold's canonical applied body. Every
  // mutation therefore lands as a recorded, invertible patch.
  function commitBodyAt(address: string, nextBody: Body, meta: MutationMeta): void {
    try {
      const prevRoot = snapshotBody(document.body);
      const nextRoot = replaceBodyAtAddress(prevRoot, address, snapshotBody(nextBody));
      const patch = assertApplied(diffBodies(prevRoot, nextRoot));
      if (patch.patch.length === 0) {
        // No-op commit (e.g. a power pulse with nothing left to drain): update
        // the status line without polluting history.
        status = meta.status;
        return;
      }
      const applied = assertApplied(applyPatch(prevRoot, patch));
      history.push({
        patch,
        inverse: invertPatch(patch),
        label: meta.status,
        tag: meta.tag ?? "construct",
        runId: meta.runId ?? null
      });
      commitConstruction(
        { ...document, body: applied },
        presentation,
        viewControls,
        meta.select ? { address, target: meta.select } : selection,
        meta.status,
        true
      );
    } catch (error) {
      setErrorStatus(error);
    }
  }

  // Undo/redo re-apply recorded patches without pushing new entries. Timers
  // stop first so a sim run can't race a rewind.
  function undo(): void {
    applyHistoryStep(history.undo(), "inverse", "Undid");
  }

  function redo(): void {
    applyHistoryStep(history.redo(), "patch", "Redid");
  }

  function applyHistoryStep(
    entry: { patch: PaperfoldDocument; inverse: PaperfoldDocument; label: string } | null,
    direction: "patch" | "inverse",
    verb: string
  ): void {
    if (!entry) return;
    try {
      stopBleed();
      stopRun();
      const applied = assertApplied(applyPatch(snapshotBody(document.body), entry[direction]));
      commitConstruction(
        { ...document, body: applied },
        presentation,
        viewControls,
        selection,
        `${verb}: ${entry.label}`,
        true
      );
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function seekTimeline(index: number): void {
    try {
      stopBleed();
      stopRun();
      const step = history.seekTo(index);
      if (!step) return;
      const applied = assertApplied(applyPatch(snapshotBody(document.body), step));
      commitConstruction(
        { ...document, body: applied },
        presentation,
        viewControls,
        selection,
        `Timeline at ${history.cursor}/${history.entries.length}`,
        true
      );
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function handleUndoKey(event: KeyboardEvent): void {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
    const target = event.target as HTMLElement | null;
    // Leave the source panel's own editor history alone.
    if (target?.closest(".cm-editor, input, textarea, select")) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }

  function deleteSelected(): void {
    try {
      if (!selection) return;
      const body = getBodyAtAddress(document.body, selection.address);
      if (!body) return;

      if (selection.target.kind === "connection") {
        const { from, to } = selection.target;
        const { body: nextBody } = disconnect(body, from);
        commitBodyAt(selection.address, nextBody, {
          select: { kind: "vessel", id: from.vessel },
          status: `Severed ${from.vessel} ↔ ${to.vessel}`
        });
        return;
      }

      if (selection.target.id === body.root) {
        throw new Error(`Cannot delete root ${selection.target.id}`);
      }

      const deletedId = selection.target.id;
      const { body: nextBody, collapsed } = deleteVessel(body, deletedId, { collapseOppositeNeighbors: true });
      commitBodyAt(selection.address, nextBody, {
        select: { kind: "vessel", id: nextBody.root },
        status: collapsed
          ? `Deleted ${deletedId}, bridged ${collapsed.from.vessel} ↔ ${collapsed.to.vessel}`
          : `Deleted ${deletedId}`
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
    stopBleed();
    stopRun();
    history.clear();
    commitConstruction(
      structuredClone(preset.document),
      structuredClone(preset.presentation),
      structuredClone(INITIAL_VIEW_CONTROLS),
      { address: ROOT_ADDRESS, target: { kind: "vessel", id: preset.document.body.root } },
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
      history.clear();
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
      const surface = getBodyAtAddress(document.body, vesselWindow.surface);
      const vessel = surface?.vessels[vesselWindow.vessel];
      if (!vessel) {
        vesselWindow = null;
      } else if (
        vesselWindow.bodyElementId !== null &&
        !vessel.contains?.some((element) => element.id === vesselWindow!.bodyElementId && element.body)
      ) {
        vesselWindow = { ...vesselWindow, bodyElementId: null, drawerVessel: null };
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
    const rootFallback: Selection = { address: ROOT_ADDRESS, target: { kind: "vessel", id: document.body.root } };
    if (!candidate) return rootFallback;

    const body = getBodyAtAddress(document.body, candidate.address);
    if (!body) return rootFallback;
    if (candidate.target.kind === "vessel") {
      return body.vessels[candidate.target.id]
        ? candidate
        : { address: candidate.address, target: { kind: "vessel", id: body.root } };
    }

    const { from, to } = candidate.target;
    const stillConnected = body.vessels[from.vessel]?.ports?.[from.side]?.vessel === to.vessel;
    return stillConnected ? candidate : { address: candidate.address, target: { kind: "vessel", id: body.root } };
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
    // Compare canonical bodies — patch commits canonicalize (dropping empty
    // ports/contains), so naive whole-document equality would never match a
    // preset again after the first edit+undo.
    const documentText = JSON.stringify({ ...nextDocument, body: canonicalizeBody(nextDocument.body) });
    const presentationText = JSON.stringify(nextPresentation);
    const matchingPreset: PaperDollPreset | undefined = PAPER_DOLL_PRESETS.find(
      (preset) =>
        JSON.stringify({ ...preset.document, body: canonicalizeBody(preset.document.body) }) === documentText &&
        JSON.stringify(preset.presentation) === presentationText
    );

    return matchingPreset?.id ?? null;
  }
</script>

<svelte:window onkeydown={handleUndoKey} />

<div class="paper-doll-editor">
  <PaperDollCanvas
    body={document.body}
    {presentation}
    selection={rootSelection}
    excludeVessels={["pool"]}
    dropTargets={rootDropTargets}
    rejectVesselId={rootRejectVesselId}
    {status}
    {canDelete}
    canUndo={history.canUndo}
    canRedo={history.canRedo}
    verdicts={profileVerdicts}
    onVerdictClick={(verdict) =>
      (status = verdict.conforms
        ? `Conforms to ${verdict.profileId}`
        : `${verdict.profileId}: ${verdict.errors.map((error) => `${error.path} — ${error.message}`).join("; ")}`)}
    {canStrike}
    {weaponId}
    {bleeding}
    {canRun}
    {running}
    presets={PAPER_DOLL_PRESETS}
    {selectedPresetId}
    {pan}
    viewControls={viewControls}
    onPresetChange={handlePresetChange}
    onViewControlsChange={handleViewControlsChange}
    onPanChange={(nextPan) => (pan = nextPan)}
    onSelect={(target) => selectAt(ROOT_ADDRESS, target)}
    onOpenVessel={openVessel}
    onMutate={(nextBody, meta) => commitBodyAt(ROOT_ADDRESS, nextBody, meta)}
    onMutationError={setErrorStatus}
    onDeleteSelected={deleteSelected}
    onUndo={undo}
    onRedo={redo}
    onWeaponChange={(id) => (weaponId = id)}
    onToggleBleed={toggleBleed}
    onPulse={pulsePower}
    onToggleRun={toggleRun}
    onStrike={strike}
    onHeal={healCombatant}
  >
    {#snippet window()}
      {#if vesselWindow && windowVessel}
        <VesselWindow
          title={windowTitle}
          list={vesselWindow.bodyElementId === null
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
          onOpenBodyElement={openBodyElement}
          onDrawerOpenBodyElement={openDrawerBodyElement}
          onBack={vesselWindow.bodyElementId !== null
            ? () => (vesselWindow = { ...vesselWindow!, bodyElementId: null, drawerVessel: null })
            : null}
          onClose={() => (vesselWindow = null)}
          onDrawerClose={() => (vesselWindow = { ...vesselWindow!, drawerVessel: null })}
          onSelect={(target) => windowCanvasAddress !== null && selectAt(windowCanvasAddress, target)}
          onOpenVessel={(id) => (vesselWindow = { ...vesselWindow!, drawerVessel: id })}
          onMutate={(nextBody, meta) =>
            windowCanvasAddress !== null && commitBodyAt(windowCanvasAddress, nextBody, meta)}
          onMutationError={setErrorStatus}
          onListPointerDown={(event, index) =>
            beginElementDrag(event, vesselWindow!.surface, vesselWindow!.vessel, index)}
          onDrawerPointerDown={(event, index) =>
            windowCanvasAddress !== null &&
            beginElementDrag(event, windowCanvasAddress, vesselWindow!.drawerVessel!, index)}
          onElementPointerMove={updateElementDrag}
          onElementPointerUp={endElementDrag}
        />
      {/if}
    {/snippet}
  </PaperDollCanvas>
  {#if mode === "construct"}
    <SourcePanel
      {mode}
      onModeChange={setMode}
      source={constructionSource}
      status={sourceStatus}
      selectedId={selectedRootVesselId}
      nodeRanges={nodeRanges}
      onSourceChange={handleConstructionSourceChange}
      onSelectNode={(id) => selectAt(ROOT_ADDRESS, { kind: "vessel", id })}
    />
  {:else}
    <PoolPanel
      {mode}
      onModeChange={setMode}
      elements={poolElements}
      onElementPointerDown={(event, index) => beginElementDrag(event, ROOT_ADDRESS, "pool", index)}
      onElementPointerMove={updateElementDrag}
      onElementPointerUp={endElementDrag}
    />
  {/if}
  {#if mode === "play"}
    <TimelinePanel entries={history.entries} cursor={history.cursor} onSeek={seekTimeline} />
  {/if}
  {#if elementDrag?.active}
    <div class="drag-ghost" style:left={`${elementDrag.x + 12}px`} style:top={`${elementDrag.y + 12}px`}>
      {describeElement(elementDrag.element)}
    </div>
  {/if}
</div>
