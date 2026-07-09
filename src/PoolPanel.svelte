<script lang="ts">
  import { type ContainedElement } from "paperdoll";

  type Props = {
    elements: readonly ContainedElement[];
  };

  let { elements }: Props = $props();

  function describe(element: ContainedElement): string {
    return element.id ?? (element.type ? `${element.kind}/${element.type}` : element.kind);
  }

  function typeLabel(element: ContainedElement): string {
    return element.type ? `${element.kind}/${element.type}` : element.kind;
  }
</script>

<section class="pool-panel" aria-label="Item pool">
  <header>
    <span>Item Pool</span>
    <span class="pool-hint">Drag items onto vessels</span>
  </header>
  <ul class="pool-list">
    {#each elements as element, index (index)}
      <li class="pool-row" data-pool-index={index}>
        <span class="pool-row-name">{describe(element)}</span>
        <span class="pool-row-type">{typeLabel(element)}</span>
      </li>
    {:else}
      <li class="pool-empty">Pool is empty</li>
    {/each}
  </ul>
</section>
