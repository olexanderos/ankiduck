import type { Queue } from '../types';

export interface QueueCard {
  cid: number;
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
  return [...dueLearning, ...dueReview, ...newCards];
}
