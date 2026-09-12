import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openAnkiduckDb } from './schema';
import { buildDeckTree, collectDeckIds, getSessionQueueForDeck, deleteDeck, sweepOrphanMedia } from './decks';
import type { IDBPDatabase } from 'idb';
import type { AnkiduckDB } from './schema';

async function seed(db: IDBPDatabase<AnkiduckDB>, now: number) {
  await db.put('decks', { did: 1, name: 'Swedish 8k', pathSegments: ['Swedish 8k'] });
  await db.put('decks', { did: 2, name: 'Swedish 8k::Verbs', pathSegments: ['Swedish 8k', 'Verbs'] });
  await db.put('cards', { cid: 10, nid: 100, did: 1, ord: 0 });
  await db.put('cards', { cid: 20, nid: 200, did: 2, ord: 0 });
  await db.put('cardState', { cid: 10, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 });
  await db.put('cardState', { cid: 20, queue: 'review', due: now - 1000, ivl: 5, ease: 2.5, lapses: 0, learningStep: 0 });
}

describe('buildDeckTree', () => {
  it('nests decks by :: path and rolls up due/new counts to the parent', async () => {
    const db = await openAnkiduckDb('test-decks-1');
    const now = 1_700_000_000_000;
    await seed(db, now);

    const tree = await buildDeckTree(db, now);

    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.segment).toBe('Swedish 8k');
    expect(root.did).toBe(1);
    expect(root.newCount).toBe(1); // rolled up from itself
    expect(root.dueCount).toBe(1); // rolled up from the Verbs child
    expect(root.children).toHaveLength(1);
    expect(root.children[0].segment).toBe('Verbs');
    expect(root.children[0].dueCount).toBe(1);
    db.close();
  });
});

describe('collectDeckIds', () => {
  it("collects a node's own did plus all descendant dids", async () => {
    const db = await openAnkiduckDb('test-decks-2');
    const now = 1_700_000_000_000;
    await seed(db, now);
    const tree = await buildDeckTree(db, now);
    expect(collectDeckIds(tree[0]).sort()).toEqual([1, 2]);
    db.close();
  });
});

describe('getSessionQueueForDeck', () => {
  it('returns due/new cards across the given deck ids, correctly ordered', async () => {
    const db = await openAnkiduckDb('test-decks-3');
    const now = 1_700_000_000_000;
    await seed(db, now);

    const queue = await getSessionQueueForDeck(db, [1, 2], now);

    expect(queue.map((c) => c.cid)).toEqual([20, 10]); // due review before new
    db.close();
  });
});

describe('deleteDeck', () => {
  it('removes the deck, its subdecks, their cards, cardState, and orphaned notes', async () => {
    const db = await openAnkiduckDb('test-decks-4');
    const now = 1_700_000_000_000;
    await seed(db, now);
    await db.put('notes', { nid: 100, mid: 1, guid: 'g1', fields: ['a'] });
    await db.put('notes', { nid: 200, mid: 1, guid: 'g2', fields: ['b'] });

    await deleteDeck(db, 1); // Swedish 8k, including its Verbs subdeck

    expect(await db.getAll('decks')).toHaveLength(0);
    expect(await db.getAll('cards')).toHaveLength(0);
    expect(await db.getAll('cardState')).toHaveLength(0);
    expect(await db.getAll('notes')).toHaveLength(0);
    db.close();
  });

  it('leaves other decks and their notes untouched', async () => {
    const db = await openAnkiduckDb('test-decks-5');
    const now = 1_700_000_000_000;
    await seed(db, now);
    await db.put('decks', { did: 3, name: 'Other', pathSegments: ['Other'] });
    await db.put('cards', { cid: 30, nid: 300, did: 3, ord: 0 });
    await db.put('cardState', { cid: 30, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 });
    await db.put('notes', { nid: 300, mid: 1, guid: 'g3', fields: ['c'] });

    await deleteDeck(db, 1);

    expect(await db.get('decks', 3)).toBeDefined();
    expect(await db.get('notes', 300)).toBeDefined();
    db.close();
  });
});

describe('sweepOrphanMedia', () => {
  it('removes media not referenced by any remaining note field', async () => {
    const db = await openAnkiduckDb('test-decks-6');
    await db.put('notes', { nid: 1, mid: 1, guid: 'g1', fields: ['[sound:kept.mp3]'] });
    await db.put('media', { filename: 'kept.mp3', blob: new Blob(['x']) });
    await db.put('media', { filename: 'orphan.mp3', blob: new Blob(['y']) });

    await sweepOrphanMedia(db);

    expect(await db.get('media', 'kept.mp3')).toBeDefined();
    expect(await db.get('media', 'orphan.mp3')).toBeUndefined();
    db.close();
  });
});
