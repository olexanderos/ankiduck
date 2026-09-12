<script lang="ts">
  import { openAnkiduckDb } from '../db/schema';
  import { buildDeckTree, deleteDeck, collectDeckIds, type DeckTreeNode } from '../db/decks';
  import { mergeImport } from '../db/content';
  import { runImport, type ImportProgress } from '../import/controller';
  import { appState } from '../stores/app.svelte';
  import DeckTreeRow from './DeckTreeRow.svelte';

  let {
    onImportStart,
    onImportProgress,
    onImportDone,
  }: {
    onImportStart: () => void;
    onImportProgress: (p: ImportProgress) => void;
    onImportDone: () => void;
  } = $props();

  let tree: DeckTreeNode[] = $state([]);
  let resetScheduling = $state(false);
  let fileInput: HTMLInputElement;

  async function refresh() {
    const db = await openAnkiduckDb();
    tree = await buildDeckTree(db);
    db.close();
  }

  $effect(() => {
    refresh();
  });

  async function handleFileChosen(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    onImportStart();
    try {
      await runImport(file, onImportProgress, async (parsed) => {
        const db = await openAnkiduckDb();
        await mergeImport(db, parsed, resetScheduling);
        db.close();
      });
    } catch {
      // runImport already reports the error via onImportProgress; nothing further to do here.
    }
    await refresh();
    onImportDone();
    (event.target as HTMLInputElement).value = '';
  }

  function openDeck(node: DeckTreeNode) {
    if (node.did === null) return;
    appState.view = { name: 'review', deckIds: collectDeckIds(node), deckName: node.fullPath };
  }

  async function removeDeck(node: DeckTreeNode) {
    if (node.did === null) return;
    if (!confirm(`Delete "${node.fullPath}" and all its cards?`)) return;
    const db = await openAnkiduckDb();
    await deleteDeck(db, node.did);
    db.close();
    await refresh();
  }
</script>

<section class="deck-list">
  <h1>Ankiduck</h1>

  <label class="reset-toggle">
    <input type="checkbox" bind:checked={resetScheduling} />
    Reset scheduling on import
  </label>

  <button onclick={() => fileInput.click()}>Import .apkg</button>
  <input bind:this={fileInput} type="file" accept=".apkg" hidden onchange={handleFileChosen} />

  {#if tree.length === 0}
    <p>No decks yet. Import a .apkg file to get started.</p>
  {:else}
    <ul>
      {#each tree as node (node.fullPath)}
        <DeckTreeRow {node} onOpen={openDeck} onDelete={removeDeck} />
      {/each}
    </ul>
  {/if}
</section>

<style>
  .deck-list {
    max-width: 480px;
    margin: 0 auto;
    padding: 1rem;
  }
  .reset-toggle {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
  }
  ul {
    list-style: none;
    padding: 0;
  }
</style>
