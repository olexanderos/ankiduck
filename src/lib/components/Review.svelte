<script lang="ts">
  import { tick } from 'svelte';
  import { openAnkiduckDb } from '../db/schema';
  import { getSessionQueueForDeck } from '../db/decks';
  import { gradeCard } from '../db/cardState';
  import { renderCard } from '../template/render';
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

  async function loadQueue() {
    const db = await openAnkiduckDb();
    const queue = await getSessionQueueForDeck(db, deckIds);
    db.close();
    queueCids = queue.map((c) => c.cid);
    currentIndex = 0;
    await loadCurrentCard();
  }

  async function loadCurrentCard() {
    revealed = false;
    if (currentIndex >= queueCids.length) {
      currentCid = null;
      return;
    }
    currentCid = queueCids[currentIndex];

    const db = await openAnkiduckDb();
    const card = (await db.get('cards', currentCid)) as Card;
    const note = (await db.get('notes', card.nid)) as Note;
    const noteType = (await db.get('noteTypes', note.mid)) as NoteType;
    const mediaFiles = await db.getAll('media');
    const state = (await db.get('cardState', currentCid)) as CardState;
    db.close();

    const mediaUrlMap = new Map(mediaFiles.map((m) => [m.filename, URL.createObjectURL(m.blob)]));
    const rendered = renderCard(note, noteType, card.ord, mediaUrlMap);
    frontHtml = rendered.front;
    backHtml = rendered.back;

    const grades: Grade[] = ['again', 'hard', 'good', 'easy'];
    const nextPreviews: Record<Grade, string> = { again: '', hard: '', good: '', easy: '' };
    for (const grade of grades) {
      nextPreviews[grade] = formatIntervalPreview(nextState(state, grade));
    }
    previews = nextPreviews;
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
    if (currentCid === null) return;
    const db = await openAnkiduckDb();
    await gradeCard(db, currentCid, g);
    db.close();
    currentIndex += 1;
    await loadCurrentCard();
  }

  $effect(() => {
    loadQueue();
  });
</script>

<section class="review">
  <header>
    <button onclick={onExit}>← {deckName}</button>
  </header>

  {#if currentCid === null}
    <p class="done">All done for now!</p>
  {:else}
    <div class="review-card">
      {@html revealed ? backHtml : frontHtml}
    </div>

    {#if !revealed}
      <button class="show-answer" onclick={reveal}>Show Answer</button>
    {:else}
      <div class="grades">
        <button onclick={() => grade('again')}>Again<span>{previews.again}</span></button>
        <button onclick={() => grade('hard')}>Hard<span>{previews.hard}</span></button>
        <button onclick={() => grade('good')}>Good<span>{previews.good}</span></button>
        <button onclick={() => grade('easy')}>Easy<span>{previews.easy}</span></button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .review {
    max-width: 480px;
    margin: 0 auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .review-card {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;
  }
  .show-answer {
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
