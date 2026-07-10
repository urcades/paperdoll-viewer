<script lang="ts">
  // Typed, geometry-free edges between scene bodies. Legality follows the
  // house pattern: trial-apply paperchain's addRelation on a snapshot and
  // offer the button only when it succeeds — multiplicity (fromMax/toMax),
  // irreflexivity, and duplicate laws come from the declaration for free.
  import { addRelation, type Relation, type Scene } from "./scene";

  type Props = {
    scene: Scene;
    onAdd: (relation: Relation) => void;
    onRemove: (relation: Relation) => void;
  };

  let { scene, onAdd, onRemove }: Props = $props();

  let kindId = $state("");
  let fromAddress = $state("");
  let toAddress = $state("");

  let kindIds = $derived(Object.keys(scene.kinds));
  let endpointOptions = $derived(
    Object.entries(scene.bodies).flatMap(([bodyName, body]) =>
      Object.keys(body.vessels).map((vesselId) => `${bodyName}/${vesselId}`)
    )
  );

  let candidate: Relation | null = $derived(
    kindId && fromAddress && toAddress ? { kind: kindId, from: fromAddress, to: toAddress } : null
  );
  let verdict = $derived.by(() => {
    if (!candidate) return { legal: false, reason: "pick a kind and two endpoints" };
    try {
      addRelation($state.snapshot(scene) as Scene, candidate);
      return { legal: true, reason: "" };
    } catch (error) {
      return { legal: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

  function submit(): void {
    if (!candidate || !verdict.legal) return;
    onAdd({ ...candidate });
  }
</script>

<section class="relations-panel" aria-label="Scene relations">
  <header>relations</header>
  <ul class="relations-list">
    {#each scene.relations as relation (JSON.stringify(relation))}
      <li class="relation-row">
        <span class="relation-kind">{relation.kind}</span>
        <span class="relation-endpoints">{relation.from} → {relation.to}</span>
        <button type="button" onclick={() => onRemove($state.snapshot(relation) as Relation)}>×</button>
      </li>
    {:else}
      <li class="relation-empty">No relations</li>
    {/each}
  </ul>
  {#if kindIds.length > 0}
    <div class="relation-form">
      <select bind:value={kindId} aria-label="Relation kind">
        <option value="">kind…</option>
        {#each kindIds as id (id)}
          <option value={id}>{id}</option>
        {/each}
      </select>
      <select bind:value={fromAddress} aria-label="From endpoint">
        <option value="">from…</option>
        {#each endpointOptions as address (address)}
          <option value={address}>{address}</option>
        {/each}
      </select>
      <select bind:value={toAddress} aria-label="To endpoint">
        <option value="">to…</option>
        {#each endpointOptions as address (address)}
          <option value={address}>{address}</option>
        {/each}
      </select>
      <button type="button" disabled={!verdict.legal} title={verdict.reason} onclick={submit}>add</button>
    </div>
    {#if candidate && !verdict.legal}
      <div class="relation-reason">{verdict.reason}</div>
    {/if}
  {/if}
</section>
