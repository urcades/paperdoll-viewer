<script lang="ts">
  import {
    deleteVessel,
    disconnect,
    insertElement,
    isAccepted,
    moveElement,
    removeElement,
    type Body,
    type ContainedElement
  } from "paperdoll";
  import {
    DEAD_STATUS,
    judgeAll,
    judgeSceneAll,
    PRESET_PROFILES,
    PRESET_SCENE_PROFILES,
    type ProfileVerdict
  } from "./profiles";
  import PaperDollCanvas from "./PaperDollCanvas.svelte";
  import TimelinePanel from "./TimelinePanel.svelte";
  import PoolPanel from "./PoolPanel.svelte";
  import VesselWindow from "./VesselWindow.svelte";
  import SourcePanel from "./SourcePanel.svelte";
  import {
    DEFAULT_CANVAS_PADDING,
    DEFAULT_CONNECTOR_LENGTH,
    DEFAULT_NODE_SIZE,
    DEFAULT_SCENE_PRESET,
    SCENE_PRESETS,
    type ScenePreset,
    type VesselPresentation
  } from "./sample-document";
  import { formatSceneSource, getSceneNodeRanges, parseSceneSource } from "./construction-source";
  import {
    applyScenePatch,
    canonicalizeScene,
    diffBodies,
    diffScenes,
    invertScenePatch,
    PAPERFOLD_SCENE_PROTOCOL,
    type ScenePatchDocument,
    type ScenePatchEntry
  } from "paperfold";
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
    type SelectionTarget,
    type ViewControls
  } from "./workbench";
  import {
    addRelation,
    figureBodyNames,
    getBodyAtSceneAddress,
    POOL_BODY,
    pruneDanglingRelations,
    removeRelation,
    resolveSceneAddress,
    replaceBodyInScene,
    splitSceneAddress,
    validateScene,
    type Relation,
    type Scene
  } from "./scene";
  import RelationsPanel from "./RelationsPanel.svelte";

  type Pan = {
    x: number;
    y: number;
  };

  // Selection and window surfaces use scene addresses: "main", "pool",
  // "main/back/nested-backpack".
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
    // Vessels legal on the drop surface: the same body for in-body drags,
    // the main body for drags that start in the pool.
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

  let scene: Scene = $state(structuredClone(DEFAULT_SCENE_PRESET.scene));
  let presentation: Record<string, Record<string, VesselPresentation>> = $state(
    structuredClone(DEFAULT_SCENE_PRESET.presentation)
  );
  let selection = $state<Selection | null>({
    address: "main",
    target: { kind: "vessel", id: DEFAULT_SCENE_PRESET.scene.bodies.main.root }
  });
  let selectedPresetId = $state(DEFAULT_SCENE_PRESET.id);
  let status = $state(`Selected ${DEFAULT_SCENE_PRESET.scene.bodies.main.root}`);
  let sourceStatus: string | null = $state(null);
  let pan: Pan = $state({ x: 0, y: 0 });
  let viewControls: ViewControls = $state(structuredClone(INITIAL_VIEW_CONTROLS));
  let vesselWindow = $state<VesselWindowState | null>(null);
  let mode = $state<"construct" | "play">("construct");
  let elementDrag = $state<ElementDrag | null>(null);
  let rejectFlash = $state<{ address: string; vessel: string } | null>(null);
  let rejectTimer: ReturnType<typeof setTimeout> | undefined;

  let figureNames = $derived(figureBodyNames(scene));
  let primaryName = $derived(figureNames[0]);
  let mainBody: Body = $derived(scene.bodies[primaryName]);

  let windowSurfaceBody: Body | null = $derived(
    vesselWindow ? getBodyAtSceneAddress(scene, vesselWindow.surface) : null
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
    windowCanvasAddress !== null ? getBodyAtSceneAddress(scene, windowCanvasAddress) : null
  );
  let windowDrawerVessel = $derived(
    vesselWindow?.drawerVessel && windowBody ? (windowBody.vessels[vesselWindow.drawerVessel] ?? null) : null
  );
  let windowTitle = $derived(getWindowTitle(vesselWindow));
  let rootSelection: SelectionTarget | null = $derived(
    selection && selection.address === primaryName ? selection.target : null
  );
  let windowSelection: SelectionTarget | null = $derived(
    selection && selection.address === windowCanvasAddress ? selection.target : null
  );
  let selectedRootVesselId = $derived(rootSelection?.kind === "vessel" ? rootSelection.id : mainBody.root);
  let canDelete = $derived(computeCanDelete(selection));
  let constructionSource = $state(
    formatSceneSource(DEFAULT_SCENE_PRESET.scene, DEFAULT_SCENE_PRESET.presentation, INITIAL_VIEW_CONTROLS)
  );
  let nodeRanges = $derived(getSceneNodeRanges(constructionSource));
  let poolElements = $derived(scene.bodies[POOL_BODY]?.vessels[POOL_BODY]?.contains ?? []);
  let weaponId = $state(WEAPONS[1].id);
  let combatVessels = $derived(Object.keys(mainBody.vessels).filter((id) => hasCombatLayers(mainBody, id)));
  let canStrike = $derived(combatVessels.length > 0);
  let condition = $derived(deriveCondition(mainBody));
  let profileVerdicts: ProfileVerdict[] = $derived.by(() => {
    const profileIds = PRESET_PROFILES[selectedPresetId] ?? [];
    if (profileIds.length === 0) return [];
    try {
      return judgeAll(snapshotBody(mainBody), profileIds);
    } catch {
      return [];
    }
  });
  // Scene-wide judgments (papermold/v2): armed/engaged/legal-duel over the
  // whole scene, relations included. Scene facts belong to neither canvas.
  let sceneVerdicts: ProfileVerdict[] = $derived.by(() => {
    const sceneProfileIds = PRESET_SCENE_PROFILES[selectedPresetId] ?? [];
    if (sceneProfileIds.length === 0) return [];
    try {
      return judgeSceneAll(snapshotScene(), sceneProfileIds);
    } catch {
      return [];
    }
  });
  let bleeding = $state(false);
  let bleedTimer: ReturnType<typeof setInterval> | undefined;
  const history = new History();
  let canRun = $derived(hasPower(mainBody));
  let running = $state(false);
  let powerTimer: ReturnType<typeof setInterval> | undefined;

  let simRunId = $state(0);

  function pulsePower(): void {
    const result = propagatePower(snapshotBody(mainBody));
    const status = derivePowerStatus(result.body).join(" · ");
    commitBodyAt(primaryName, result.body, { status: status || "no power network", tag: "sim", runId: simRunId });
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
    const result = advanceTick(snapshotBody(mainBody));
    if (!result.changed) {
      stopBleed();
      return;
    }
    const conditions = deriveCondition(result.body);
    result.body = reifyDeath(result.body, conditions);
    commitBodyAt(primaryName, result.body, {
      status: `Bleeding (−${bleedRate(mainBody)}/s)${conditions.length > 0 ? ` — ${conditions.join(", ")}` : ""}`,
      tag: "sim",
      runId: simRunId
    });
    if (conditions.some((line) => line.startsWith("dead"))) stopBleed();
  }

  $effect(() => () => clearInterval(bleedTimer));
  // One canvas per figure body (side-by-side in versus scenes). A pool drag
  // highlights the primary figure's legal targets.
  let canvases = $derived(
    figureNames.map((name) => ({
      name,
      body: scene.bodies[name],
      presentation: presentation[name] ?? {},
      selection: selection?.address === name ? selection.target : null,
      dropTargets:
        elementDrag?.active &&
        (elementDrag.address === name || (elementDrag.address === POOL_BODY && name === primaryName))
          ? elementDrag.targets
          : null,
      rejectVesselId: rejectFlash?.address === name ? rejectFlash.vessel : null
    }))
  );
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
    const body = getBodyAtSceneAddress(scene, address);
    const element = body?.vessels[vesselId]?.contains?.[index];
    if (!body || !element) return;

    // A drag from the pool targets the main figure; everything else targets
    // vessels of its own body.
    const surfaceBody = address === POOL_BODY ? mainBody : body;
    const sourceVessel = address === POOL_BODY ? "" : vesselId;

    event.preventDefault();
    elementDrag = {
      pointerId: event.pointerId,
      address,
      vessel: vesselId,
      index,
      element,
      targets: new Set(legalDropVessels(surfaceBody, element, sourceVessel)),
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
    const target = resolveDropTarget(drag, dropped);
    if (!target) return;
    if (target.address === drag.address && target.vessel === drag.vessel) return;

    const targetBody = getBodyAtSceneAddress(scene, target.address);
    if (!targetBody) return;

    const targetVesselShape = targetBody.vessels[target.vessel];
    // isAccepted only reads token fields, so the (possibly proxied) element is safe as-is.
    if (!targetVesselShape || !isAccepted(targetVesselShape, drag.element)) {
      const accepts = targetVesselShape?.accepts;
      const acceptsLabel =
        accepts === undefined
          ? "anything"
          : accepts.length === 0
            ? "nothing (sealed)"
            : accepts.map((token) => (token.type ? `${token.kind}/${token.type}` : token.kind)).join(", ");
      status = `${target.vessel} does not accept ${drag.element.type ? `${drag.element.kind}/${drag.element.type}` : drag.element.kind} — accepts ${acceptsLabel}`;
      rejectFlash = { address: target.address, vessel: target.vessel };
      clearTimeout(rejectTimer);
      rejectTimer = setTimeout(() => (rejectFlash = null), 450);
      return;
    }

    try {
      if (target.address === drag.address) {
        const body = getBodyAtSceneAddress(scene, drag.address);
        if (!body) return;
        const nextBody = moveElement(body, drag.vessel, drag.index, target.vessel);
        commitBodyAt(drag.address, nextBody, {
          select: { kind: "vessel", id: target.vessel },
          status: `Moved ${describeElement(drag.element)} to ${target.vessel}`
        });
        return;
      }
      // Cross-body transfer (pool ↔ figure): one history entry, two patches.
      transferElement(drag, target);
    } catch (error) {
      setErrorStatus(error);
    }
  }

  /**
   * Where did the drop land? In-body drags resolve to their own surface;
   * top-level drags may cross between the main figure and the pool body —
   * scene-level transfers that moveElement alone can't express.
   */
  function resolveDropTarget(
    drag: ElementDrag,
    dropped: Element | null
  ): { address: string; vessel: string } | null {
    if (!dropped) return null;
    if (dropped.closest(".pool-panel")) {
      return figureNames.includes(drag.address) ? { address: POOL_BODY, vessel: POOL_BODY } : null;
    }

    const slot = dropped.closest(".slot");
    if (!slot) return null;
    const vessel = (slot as HTMLElement).dataset.nodeId ?? null;
    if (!vessel) return null;

    const inWindow = Boolean(dropped.closest(".embedded-body-window"));
    if (inWindow) {
      return windowCanvasAddress !== null && drag.address === windowCanvasAddress
        ? { address: windowCanvasAddress, vessel }
        : null;
    }
    const column = (dropped.closest("[data-body-name]") as HTMLElement | null)?.dataset.bodyName ?? null;
    if (!column) return null;
    if (drag.address === column || drag.address === POOL_BODY) {
      return { address: column, vessel };
    }
    return null;
  }

  function transferElement(drag: ElementDrag, target: { address: string; vessel: string }): void {
    const fromName = splitSceneAddress(drag.address).bodyName;
    const toName = splitSceneAddress(target.address).bodyName;

    const fromPrev = snapshotBody(scene.bodies[fromName]);
    const removal = removeElement(fromPrev, drag.vessel, drag.index);
    const toPrev = snapshotBody(scene.bodies[toName]);
    const inserted = insertElement(toPrev, target.vessel, removal.element);

    const label = `Moved ${describeElement(drag.element)} to ${toName === POOL_BODY ? "the pool" : target.vessel}`;
    let nextScene = replaceBodyInScene(snapshotScene(), fromName, removal.body);
    nextScene = replaceBodyInScene(nextScene, toName, inserted);
    commitCandidate(
      nextScene,
      toName === POOL_BODY ? selection : { address: toName, target: { kind: "vessel", id: target.vessel } },
      { status: label }
    );
  }

  // The single funnel tail for every mutation: prune relations whose
  // endpoints no longer hold (deleted vessels, severed limbs, transferred
  // elements) so the removals become ordinary removeRelation entries, diff
  // the whole scene into ONE invertible paperfold/v2 patch — cross-body
  // transfers and relation edits included — apply it (which validates every
  // scene law and canonicalizes), and record it.
  function commitCandidate(candidate: Scene, nextSelection: Selection | null, meta: MutationMeta): void {
    const prevScene = snapshotScene();
    const pruned = pruneDanglingRelations(candidate);
    const patch = assertApplied(diffScenes(prevScene, pruned.scene));
    commitPatch(prevScene, patch, pruned.removed, nextSelection, meta);
  }

  // The shared funnel tail: apply the patch (validating every scene law and
  // canonicalizing), record it with its inverse, and run the commitScene tail.
  function commitPatch(
    prevScene: Scene,
    patch: ScenePatchDocument,
    droppedRelations: readonly Relation[],
    nextSelection: Selection | null,
    meta: MutationMeta
  ): void {
    const label =
      droppedRelations.length > 0
        ? `${meta.status} — ${droppedRelations.map((relation) => `${relation.kind} ${relation.from} → ${relation.to}`).join(", ")} dropped`
        : meta.status;
    if (patch.patch.length === 0) {
      // No-op commit (e.g. a power pulse with nothing left to drain): update
      // the status line without polluting history.
      status = label;
      return;
    }
    const applied = assertApplied(applyScenePatch(prevScene, patch));
    history.push({
      patch,
      inverse: invertScenePatch(patch),
      label,
      tag: meta.tag ?? "construct",
      runId: meta.runId ?? null
    });
    commitScene(applied, presentation, viewControls, nextSelection, label, true);
  }

  // In a versus scene the selected figure is the target and the other figure
  // attacks; alone, a figure spars against itself. The attacker's weapon comes
  // from its `wields` relation when one exists (the element's type names the
  // WEAPONS entry); a grappled attacker strikes harder — both readings of the
  // relation table are app semantics, paperchain only declares the edges.
  function strike(): void {
    try {
      const targetName =
        selection && figureNames.includes(selection.address) && hasCombatLayers(scene.bodies[selection.address], scene.bodies[selection.address].root)
          ? selection.address
          : figureNames.find((name) => hasCombatLayers(scene.bodies[name], scene.bodies[name].root)) ?? primaryName;
      const attackerName = figureNames.find((name) => name !== targetName) ?? targetName;
      const body = snapshotBody(scene.bodies[targetName]);

      const selected =
        selection?.address === targetName && selection.target.kind === "vessel" ? selection.target.id : null;
      const targetVessels = Object.keys(body.vessels).filter((id) => hasCombatLayers(body, id));
      const targetId =
        selected && hasCombatLayers(body, selected)
          ? selected
          : targetVessels[Math.floor(Math.random() * targetVessels.length)];

      let weapon = WEAPONS.find((candidate) => candidate.id === weaponId) ?? WEAPONS[0];
      const wields = scene.relations.find(
        (relation) => relation.kind === "wields" && relation.from.startsWith(`${attackerName}/`)
      );
      if (wields) {
        const resolved = resolveSceneAddress(snapshotScene(), wields.to);
        const wieldedType = resolved?.kind === "element" ? resolved.element.type : undefined;
        const wielded = WEAPONS.find((candidate) => candidate.id === wieldedType);
        if (wielded) weapon = wielded;
      }
      const grappled = scene.relations.some(
        (relation) =>
          relation.kind === "grapples" &&
          (relation.from.startsWith(`${attackerName}/`) || relation.to.startsWith(`${attackerName}/`))
      );
      if (grappled) weapon = { ...weapon, momentum: Math.round(weapon.momentum * 1.35) };

      const result = applyStrike(body, targetId, weapon);
      const conditions = deriveCondition(result.body);
      const nextBody = reifyDeath(result.body, conditions);
      const prefix = attackerName !== targetName ? `${attackerName} → ${targetName}: ` : "";
      commitBodyAt(targetName, nextBody, {
        select: { kind: "vessel", id: targetId },
        status: `${prefix}${conditions.length > 0 ? `${result.log} — ${conditions.join(", ")}` : result.log}`,
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
      // Heal whichever figure is selected (or the primary).
      const targetName = selection && figureNames.includes(selection.address) ? selection.address : primaryName;
      commitBodyAt(targetName, healAll(snapshotBody(scene.bodies[targetName])), {
        status: "All wounds healed"
      });
    } catch (error) {
      setErrorStatus(error);
    }
  }

  // The pool is a real scene body now — nothing to splice in when entering
  // play mode.
  function setMode(nextMode: "construct" | "play"): void {
    mode = nextMode;
    status = nextMode === "play" ? "Play mode: drag items between pool and vessels" : "Construct mode";
  }

  function computeCanDelete(current: Selection | null): boolean {
    if (!current) return false;
    const body = getBodyAtSceneAddress(scene, current.address);
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
    const body = getBodyAtSceneAddress(scene, address);
    status =
      body && canDisconnect(body, target.from)
        ? `Selected connection ${label}`
        : `Selected connection ${label} — cannot sever: would orphan ported vessels`;
  }

  function openVessel(bodyName: string, vesselId: string): void {
    vesselWindow = { surface: bodyName, vessel: vesselId, bodyElementId: null, drawerVessel: null };
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
    const { bodyName, address } = splitSceneAddress(state.surface);
    const label =
      address === ""
        ? (presentation[bodyName]?.[state.vessel]?.label?.replace(/\s+/g, " ") ?? state.vessel)
        : state.vessel;
    return state.bodyElementId === null ? label : `${label}: ${state.bodyElementId}`;
  }

  function snapshotScene(): Scene {
    return $state.snapshot(scene) as Scene;
  }

  // The commit funnel. Callers hand over a candidate next body for a scene
  // address. Top-level edits become a candidate scene diffed by
  // commitCandidate. Nested drawer edits diff at the INNER body and ship as
  // paperfold/v2 path entries ("main/back/nested-backpack" is exactly the v2
  // embedded-body chain grammar), so a one-element edit three drawers deep
  // records as that one entry — not as replacement of the whole containing
  // element. The lift through replaceBodyAtAddress survives only to build
  // the candidate that relation pruning inspects.
  function commitBodyAt(sceneAddress: string, nextBody: Body, meta: MutationMeta): void {
    try {
      const { bodyName, address } = splitSceneAddress(sceneAddress);
      const prevScene = snapshotScene();
      const prevBody = prevScene.bodies[bodyName];
      const nextSelection = meta.select ? { address: sceneAddress, target: meta.select } : selection;

      if (address === "") {
        commitCandidate(replaceBodyInScene(prevScene, bodyName, snapshotBody(nextBody)), nextSelection, meta);
        return;
      }

      const prevInner = getBodyAtAddress(prevBody, address);
      if (!prevInner) throw new Error(`No embedded body at "${sceneAddress}"`);
      const innerDiff = assertApplied(diffBodies(prevInner, snapshotBody(nextBody)));

      const candidateBody = replaceBodyAtAddress(prevBody, address, snapshotBody(nextBody));
      const pruned = pruneDanglingRelations(replaceBodyInScene(prevScene, bodyName, candidateBody));

      const patch: ScenePatchDocument = {
        protocol: PAPERFOLD_SCENE_PROTOCOL,
        patch: [
          ...pruned.removed.map((relation): ScenePatchEntry => ({ op: "removeRelation", relation })),
          ...innerDiff.patch.map((entry): ScenePatchEntry => ({ ...entry, body: bodyName, path: address }))
        ]
      };
      commitPatch(prevScene, patch, pruned.removed, nextSelection, meta);
    } catch (error) {
      setErrorStatus(error);
    }
  }

  // Relation edits go through the same funnel — the diff emits the
  // addRelation/removeRelation entries.
  function handleAddRelation(relation: Relation): void {
    try {
      commitCandidate(addRelation(snapshotScene(), relation), selection, {
        status: `Related ${relation.from} ${relation.kind} ${relation.to}`
      });
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function handleRemoveRelation(relation: Relation): void {
    try {
      commitCandidate(removeRelation(snapshotScene(), relation).scene, selection, {
        status: `Unrelated ${relation.from} ${relation.kind} ${relation.to}`
      });
    } catch (error) {
      setErrorStatus(error);
    }
  }

  // Undo/redo re-apply recorded patches without pushing new entries. Timers
  // stop first so a sim run can't race a rewind.
  function undo(): void {
    applyHistoryPatch(history.undo(), "Undid");
  }

  function redo(): void {
    applyHistoryPatch(history.redo(), "Redid");
  }

  function applyHistoryPatch(result: { label: string; patch: ScenePatchDocument } | null, verb: string): void {
    if (!result) return;
    try {
      stopBleed();
      stopRun();
      const applied = assertApplied(applyScenePatch(snapshotScene(), result.patch));
      commitScene(applied, presentation, viewControls, selection, `${verb}: ${result.label}`, true);
    } catch (error) {
      setErrorStatus(error);
    }
  }

  function seekTimeline(index: number): void {
    try {
      stopBleed();
      stopRun();
      const patch = history.seekTo(index);
      if (!patch) return;
      const applied = assertApplied(applyScenePatch(snapshotScene(), patch));
      commitScene(
        applied,
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
      const body = getBodyAtSceneAddress(scene, selection.address);
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
    const preset = SCENE_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;

    selectedPresetId = preset.id;
    pan = { x: 0, y: 0 };
    vesselWindow = null;
    stopBleed();
    stopRun();
    history.clear();
    commitScene(
      structuredClone(preset.scene),
      structuredClone(preset.presentation),
      structuredClone(INITIAL_VIEW_CONTROLS),
      {
        address: figureBodyNames(preset.scene)[0],
        target: { kind: "vessel", id: preset.scene.bodies[figureBodyNames(preset.scene)[0]].root }
      },
      `Selected ${preset.name}`,
      true
    );
  }

  function handleViewControlsChange(nextControls: ViewControls): void {
    commitScene(snapshotScene(), presentation, nextControls, selection, status, true);
  }

  function handleConstructionSourceChange(nextSource: string): void {
    constructionSource = nextSource;
    try {
      const construction = parseSceneSource(nextSource);
      commitScene(
        construction.scene,
        construction.presentation,
        construction.view,
        selection,
        `Rendered ${Object.keys(construction.scene.bodies).length} bodies`,
        false
      );
      selectedPresetId = getMatchingPresetId(construction.scene, construction.presentation) ?? "custom";
      sourceStatus = null;
      history.clear();
    } catch (error) {
      sourceStatus = formatSourceError(error);
    }
  }

  function commitScene(
    nextScene: Scene,
    nextPresentation: Record<string, Record<string, VesselPresentation>>,
    nextViewControls: ViewControls,
    nextSelection: Selection | null,
    nextStatus: string,
    rewriteSource: boolean
  ): void {
    const errors = validateScene(nextScene);
    if (errors.length > 0) {
      status = errors.map((error) => `${error.path} ${error.message}`).join("\n");
      return;
    }

    scene = nextScene;
    presentation = nextPresentation;
    viewControls = nextViewControls;
    if (vesselWindow) {
      const surface = getBodyAtSceneAddress(scene, vesselWindow.surface);
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
      constructionSource = formatSceneSource(snapshotScene(), presentation, viewControls);
      sourceStatus = null;
    }
  }

  function reconcileSelection(candidate: Selection | null): Selection {
    const rootFallback: Selection = {
      address: primaryName,
      target: { kind: "vessel", id: scene.bodies[primaryName].root }
    };
    if (!candidate) return rootFallback;

    const body = getBodyAtSceneAddress(scene, candidate.address);
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
    if (error instanceof Error && error.message.startsWith("Expected `const paperScene")) {
      return "Keep editing to redraw";
    }

    return error instanceof Error ? error.message : String(error);
  }

  function getMatchingPresetId(
    nextScene: Scene,
    nextPresentation: Record<string, Record<string, VesselPresentation>>
  ): string | null {
    // Compare canonical bodies — patch commits canonicalize (dropping empty
    // ports/contains), so naive equality would never match a preset again
    // after the first edit+undo.
    const sceneText = JSON.stringify(canonicalizeScene(nextScene));
    const presentationText = JSON.stringify(nextPresentation);
    const matchingPreset: ScenePreset | undefined = SCENE_PRESETS.find(
      (preset) =>
        JSON.stringify(canonicalizeScene(preset.scene)) === sceneText &&
        JSON.stringify(preset.presentation) === presentationText
    );

    return matchingPreset?.id ?? null;
  }

  const presetOptions = SCENE_PRESETS.map((preset) => ({ id: preset.id, name: preset.name }));
</script>

<svelte:window onkeydown={handleUndoKey} />

<div class="paper-doll-editor">
  <PaperDollCanvas
    {canvases}
    {status}
    {canDelete}
    canUndo={history.canUndo}
    canRedo={history.canRedo}
    verdicts={profileVerdicts}
    {sceneVerdicts}
    onVerdictClick={(verdict) =>
      (status = verdict.conforms
        ? `Conforms to ${verdict.profileId}`
        : `${verdict.profileId}: ${verdict.errors.map((error) => `${error.path} — ${error.message}`).join("; ")}`)}
    {canStrike}
    {weaponId}
    {bleeding}
    {canRun}
    {running}
    presets={presetOptions}
    {selectedPresetId}
    {pan}
    viewControls={viewControls}
    onPresetChange={handlePresetChange}
    onViewControlsChange={handleViewControlsChange}
    onPanChange={(nextPan) => (pan = nextPan)}
    onSelect={(name, target) => selectAt(name, target)}
    onOpenVessel={openVessel}
    onMutate={(name, nextBody, meta) => commitBodyAt(name, nextBody, meta)}
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
      selectedId={`${primaryName}/${selectedRootVesselId}`}
      nodeRanges={nodeRanges}
      onSourceChange={handleConstructionSourceChange}
      onSelectNode={(id) => {
        const { bodyName, address } = splitSceneAddress(id);
        selectAt(bodyName, { kind: "vessel", id: address || bodyName });
      }}
    />
  {:else}
    <div class="play-panels">
      <PoolPanel
        {mode}
        onModeChange={setMode}
        elements={poolElements}
        onElementPointerDown={(event, index) => beginElementDrag(event, POOL_BODY, POOL_BODY, index)}
        onElementPointerMove={updateElementDrag}
        onElementPointerUp={endElementDrag}
      />
      {#if Object.keys(scene.kinds).length > 0 || scene.relations.length > 0}
        <RelationsPanel {scene} onAdd={handleAddRelation} onRemove={handleRemoveRelation} />
      {/if}
    </div>
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
