<script lang="ts">
  import { tick } from 'svelte';
  import { openAnkiduckDb } from '../db/schema';
  import { getSessionQueueForDeck } from '../db/decks';
  import { gradeCard } from '../db/cardState';
  import { renderCard, referencedMediaFilenames } from '../template/render';
  import { nextState } from '../scheduler/schedule';
  import type { Grade, Note, NoteType, Card, CardState } from '../types';

  let { deckIds, deckName, onExit }: { deckIds: number[]; deckName: string; onExit: () => void } = $props();

  let queueCids: number[] = $state([]);
  let currentIndex = $state(0);
  let revealed = $state(false);
  let frontHtml = $state('');
  let backHtml = $state('');
  let previews: Record<Grade, string> = $state({ again: '', hard: '', good: '', easy: '' });
  let currentCid: number | null = $state(null);
  let loading = $state(true);
  let mediaUrls: string[] = [];

  async function loadQueue() {
    const db = await openAnkiduckDb();
    const queue = await getSessionQueueForDeck(db, deckIds);
    db.close();
    queueCids = queue.map((c) => c.cid);
    currentIndex = 0;
    await loadCurrentCard();
  }

  function revokeMediaUrls() {
    mediaUrls.forEach((url) => URL.revokeObjectURL(url));
    mediaUrls = [];
  }

  async function loadCurrentCard() {
    loading = true;
    if (currentIndex >= queueCids.length) {
      revokeMediaUrls();
      currentCid = null;
      loading = false;
      return;
    }
    const cid = queueCids[currentIndex];

    const db = await openAnkiduckDb();
    const card = (await db.get('cards', cid)) as Card;
    const note = (await db.get('notes', card.nid)) as Note;
    const noteType = (await db.get('noteTypes', note.mid)) as NoteType;
    // Only this note's media: loading every blob in the deck per card made each card take seconds.
    const mediaFiles = await Promise.all(referencedMediaFilenames(note.fields).map((name) => db.get('media', name)));
    const state = (await db.get('cardState', cid)) as CardState;
    db.close();

    revokeMediaUrls();
    const mediaUrlMap = new Map<string, string>();
    for (const m of mediaFiles) {
      if (!m) continue;
      const url = URL.createObjectURL(m.blob);
      mediaUrlMap.set(m.filename, url);
      mediaUrls.push(url);
    }
    const rendered = renderCard(note, noteType, card.ord, mediaUrlMap);
    frontHtml = rendered.front;
    backHtml = rendered.back;
    revealed = false;
    currentCid = cid;

    const grades: Grade[] = ['again', 'hard', 'good', 'easy'];
    const nextPreviews: Record<Grade, string> = { again: '', hard: '', good: '', easy: '' };
    for (const grade of grades) {
      nextPreviews[grade] = formatIntervalPreview(nextState(state, grade));
    }
    previews = nextPreviews;
    loading = false;
  }

  function formatIntervalPreview(state: CardState): string {
    if (state.queue === 'learning' || state.queue === 'relearning') {
      const minutes = Math.round((state.due - Date.now()) / 60_000);
      return `${Math.max(1, minutes)}m`;
    }
    return `${state.ivl}d`;
  }

  async function reveal() {
    revealed = true;
    await tick(); // wait for {@html backHtml} to be in the DOM before querying it
    const audio = document.querySelector<HTMLAudioElement>('.review-card audio.ankiduck-audio');
    audio?.play().catch(() => {
      // iOS autoplay was blocked; the visible replay control still lets the user play it manually.
    });
  }

  async function grade(g: Grade) {
    if (currentCid === null || loading) return;
    const db = await openAnkiduckDb();
    await gradeCard(db, currentCid, g);
    db.close();
    currentIndex += 1;
    await loadCurrentCard();
  }

  $effect(() => {
    loadQueue();
    return revokeMediaUrls;
  });
</script>

<section class="review">
  <header>
    <button onclick={onExit}>← {deckName}</button>
  </header>

  {#if currentCid === null}
    {#if !loading}
      <p class="done">All done for now!</p>
    {/if}
  {:else}
    <div class="review-card">
      {@html revealed ? backHtml : frontHtml}
    </div>

    <div class="actions">
      {#if !revealed}
        <button class="show-answer" onclick={reveal}>Show Answer</button>
      {:else}
        <div class="grades">
          <button disabled={loading} onclick={() => grade('again')}>Again<span>{previews.again}</span></button>
          <button disabled={loading} onclick={() => grade('hard')}>Hard<span>{previews.hard}</span></button>
          <button disabled={loading} onclick={() => grade('good')}>Good<span>{previews.good}</span></button>
          <button disabled={loading} onclick={() => grade('easy')}>Easy<span>{previews.easy}</span></button>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .review {
    /* Fill #app (already sized to the visible screen) instead of 100vh, which
       ignored the body's safe-area padding and pushed the buttons below the fold. */
    flex: 1;
    box-sizing: border-box;
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    padding: 1rem 1rem 0;
    display: flex;
    flex-direction: column;
  }
  .review-card {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;
  }
  /* Stays on screen even when a long card makes the page scroll. */
  .actions {
    position: sticky;
    bottom: var(--safe-bottom);
    padding: 0.5rem 0 1rem;
    background: var(--bg);
  }
  .show-answer {
    width: 100%;
    padding: 1rem;
    font-size: 1.1rem;
  }
  .grades {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }
  .grades button {
    display: flex;
    flex-direction: column;
    padding: 0.75rem 0.25rem;
  }
  .grades span {
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .done {
    text-align: center;
    margin-top: 4rem;
  }
</style>
