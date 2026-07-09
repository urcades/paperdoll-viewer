<script lang="ts">
  import { autocompletion, closeBrackets, completionKeymap } from "@codemirror/autocomplete";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { javascript } from "@codemirror/lang-javascript";
  import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
  import { searchKeymap } from "@codemirror/search";
  import { EditorState, StateEffect, StateField } from "@codemirror/state";
  import {
    Decoration,
    type DecorationSet,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    keymap,
    rectangularSelection,
    type ViewUpdate
  } from "@codemirror/view";
  import { tags } from "@lezer/highlight";
  import { untrack } from "svelte";
  import { type ConstructionNodeRange } from "./construction-source";

  type Props = {
    source: string;
    status: string | null;
    selectedId: string;
    nodeRanges: ConstructionNodeRange[];
    onSourceChange: (source: string) => void;
    onSelectNode: (id: string) => void;
  };

  let { source, status, selectedId, nodeRanges, onSourceChange, onSelectNode }: Props = $props();

  let editorEl: HTMLElement;
  let view: EditorView | null = null;
  let applyingExternalSource = false;
  let lastEmittedSource = "";
  let lastSelectedFromEditor = "";
  let lastAppliedSelectedId = "";

  const sourceHighlight = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "700" },
    { tag: [tags.definitionKeyword, tags.moduleKeyword], color: "var(--syntax-keyword)" },
    { tag: [tags.propertyName, tags.definition(tags.variableName)], color: "var(--syntax-property)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-atom)" },
    { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
    { tag: tags.punctuation, color: "var(--syntax-punctuation)" }
  ]);

  const setSelectedRange = StateEffect.define<ConstructionNodeRange | null>();
  const selectedRangeField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (!effect.is(setSelectedRange)) continue;
        if (!effect.value) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-node-range" }).range(effect.value.from, effect.value.to)
        ]);
      }

      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field)
  });

  const sourceTheme = EditorView.theme({
    "&": {
      height: "100%",
      background: "var(--background)",
      color: "var(--foreground)",
      font: "inherit"
    },
    ".cm-scroller": {
      font: "inherit"
    },
    ".cm-content": {
      padding: "14px",
      caretColor: "var(--foreground)"
    },
    ".cm-gutters": {
      display: "none"
    },
    ".cm-activeLine": {
      background: "transparent"
    },
    ".cm-activeLineGutter": {
      background: "transparent"
    },
    ".cm-focused": {
      outline: "0"
    }
  });

  const sourceExtensions = [
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    highlightActiveLine(),
    javascript({ typescript: true }),
    syntaxHighlighting(sourceHighlight),
    EditorView.updateListener.of(handleUpdate),
    selectedRangeField,
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab]),
    sourceTheme
  ];

  $effect(() => {
    if (!view) return;
    const currentSource = view.state.doc.toString();
    if (currentSource === source) return;
    if (source === lastEmittedSource) return;
    applyingExternalSource = true;
    view.dispatch({
      changes: { from: 0, to: currentSource.length, insert: source }
    });
    applyingExternalSource = false;
    updateEditorSelection(true);
  });

  $effect(() => {
    selectedId;
    nodeRanges;
    const shouldCenter = selectedId !== lastAppliedSelectedId;
    updateEditorSelection(shouldCenter);
  });

  $effect(() => {
    view = new EditorView({
      parent: editorEl,
      state: EditorState.create({
        doc: untrack(() => source),
        extensions: sourceExtensions
      })
    });

    return () => {
      view?.destroy();
      view = null;
    };
  });

  function handleUpdate(update: ViewUpdate): void {
    if (update.docChanged) {
      if (applyingExternalSource) return;
      lastEmittedSource = update.state.doc.toString();
      onSourceChange(lastEmittedSource);
    }

    if (!update.selectionSet && !update.docChanged) return;
    const range = findRangeAt(update.state.selection.main.head);
    if (!range || range.id === selectedId || range.id === lastSelectedFromEditor) return;
    lastSelectedFromEditor = range.id;
    onSelectNode(range.id);
  }

  function updateEditorSelection(center: boolean): void {
    if (!view) return;
    const range = findPreferredRange(selectedId);
    const transaction = {
      effects: setSelectedRange.of(range),
      ...(range && center ? { selection: { anchor: range.from, head: range.from }, scrollIntoView: true } : {})
    };
    view.dispatch(transaction);
    lastSelectedFromEditor = selectedId;
    lastAppliedSelectedId = selectedId;
  }

  function findPreferredRange(id: string): ConstructionNodeRange | null {
    return (
      nodeRanges.find((range) => range.id === id && range.section === "presentation") ??
      nodeRanges.find((range) => range.id === id) ??
      null
    );
  }

  function findRangeAt(position: number): ConstructionNodeRange | null {
    return (
      nodeRanges.find((range) => position >= range.from && position <= range.to && range.section === "presentation") ??
      nodeRanges.find((range) => position >= range.from && position <= range.to) ??
      null
    );
  }
</script>

<section class="source-panel" aria-label="Paper doll construction source">
  <header>
    <h1>Paper Doll Construction</h1>
    <span class:error={Boolean(status)} class="hint">{status ?? "Edit code to redraw"}</span>
  </header>
  <div class="source-editor-wrap" bind:this={editorEl}></div>
</section>
