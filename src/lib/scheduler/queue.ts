import type { Queue } from '../types';

export interface QueueCard {
  cid: number;
  nid: number;
  queue: Queue;
  due: number;
}

export function buildSessionQueue(cards: QueueCard[], now: number = Date.now()): QueueCard[] {
  const dueLearning = cards
    .filter((c) => (c.queue === 'learning' || c.queue === 'relearning') && c.due <= now)
    .sort((a, b) => a.due - b.due);
  const dueReview = cards
    .filter((c) => c.queue === 'review' && c.due <= now)
    .sort((a, b) => a.due - b.due);
  const newCards = cards.filter((c) => c.queue === 'new').sort((a, b) => a.cid - b.cid);

  // Bury siblings like Anki does: a note's other cards (e.g. the Listening and
  // Cloze cards of a Reading card) wait for a later session instead of showing
  // the same sentence back to back. Learning cards are mid-step and never buried.
  const seenNids = new Set(dueLearning.map((c) => c.nid));
  const unburied = [...dueReview, ...newCards].filter((c) => {
    if (seenNids.has(c.nid)) return false;
    seenNids.add(c.nid);
    return true;
  });
  return [...dueLearning, ...unburied];
}
