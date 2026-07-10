<script lang="ts">
  import { type ContainedElement } from "paperdoll";

  type Mode = "construct" | "play";

  type Props = {
    mode: Mode;
    onModeChange: (mode: Mode) => void;
    elements: readonly ContainedElement[];
    onElementPointerDown: (event: PointerEvent, index: number) => void;
    onElementPointerMove: (event: PointerEvent) => void;
    onElementPointerUp: (event: PointerEvent) => void;
  };

  let {
    mode,
    onModeChange,
    elements,
    onElementPointerDown,
    onElementPointerMove,
    onElementPointerUp
  }: Props = $props();

  function describe(element: ContainedElement): string {
    return element.id ?? (element.type ? `${element.kind}/${element.type}` : element.kind);
  }

  function typeLabel(element: ContainedElement): string {
    return element.type ? `${element.kind}/${element.type}` : element.kind;
  }
</script>

<section class="pool-panel" aria-label="Item pool">
  <header>
    <div class="mode-toggle" role="group" aria-label="Editor mode">
      <button type="button" data-active={mode === "construct"} onclick={() => onModeChange("construct")}>construct</button>
      <button type="button" data-active={mode === "play"} onclick={() => onModeChange("play")}>play</button>
    </div>
  </header>
  <ul class="pool-list">
    {#each elements as element, index (index)}
      <li
        class="pool-row"
        data-pool-index={index}
        onpointerdown={(event) => onElementPointerDown(event, index)}
        onpointermove={onElementPointerMove}
        onpointerup={onElementPointerUp}
        onpointercancel={onElementPointerUp}
      >
        <span class="pool-row-name">{describe(element)}</span>
        <span class="pool-row-type">{typeLabel(element)}</span>
      </li>
    {:else}
      <li class="pool-empty">Pool is empty</li>
    {/each}
  </ul>
</section>
