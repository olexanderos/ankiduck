<script lang="ts">
  import DeckList from './lib/components/DeckList.svelte';
  import ImportProgress from './lib/components/ImportProgress.svelte';
  import Review from './lib/components/Review.svelte';
  import { appState } from './lib/stores/app.svelte';
  import type { ImportProgress as ImportProgressType } from './lib/import/controller';

  let currentImportProgress: ImportProgressType = $state({ phase: 'idle', pct: 0 });
</script>

{#if appState.view.name === 'deckList'}
  <DeckList
    onImportStart={() => (appState.view = { name: 'importing' })}
    onImportProgress={(p) => (currentImportProgress = p)}
    onImportDone={() => (appState.view = { name: 'deckList' })}
  />
{:else if appState.view.name === 'importing'}
  <ImportProgress progress={currentImportProgress} />
{:else if appState.view.name === 'review'}
  <Review
    deckIds={appState.view.deckIds}
    deckName={appState.view.deckName}
    onExit={() => (appState.view = { name: 'deckList' })}
  />
{/if}
