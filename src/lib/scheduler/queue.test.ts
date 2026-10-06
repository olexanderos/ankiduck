import { describe, it, expect } from 'vitest';
import { buildSessionQueue, type QueueCard } from './queue';

const NOW = 1_700_000_000_000;

describe('buildSessionQueue', () => {
  it('orders due learning/relearning cards before due review cards before new cards', () => {
    const cards: QueueCard[] = [
      { cid: 3, nid: 3, queue: 'new', due: 0 },
      { cid: 2, nid: 2, queue: 'review', due: NOW - 1000 },
      { cid: 1, nid: 1, queue: 'learning', due: NOW - 2000 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([1, 2, 3]);
  });

  it('sorts within the learning/relearning group by soonest due first', () => {
    const cards: QueueCard[] = [
      { cid: 1, nid: 1, queue: 'learning', due: NOW - 1000 },
      { cid: 2, nid: 2, queue: 'relearning', due: NOW - 5000 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([2, 1]);
  });

  it('sorts new cards by ascending cid (creation order)', () => {
    const cards: QueueCard[] = [
      { cid: 5, nid: 5, queue: 'new', due: 0 },
      { cid: 2, nid: 2, queue: 'new', due: 0 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([2, 5]);
  });

  it('excludes learning/review cards that are not yet due', () => {
    const cards: QueueCard[] = [
      { cid: 1, nid: 1, queue: 'learning', due: NOW + 100_000 },
      { cid: 2, nid: 2, queue: 'review', due: NOW + 100_000 },
    ];
    expect(buildSessionQueue(cards, NOW)).toEqual([]);
  });

  it('buries siblings: only the first card of each note is shown in a session', () => {
    const cards: QueueCard[] = [
      { cid: 1, nid: 100, queue: 'new', due: 0 },
      { cid: 2, nid: 100, queue: 'new', due: 0 },
      { cid: 3, nid: 100, queue: 'new', due: 0 },
      { cid: 4, nid: 200, queue: 'new', due: 0 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([1, 4]);
  });

  it('does not show a new or review sibling of a card already in the session', () => {
    const cards: QueueCard[] = [
      { cid: 1, nid: 100, queue: 'learning', due: NOW - 1000 },
      { cid: 2, nid: 100, queue: 'review', due: NOW - 1000 },
      { cid: 3, nid: 100, queue: 'new', due: 0 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([1]);
  });

  it('never buries learning cards, since they are mid-step', () => {
    const cards: QueueCard[] = [
      { cid: 1, nid: 100, queue: 'learning', due: NOW - 2000 },
      { cid: 2, nid: 100, queue: 'relearning', due: NOW - 1000 },
    ];
    expect(buildSessionQueue(cards, NOW).map((c) => c.cid)).toEqual([1, 2]);
  });
});
