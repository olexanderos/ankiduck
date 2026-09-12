<script lang="ts">
  import type { ImportProgress } from '../import/controller';

  let { progress }: { progress: ImportProgress } = $props();

  const phaseLabels: Record<ImportProgress['phase'], string> = {
    idle: 'Preparing…',
    unzipping: 'Unzipping deck…',
    parsing: 'Reading cards…',
    'extracting-media': 'Extracting media…',
    merging: 'Saving to device…',
    done: 'Done!',
    error: 'Import failed',
  };
</script>

<section class="import-progress">
  <h1>{phaseLabels[progress.phase]}</h1>
  {#if progress.phase === 'error'}
    <p class="error">{progress.error}</p>
  {:else}
    <progress value={progress.pct} max="100"></progress>
  {/if}
</section>

<style>
  .import-progress {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
  }
  .error {
    color: #d33;
  }
</style>
