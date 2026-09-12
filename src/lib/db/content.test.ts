import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openAnkiduckDb } from './schema';
import { mergeImport } from './content';
import type { ParsedApkg } from '../types';

function parsedFixture(overrides: Partial<ParsedApkg> = {}): ParsedApkg {
  return {
    decks: [{ did: 1, name: 'Default', pathSegments: ['Default'] }],
    noteTypes: [{ mid: 100, name: 'Basic', fields: ['Front', 'Back'], templates: [], css: '', isCloze: false }],
    notes: [{ nid: 1000, mid: 100, guid: 'g1', fields: ['a', 'b'] }],
    cards: [{ cid: 2000, nid: 1000, did: 1, ord: 0 }],
    media: [],
    ...overrides,
  };
}

describe('mergeImport', () => {
  it('creates decks/noteTypes/notes/cards and a fresh new-state cardState row', async () => {
    const db = await openAnkiduckDb('test-content-1');
    await mergeImport(db, parsedFixture(), false);

    expect(await db.get('decks', 1)).toBeDefined();
    expect(await db.get('notes', 1000)).toBeDefined();
    expect(await db.get('cards', 2000)).toBeDefined();
    const state = await db.get('cardState', 2000);
    expect(state?.queue).toBe('new');
    db.close();
  });

  it('does not clobber existing cardState progress on re-import when resetScheduling is false', async () => {
    const db = await openAnkiduckDb('test-content-2');
    await mergeImport(db, parsedFixture(), false);
    await db.put('cardState', { cid: 2000, queue: 'review', due: 123, ivl: 30, ease: 2.6, lapses: 1, learningStep: 0 });

    await mergeImport(db, parsedFixture(), false);

    const state = await db.get('cardState', 2000);
    expect(state?.queue).toBe('review');
    expect(state?.ivl).toBe(30);
    db.close();
  });

  it('resets cardState to new when resetScheduling is true', async () => {
    const db = await openAnkiduckDb('test-content-3');
    await mergeImport(db, parsedFixture(), false);
    await db.put('cardState', { cid: 2000, queue: 'review', due: 123, ivl: 30, ease: 2.6, lapses: 1, learningStep: 0 });

    await mergeImport(db, parsedFixture(), true);

    const state = await db.get('cardState', 2000);
    expect(state?.queue).toBe('new');
    db.close();
  });

  it('upserts deck/note/card content by Anki ID rather than duplicating', async () => {
    const db = await openAnkiduckDb('test-content-4');
    await mergeImport(db, parsedFixture(), false);
    await mergeImport(db, parsedFixture({ decks: [{ did: 1, name: 'Renamed', pathSegments: ['Renamed'] }] }), false);

    const allDecks = await db.getAll('decks');
    expect(allDecks).toHaveLength(1);
    expect(allDecks[0].name).toBe('Renamed');
    db.close();
  });

  it('stores media files', async () => {
    const db = await openAnkiduckDb('test-content-5');
    await mergeImport(db, parsedFixture({ media: [{ filename: 'a.mp3', blob: new Blob(['x']) }] }), false);
    expect(await db.get('media', 'a.mp3')).toBeDefined();
    db.close();
  });
});
